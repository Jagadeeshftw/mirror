// High-level owner flows: one passkey prompt signs everything a flow needs, then the
// relayer submits (gasless; the user never needs MON).
import { toHex, type LocalAccount } from "viem";
import { api } from "./api";
import { actionNonce, permitNonce, predictAccountOnchain } from "./chain";
import {
  ACTION,
  actionTypedData,
  detachTypedData,
  encodeFollow,
  encodeWithdraw,
  followSalt,
  permitTypedData,
  predictAccount,
  receiveAuthTypedData,
  splitSignature,
  transferAuthTypedData,
  type ActionMessage,
} from "./contracts";
import type { Address, AppConfig, Hex, MirrorAccount, MirrorOrderJson, Policy, RelayResult } from "./types";
import { withSigner } from "./wallet";

export type StepState = "pending" | "now" | "done" | "failed";
export type Progress = (key: string, state: StepState, info?: Partial<RelayResult> & { detail?: string }) => void;

const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

function randomNonce32(): Hex {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

async function nonceFor(cfg: AppConfig, acct: MirrorAccount | undefined): Promise<bigint> {
  if (!acct || !acct.deployed) return 0n;
  try {
    return await actionNonce(cfg, acct.account);
  } catch {
    return BigInt(acct.actionNonce ?? "0");
  }
}

async function signAction(signer: LocalAccount, cfg: AppConfig, account: Address, msg: ActionMessage): Promise<Hex> {
  return signer.signTypedData!(actionTypedData(account, cfg.chainId, msg));
}

export interface FollowPlan {
  owner: Address;
  leaderAccountId: number;
  policy: Policy;
  allocationCNS: bigint;
  /** Match-now orders from POST /v1/quote/follow; empty when the toggle is off. */
  orders: MirrorOrderJson[];
  existing: MirrorAccount[];
  /** Account predicted by the backend for this salt (optional cross-check). */
  predicted?: Address;
}

export function nextAccountFor(cfg: AppConfig, owner: Address, existing: MirrorAccount[]): { salt: Hex; account: Address | null } {
  const used = new Set(existing.map((a) => a.salt.toLowerCase()));
  let i = existing.length;
  while (used.has(followSalt(i).toLowerCase())) i++;
  const salt = followSalt(i);
  const { factory, implementation } = cfg.contracts;
  return { salt, account: factory && implementation ? predictAccount(factory, implementation, owner, salt) : null };
}

/**
 * New follow = new MirrorAccount: create (relayer) -> deposit with permit -> ACTION_FOLLOW with
 * abi.encode(Policy, MirrorOrder[]). Permit and action are signed in the same passkey session.
 */
export async function follow(cfg: AppConfig, plan: FollowPlan, progress: Progress) {
  const { salt, account: computed } = nextAccountFor(cfg, plan.owner, plan.existing);
  const account = (computed ?? plan.predicted ?? (await predictAccountOnchain(cfg, plan.owner, salt).catch(() => null))) as Address;
  if (!account) throw new Error("Can't determine the account address");
  const deadline = nowSec() + 1800n;
  progress("sign", "now");
  const pNonce = await permitNonce(cfg, plan.owner);
  const data = encodeFollow(plan.policy, plan.orders);
  const { permitSig, actionSig } = await withSigner(async (signer) => {
    const permitSig = await signer.signTypedData!(
      permitTypedData(cfg.contracts.collateral, cfg.chainId, {
        owner: plan.owner,
        spender: account,
        value: plan.allocationCNS,
        nonce: pNonce,
        deadline,
      }),
    );
    const actionSig = await signAction(signer, cfg, account, { kind: ACTION.FOLLOW, data, nonce: 0n, deadline });
    return { permitSig, actionSig };
  });
  progress("sign", "done");

  progress("create", "now");
  const created = await api.relayCreate({ owner: plan.owner, salt });
  if (created.account && created.account.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Relayer created a different account address");
  }
  progress("create", "done", created);

  progress("deposit", "now");
  const ps = splitSignature(permitSig);
  const dep = await api.relayDeposit({
    account,
    mode: "permit",
    amount: plan.allocationCNS.toString(),
    deadline: deadline.toString(),
    ...ps,
  });
  progress("deposit", "done", dep);

  progress("follow", "now");
  const ex = await api.relayExecute({
    account,
    action: { kind: ACTION.FOLLOW, data, nonce: "0", deadline: deadline.toString() },
    signature: actionSig,
  });
  progress("follow", ex.status === "success" ? "done" : "failed", ex);
  return { account, create: created, deposit: dep, execute: ex };
}

/** Top up an existing account with an AUSD permit (gasless). */
export async function deposit(cfg: AppConfig, owner: Address, account: Address, amountCNS: bigint, progress: Progress) {
  const deadline = nowSec() + 1800n;
  progress("sign", "now");
  const nonce = await permitNonce(cfg, owner);
  const sig = await withSigner((signer) =>
    signer.signTypedData!(permitTypedData(cfg.contracts.collateral, cfg.chainId, { owner, spender: account, value: amountCNS, nonce, deadline })),
  );
  progress("sign", "done");
  progress("relay", "now");
  const r = await api.relayDeposit({ account, mode: "permit", amount: amountCNS.toString(), deadline: deadline.toString(), ...splitSignature(sig) });
  progress("relay", r.status === "success" ? "done" : "failed", r);
  return r;
}

/** Alternative deposit: ERC-3009 receiveWithAuthorization signed by the owner (to = the account). */
export async function depositWithAuthorization(cfg: AppConfig, owner: Address, account: Address, amountCNS: bigint, progress: Progress) {
  const validAfter = 0n;
  const validBefore = nowSec() + 1800n;
  const nonce = randomNonce32();
  progress("sign", "now");
  const sig = await withSigner((signer) =>
    signer.signTypedData!(
      receiveAuthTypedData(cfg.contracts.collateral, cfg.chainId, { from: owner, to: account, value: amountCNS, validAfter, validBefore, nonce }),
    ),
  );
  progress("sign", "done");
  progress("relay", "now");
  const r = await api.relayDeposit({
    account,
    mode: "auth",
    amount: amountCNS.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
    ...splitSignature(sig),
  });
  progress("relay", r.status === "success" ? "done" : "failed", r);
  return r;
}

export interface OwnerAction {
  account: MirrorAccount;
  kind: number;
  data: Hex;
}

/**
 * Signs N owner actions in one passkey session, then relays them in order. Several actions for the same
 * account get consecutive nonces (the contract increments actionNonce on each), so they must land in order.
 */
export async function executeActions(cfg: AppConfig, actions: OwnerAction[], progress: Progress) {
  const deadline = nowSec() + 900n;
  progress("sign", "now");
  const base = await Promise.all(actions.map((a) => nonceFor(cfg, a.account)));
  const seen = new Map<string, number>();
  const nonces = actions.map((a, i) => {
    const k = a.account.account.toLowerCase();
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return base[i] + BigInt(n);
  });
  const sigs = await withSigner(async (signer) => {
    const out: Hex[] = [];
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      out.push(await signAction(signer, cfg, a.account.account, { kind: a.kind, data: a.data, nonce: nonces[i], deadline }));
    }
    return out;
  });
  progress("sign", "done");
  const results: RelayResult[] = [];
  const failed = new Set<string>();
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (failed.has(a.account.account.toLowerCase())) continue;
    progress(`relay:${i}`, "now");
    const r = await api.relayExecute({
      account: a.account.account,
      action: { kind: a.kind, data: a.data, nonce: nonces[i].toString(), deadline: deadline.toString() },
      signature: sigs[i],
    });
    results.push(r);
    progress(`relay:${i}`, r.status === "success" ? "done" : "failed", r);
    // A later action for the same account would carry a nonce that never comes.
    if (r.status !== "success") failed.add(a.account.account.toLowerCase());
  }
  return results;
}

/**
 * Detach (or re-attach) one follow: signs the engine's Detach message and the given owner actions (e.g.
 * SET_PAUSED) in one passkey session, posts the detach first (the keeper stops copying at once), then relays
 * the actions in order with consecutive nonces.
 */
export async function detachWith(cfg: AppConfig, acct: MirrorAccount, detached: boolean, actions: { kind: number; data: Hex }[]) {
  const deadline = nowSec() + 900n;
  const base = await nonceFor(cfg, acct);
  const { detachSig, sigs } = await withSigner(async (signer) => {
    const detachSig = await signer.signTypedData!(detachTypedData(acct.account, cfg.chainId, detached, deadline));
    const sigs: Hex[] = [];
    for (let i = 0; i < actions.length; i++) sigs.push(await signAction(signer, cfg, acct.account, { kind: actions[i].kind, data: actions[i].data, nonce: base + BigInt(i), deadline }));
    return { detachSig, sigs };
  });
  const d = await api.detach(acct.account, { detached, deadline: deadline.toString(), signature: detachSig });
  const results: RelayResult[] = [];
  for (let i = 0; i < actions.length; i++) {
    const r = await api.relayExecute({ account: acct.account, action: { kind: actions[i].kind, data: actions[i].data, nonce: (base + BigInt(i)).toString(), deadline: deadline.toString() }, signature: sigs[i] });
    results.push(r);
    if (r.status !== "success") break;
  }
  return { detach: d, results };
}

/** Send AUSD from the owner's wallet with an ERC-3009 transferWithAuthorization (gasless). */
export async function sendAusd(cfg: AppConfig, owner: Address, to: Address, amountCNS: bigint, progress: Progress) {
  const validAfter = 0n;
  const validBefore = nowSec() + 1800n;
  const nonce = randomNonce32();
  progress("sign", "now");
  const sig = await withSigner((signer) =>
    signer.signTypedData!(
      transferAuthTypedData(cfg.contracts.collateral, cfg.chainId, { from: owner, to, value: amountCNS, validAfter, validBefore, nonce }),
    ),
  );
  progress("sign", "done");
  progress("relay", "now");
  const r = await api.relayTransfer({
    from: owner,
    to,
    value: amountCNS.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
    ...splitSignature(sig),
  });
  progress("relay", r.status === "success" ? "done" : "failed", r);
  return r;
}

/**
 * Withdraw from a follow's account to the owner's wallet (ACTION_WITHDRAW, the only
 * destination the contract allows). If `to` is another address, the same passkey session
 * also signs an ERC-3009 transferWithAuthorization from the wallet to `to`, relayed after.
 */
export async function withdrawTo(cfg: AppConfig, owner: Address, acct: MirrorAccount, amountCNS: bigint, to: Address, progress: Progress) {
  const deadline = nowSec() + 900n;
  const forward = to.toLowerCase() !== owner.toLowerCase();
  progress("sign", "now");
  const nonce = await nonceFor(cfg, acct);
  const data = encodeWithdraw(amountCNS);
  const authNonce = randomNonce32();
  const validBefore = nowSec() + 1800n;
  const { actionSig, transferSig } = await withSigner(async (signer) => {
    const actionSig = await signAction(signer, cfg, acct.account, { kind: ACTION.WITHDRAW, data, nonce, deadline });
    const transferSig = forward
      ? await signer.signTypedData!(transferAuthTypedData(cfg.contracts.collateral, cfg.chainId, { from: owner, to, value: amountCNS, validAfter: 0n, validBefore, nonce: authNonce }))
      : null;
    return { actionSig, transferSig };
  });
  progress("sign", "done");
  progress("withdraw", "now");
  const w = await api.relayExecute({ account: acct.account, action: { kind: ACTION.WITHDRAW, data, nonce: nonce.toString(), deadline: deadline.toString() }, signature: actionSig });
  progress("withdraw", w.status === "success" ? "done" : "failed", w);
  let t: RelayResult | null = null;
  if (forward && transferSig) {
    progress("transfer", "now");
    t = await api.relayTransfer({ from: owner, to, value: amountCNS.toString(), validAfter: "0", validBefore: validBefore.toString(), nonce: authNonce, ...splitSignature(transferSig) });
    progress("transfer", t.status === "success" ? "done" : "failed", t);
  }
  return { withdraw: w, transfer: t };
}
