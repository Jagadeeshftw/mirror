#!/usr/bin/env node
// Mirror dev mock: implements docs/api.md with realistic data so every app screen renders
// without the real engine. Verifies the app's EIP-712 signatures (owner actions, permits,
// ERC-3009) exactly as the contracts would, simulates relayed transactions, SSE live feed,
// the team-run demo cycle, and end-to-end encrypted push payloads.
//
//   node dev-mock/server.mjs            # port 8787 (MOCK_PORT), scenario "funded" (MOCK_SCENARIO)
//   EXPO_PUBLIC_API_BASE=http://localhost:8787 + `adb reverse tcp:8787 tcp:8787`
//
// No real chain is touched. Nothing here sends a transaction anywhere.
import { wireAccount, wireDemo, wireFeedPage, wireMarkets, wireOwnerAccounts, wireQuote, wireStream } from "./wire.mjs";
import { wireLeaderProfile, wireLeaderSummary } from "./wire-leaders.mjs";
import http from "node:http";
import { base64 } from "@scure/base";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, getAddress, parseAbi, recoverTypedDataAddress, toHex } from "viem";
import {
  ACTION,
  BLOCK_REASONS,
  MIRROR_ORDERS_PARAM,
  POLICY_PARAM,
  actionTypedData,
  detachTypedData,
  permitTypedData,
  predictAccount,
  receiveAuthTypedData,
  transferAuthTypedData,
} from "../src/lib/contracts.ts";
import { seal } from "../src/lib/notifyKey.ts";
import { pushRegisterTypedData } from "../src/lib/pushAuth.ts";
import {
  AUSD,
  DEMO_FOLLOWER,
  DEMO_LEADER,
  LEADERS,
  LEADER_POSITIONS,
  MAINNET,
  NANSEN,
  byPerp,
  bySymbol,
  leaderById,
  leaderCurve,
  lns,
  markets,
  notional,
  pns,
  spark,
  txHash,
} from "./data.mjs";
import { SW, adversarialFor, backtest, copyQuality, engineEvent, enrich, setSwitches } from "./engine.mjs";
import { rpcGetLogs, EQUITY_SELECTOR } from "./rpcLogs.mjs";
import { makeStops, STRANGER } from "./stops.mjs";
import { makeShare } from "./share.mjs";
import { applyPolicyLeaders, leaderBlock, leaderBooks, seedMulti } from "./budgets.mjs";

const PORT = Number(process.env.MOCK_PORT ?? 8787);
let defaultScenario = process.env.MOCK_SCENARIO ?? "funded";
const NET_DELAY = Number(process.env.MOCK_LATENCY_MS ?? 120);
const FACTORY = getAddress("0x4d1a2e8c6f0b9f3e7a5c2b1d0e9f8a7b6c5d4e3f");
const IMPLEMENTATION = getAddress("0x91c4a6b2e0d3f5a7c9e1b3d5f7a9c1e3b5d7e6b0");
const KEEPER = getAddress("0x6b5ee0b2a9f1c3d5e7f9a1b3c5d7e9f1a3b5c7d9");
const CHAIN_ID = 143;
const CAP = 25_000_000n;
const MIN_OPEN = 10_000_000n;
const DAY = 86_400_000;
const now = () => Date.now();
let block = 75_204_331;
setInterval(() => (block += 1), 400).unref();

const lc = (a) => String(a).toLowerCase();
const cs = (a) => getAddress(a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BPS = 10_000n;

// ---------------------------------------------------------------- state
/** owner(lower) -> owner state */
const owners = new Map();
/** account(lower) -> account */
const accounts = new Map();
const notes = new Map(); // owner -> Map(account -> envelope)

function newAccount(owner, salt, extra = {}) {
  const account = predictAccount(FACTORY, IMPLEMENTATION, cs(owner), salt);
  const a = {
    account,
    owner: cs(owner),
    salt,
    deployed: true,
    perplAccountId: null,
    collateral: 0n,
    netDeposits: 0n,
    actionNonce: 0n,
    paused: false,
    policy: null,
    positions: [],
    realisedByLeader: new Map(),
    todayStart: 0n,
    hwm: 0n,
    feed: [],
    createdAt: now(),
    teamRun: false,
    leaderAccountId: null,
    ...extra,
  };
  accounts.set(lc(account), a);
  return a;
}

function pos(sym, side, lotsF, entryF, levHdths, leaderAccountId) {
  return { perpId: bySymbol[sym].perpId, side, lots: lns(sym, lotsF), entry: pns(sym, entryF), lev: levHdths, leaderAccountId };
}

function policyFor(leaderId, { lev = 500, slip = 50, dl = 1000, dd = 2000, days = 90, ratio = 10, mk = ["BTC", "ETH", "SOL"], cap = 12_000_000n, entry = 100, budget = cap } = {}) {
  return {
    maxLeverageHdths: lev,
    maxSlippageBps: slip,
    dailyLossBps: dl,
    drawdownBps: dd,
    expiry: Math.floor((now() + days * DAY) / 1000),
    maxEntryDeviationBps: entry,
    stopSlippageBps: 300,
    flattenOnStop: true,
    maxBuilderFeePer100K: 20,
    leaders: [{ accountId: leaderId, ratioBps: ratio, budgetCNS: budget.toString(), lossStopBps: 1500 }],
    markets: mk.map((s) => ({ perpId: bySymbol[s].perpId, maxNotionalCNS: cap.toString() })),
  };
}

function ev(a, kind, fields, ageMs = 0, commitState = "finalized") {
  const e = {
    id: `${lc(a.account).slice(2, 10)}-${a.feed.length + 1}-${Math.floor(Math.random() * 1e6)}`,
    kind,
    account: a.account,
    txHash: txHash(),
    block: block - Math.round(ageMs / 400),
    timestamp: now() - ageMs,
    commitState,
    teamRun: a.teamRun || undefined,
    ...fields,
  };
  enrich(e);
  a.feed.unshift(e);
  return e;
}

const stops = makeStops({ ev: (...a) => ev(...a), upnl: (p) => upnl(p) });

function seedOwner(owner, scenario) {
  const o = { owner: cs(owner), wallet: 0n, permitNonce: 0n, notifyPub: null, pushToken: null, scenario, used3009: new Set() };
  owners.set(lc(owner), o);
  // drop previous accounts of this owner
  for (const [k, a] of accounts) if (lc(a.owner) === lc(owner)) accounts.delete(k);
  if (scenario === "new") return o;
  if (scenario === "empty") {
    o.wallet = 20_000_000n;
    return o;
  }
  if (scenario === "multi") {
    o.wallet = 1_000_000n;
    seedMulti(owner, { newAccount, policyFor, ev, equity, pos, STRANGER });
    return o;
  }
  // funded: three follows, each its own MirrorAccount, 10-15 AUSD each, plus idle AUSD in the wallet.
  o.wallet = 13_100_000n;
  const A = leaderById[1043], B = leaderById[877], C = leaderById[1588];
  const a1 = newAccount(owner, toHex(0n, { size: 32 }), {
    perplAccountId: 12841, collateral: 15_310_000n, netDeposits: 15_000_000n, actionNonce: 1n, leaderAccountId: A.accountId,
    policy: policyFor(A.accountId, { lev: 500, ratio: 1, mk: ["BTC", "SOL", "ETH"], cap: 15_000_000n }),
    positions: [pos("BTC", "long", 0.0001, 117880.0, 400, A.accountId), pos("SOL", "long", 0.047, 198.1, 300, A.accountId)],
    createdAt: now() - 19 * DAY,
  });
  a1.realisedByLeader.set(A.accountId, 310_000n);
  const a2 = newAccount(owner, toHex(1n, { size: 32 }), {
    perplAccountId: 12902, collateral: 10_140_000n, netDeposits: 10_000_000n, actionNonce: 1n, leaderAccountId: B.accountId,
    policy: policyFor(B.accountId, { lev: 300, ratio: 1, mk: ["BTC", "ETH"], cap: 10_000_000n }),
    positions: [pos("ETH", "short", 0.002, 4350.0, 300, B.accountId)],
    createdAt: now() - 12 * DAY,
  });
  a2.realisedByLeader.set(B.accountId, 140_000n);
  const a3 = newAccount(owner, toHex(2n, { size: 32 }), {
    perplAccountId: 13377, collateral: 12_000_000n, netDeposits: 12_000_000n, actionNonce: 1n, leaderAccountId: C.accountId,
    policy: policyFor(C.accountId, { lev: 500, ratio: 1, mk: ["HYPE", "SOL", "MON", "BTC", "ETH"], cap: 12_000_000n }),
    positions: [pos("HYPE", "long", 0.1, 45.42, 500, C.accountId)],
    createdAt: now() - 3 * DAY,
  });
  a3.realisedByLeader.set(C.accountId, 0n);
  for (const a of [a1, a2, a3]) {
    a.todayStart = equity(a) - 800_000n / 3n;
    a.hwm = equity(a) + 50_000n;
  }
  // history (oldest first so newest ends on top)
  const mir = (a, ageMs, sym, side, act, lotsF, pxF, lev, extra = {}) =>
    ev(a, "Mirrored", {
      leaderAccountId: a.leaderAccountId,
      leaderAddress: cs(leaderById[a.leaderAccountId].address),
      perpId: bySymbol[sym].perpId,
      orderType: act === "open" ? (side === "long" ? 0 : 1) : side === "long" ? 2 : 3,
      lotLNS: lns(sym, lotsF).toString(),
      pricePNS: pns(sym, pxF).toString(),
      leverageHdths: lev,
      notionalCNS: notional(bySymbol[sym].perpId, lns(sym, lotsF), pns(sym, pxF)).toString(),
      latencyMs: 560 + Math.round(Math.random() * 120),
      ...extra,
    }, ageMs);
  const blk = (a, ageMs, sym, side, lotsF, pxF, lev, reason, limit, actual, rule) =>
    ev(a, "Blocked", {
      leaderAccountId: a.leaderAccountId,
      leaderAddress: cs(leaderById[a.leaderAccountId].address),
      perpId: bySymbol[sym].perpId,
      orderType: side === "long" ? 0 : 1,
      lotLNS: lns(sym, lotsF).toString(),
      pricePNS: pns(sym, pxF).toString(),
      leverageHdths: lev,
      leaderLotLNS: lns(sym, lotsF).toString(),
      leaderLeverageHdths: lev,
      blocked: { reason, reasonCode: BLOCK_REASONS.indexOf(reason), limit: String(limit), actual: String(actual), rule },
    }, ageMs);
  ev(a1, "Deposited", { amountCNS: "15000000" }, 19 * DAY);
  ev(a1, "Followed", { leaderAccountId: A.accountId, leaderAddress: cs(A.address) }, 19 * DAY - 60000);
  ev(a2, "Deposited", { amountCNS: "10000000" }, 12 * DAY);
  ev(a2, "Followed", { leaderAccountId: B.accountId, leaderAddress: cs(B.address) }, 12 * DAY - 60000);
  ev(a3, "Deposited", { amountCNS: "12000000" }, 3 * DAY);
  ev(a3, "Followed", { leaderAccountId: C.accountId, leaderAddress: cs(C.address) }, 3 * DAY - 60000);
  blk(a2, 5 * 3600e3, "ETH", "long", 3.2, 4298.5, 200, "ExceedsMaxNotional", 10_000_000, 12_960_000, "Copy would be 12.96 AUSD. Max per market 10.00");
  mir(a2, 3 * 3600e3, "ETH", "short", "open", 0.002, 4350.0, 300);
  mir(a1, 2 * 3600e3, "SOL", "long", "open", 0.047, 198.1, 300);
  blk(a1, 52 * 60e3, "PUMP", "long", 41000, 0.004812, 300, "MarketNotAllowed", 0, 90, "PUMP is not in your allowed markets");
  mir(a3, 38 * 60e3, "HYPE", "long", "open", 0.1, 45.42, 500);
  blk(a3, 60e3, "BTC", "long", 1.5, 118390.0, 1200, "LeverageTooHigh", 500, 1200, "Max leverage 5x");
  {
    const sol = bySymbol.SOL;
    const entry = pns("SOL", 198.1);
    const bound = (entry * 10_100n) / 10_000n;
    const e = blk(a1, 2 * 60e3 + 30e3, "SOL", "long", 0.05, 203.45, 300, "EntryTooFar", bound, pns("SOL", 203.45), "Price moved 2.7% past the leader's entry. Your limit is 1%");
    e.data = { ...e.data, leaderEntryPNS: entry.toString(), leaderFillPNS: pns("SOL", 203.4).toString() };
    e.leaderLotLNS = lns("SOL", 2.0).toString();
    void sol;
  }
  a3.feed.unshift(engineEvent(a3, "EngineShrunk", { perpId: bySymbol.HYPE.perpId, orderType: 0, requested: 5, final: 4, depth: 9, limitPNS: pns("HYPE", 46.95), ageMs: 20 * 60e3, block: block - 3000, leaderAccountId: C.accountId, leaderAddress: cs(C.address) }));
  a1.feed.unshift(engineEvent(a1, "EngineSkipped", { perpId: bySymbol.SOL.perpId, orderType: 0, requested: 5, final: 0, depth: 3, limitPNS: pns("SOL", 212.6), ageMs: 15 * 60e3, block: block - 2250, leaderAccountId: A.accountId, leaderAddress: cs(A.address) }));
  mir(a2, 9e3, "BTC", "long", "close", 0.00005, 118402.0, 0, { realisedPnlCNS: "60000" });
  mir(a1, 4e3, "MON", "short", "close", 220, 0.0418, 0, { realisedPnlCNS: "110000" });
  stops.seed(a1, a2, a3, mir);
  a1.feed.sort((x, y) => y.timestamp - x.timestamp);
  a2.feed.sort((x, y) => y.timestamp - x.timestamp);
  a3.feed.sort((x, y) => y.timestamp - x.timestamp);
  a1.feed[0].commitState = "proposed";
  a2.feed[0].commitState = "voted";
  return o;
}

function ownerState(owner) {
  return owners.get(lc(owner)) ?? seedOwner(owner, defaultScenario);
}

// ---------------------------------------------------------------- derived values
const markOf = (perpId) => byPerp[perpId].markPNS;
function upnl(p) {
  const m = markOf(p.perpId);
  const diff = p.side === "long" ? m - p.entry : p.entry - m;
  return notional(p.perpId, p.lots, diff < 0n ? -diff : diff) * (diff < 0n ? -1n : 1n);
}
const marginOf = (p) => (notional(p.perpId, p.lots, p.entry) * 100n) / BigInt(Math.max(100, p.lev || 100));
function equity(a) {
  return a.collateral + a.positions.reduce((s, p) => s + upnl(p), 0n);
}
function liq(p) {
  const lev = Number(p.lev || 100) / 100;
  const f = p.side === "long" ? 1 - 1 / lev + 0.005 : 1 + 1 / lev - 0.005;
  return BigInt(Math.round(Number(p.entry) * f));
}
function serializeAccount(a) {
  const margin = a.positions.reduce((s, p) => s + marginOf(p), 0n);
  const un = a.positions.reduce((s, p) => s + upnl(p), 0n);
  const realised = [...a.realisedByLeader.values()].reduce((s, v) => s + v, 0n);
  const eq = equity(a);
  const byLeader = new Map();
  for (const [id, r] of a.realisedByLeader) byLeader.set(id, { leaderAccountId: id, realisedCNS: r, unrealisedCNS: 0n });
  for (const p of a.positions) {
    const x = byLeader.get(p.leaderAccountId) ?? { leaderAccountId: p.leaderAccountId, realisedCNS: 0n, unrealisedCNS: 0n };
    x.unrealisedCNS += upnl(p);
    byLeader.set(p.leaderAccountId, x);
  }
  const L = a.leaderAccountId ? leaderById[a.leaderAccountId] : null;
  // Engine: pnlByLeader from MirrorAccount.leaderBook for every policy leader (margin, budget, stopped).
  const books = a.policy?.leaders?.length ? leaderBooks(a, { marginOf, upnl }) : null;
  const dl = a.policy?.dailyLossBps ?? 0;
  const ddb = a.policy?.drawdownBps ?? 0;
  return {
    account: a.account,
    owner: a.owner,
    salt: a.salt,
    deployed: a.deployed,
    perplAccountId: a.perplAccountId,
    balanceCNS: a.collateral.toString(),
    equityCNS: eq.toString(),
    withdrawableCNS: (a.collateral - margin > 0n ? a.collateral - margin : 0n).toString(),
    marginCNS: margin.toString(),
    netDepositsCNS: a.netDeposits.toString(),
    depositCapCNS: CAP.toString(),
    actionNonce: a.actionNonce.toString(),
    paused: a.paused,
    detached: !!a.detached,
    expiry: a.policy?.expiry ?? 0,
    policy: a.policy,
    positions: a.positions.map((p) => {
      const m = markOf(p.perpId);
      return {
        perpId: p.perpId,
        side: p.side,
        lotLNS: p.lots.toString(),
        entryPNS: p.entry.toString(),
        markPNS: m.toString(),
        liqPNS: liq(p).toString(),
        leverageHdths: p.lev,
        marginCNS: marginOf(p).toString(),
        notionalCNS: notional(p.perpId, p.lots, m).toString(),
        upnlCNS: upnl(p).toString(),
        leaderAccountId: p.leaderAccountId,
      };
    }),
    pnl: {
      realisedCNS: realised.toString(),
      unrealisedCNS: un.toString(),
      todayCNS: (eq - a.todayStart).toString(),
      byLeader: books
        ? books.map((x) => ({ leaderAccountId: x.leaderAccountId, realisedCNS: x.realisedCNS.toString(), unrealisedCNS: x.unrealisedCNS.toString(), marginCNS: x.marginCNS.toString(), budgetCNS: x.budgetCNS.toString(), stopped: x.stopped }))
        : [...byLeader.values()].map((x) => ({ leaderAccountId: x.leaderAccountId, realisedCNS: x.realisedCNS.toString(), unrealisedCNS: x.unrealisedCNS.toString() })),
    },
    equityHistory: equityHistory(a),
    leader: L ? { accountId: L.accountId, address: cs(L.address), labels: L.labels } : a.teamRun ? { accountId: DEMO_LEADER.accountId, address: cs(DEMO_LEADER.address), labels: ["Team-run demo leader"] } : null,
    stops: {
      dailyLossHit: dl > 0 && eq < (a.todayStart * (BPS - BigInt(dl))) / BPS,
      drawdownHit: ddb > 0 && eq < (a.hwm * (BPS - BigInt(ddb))) / BPS,
    },
    levels: [...stops.levelsOf(a).values()],
    halted: [...stops.haltedOf(a)],
    stoppedLeaders: [...(a.stoppedLeaders ?? [])],
    createdAt: a.createdAt,
    teamRun: a.teamRun,
  };
}
function equityHistory(a) {
  const eq = Number(equity(a)) / 1e6;
  const start = Number(a.netDeposits) / 1e6;
  const n = 42;
  const out = [];
  let x = a.createdAt % 997;
  for (let i = 0; i < n; i++) {
    x = (x * 16807) % 2147483647;
    const t = i / (n - 1);
    const base = start + (eq - start) * (t * t * (3 - 2 * t));
    const noise = i === n - 1 || i === 0 ? 0 : ((x / 2147483647) - 0.5) * 0.01 * start;
    out.push({ t: now() - (n - 1 - i) * ((7 * DAY) / (n - 1)), v: Math.round((base + noise) * 1e6) });
  }
  return out;
}

// ---------------------------------------------------------------- SSE
const clients = new Set();
function broadcast(key, event, data) {
  // Engine frames: `event: <type>` with the bus event ({type, ...}) as data (engine/src/api/server.ts).
  const frames = wireStream(event, JSON.parse(JSON.stringify(data, replacer)));
  for (const [ev, d] of frames) {
    const payload = `event: ${ev}\ndata: ${JSON.stringify(d, replacer)}\n\n`;
    for (const c of clients) if (c.keys.has(lc(key))) c.res.write(payload);
  }
}
setInterval(() => {
  for (const c of clients) c.res.write(`: ping ${Date.now()}\n\n`);
}, 15000).unref();

function emitEvent(a, e, { push = true } = {}) {
  broadcast(a.teamRun ? "demo" : a.account, "feed", e);
  broadcast(a.owner, "feed", e);
  progressCommit(a, e);
  if (push && !a.teamRun) pushFor(a, e);
}
function progressCommit(a, e) {
  if (e.commitState === "finalized") return;
  setTimeout(() => {
    e.commitState = "voted";
    broadcast(a.teamRun ? "demo" : a.account, "commit", { id: e.id, txHash: e.txHash, commitState: "voted" });
  }, 400);
  setTimeout(() => {
    e.commitState = "finalized";
    broadcast(a.teamRun ? "demo" : a.account, "commit", { id: e.id, txHash: e.txHash, commitState: "finalized" });
  }, 820);
}

function sym(perpId) {
  return byPerp[perpId]?.symbol ?? `#${perpId}`;
}
function fmtCns(v) {
  return (Number(v) / 1e6).toFixed(2);
}
function pushPayloadFor(a, e) {
  const L = e.leaderAddress ? `${e.leaderAddress.slice(0, 6)}…${e.leaderAddress.slice(-4)}` : "";
  const side = e.orderType === 0 || e.orderType === 2 ? "long" : "short";
  if (e.kind === "Blocked") {
    return { kind: "blocked", title: "Blocked by your rule", body: `${L} opened ${(e.leverageHdths / 100).toFixed(0)}x ${sym(e.perpId)} ${side}. ${e.blocked?.rule ?? ""}. Not copied.`, account: a.account, eventId: e.id, timestamp: e.timestamp };
  }
  if (e.kind === "Mirrored") {
    const open = e.orderType <= 1;
    return {
      kind: open ? "copied" : "closed",
      title: `${open ? "Copied" : "Closed"} ${sym(e.perpId)} ${side}`,
      body: open
        ? `From ${L} · ${fmtCns(e.notionalCNS)} AUSD at ${(e.leverageHdths / 100).toFixed(0)}x · copied in ${(e.latencyMs / 1000).toFixed(2)} s`
        : `${L} · realised ${Number(e.realisedPnlCNS ?? 0) >= 0 ? "+" : "−"}${fmtCns(Math.abs(Number(e.realisedPnlCNS ?? 0)))} AUSD`,
      account: a.account,
      eventId: e.id,
      timestamp: e.timestamp,
    };
  }
  if (e.kind === "Withdrawn") return { kind: "withdraw", title: "Withdrawal complete", body: `${fmtCns(e.amountCNS)} AUSD is in your wallet. Fee paid by Mirror.`, account: a.account, eventId: e.id, timestamp: e.timestamp };
  if (e.kind === "Deposited") return { kind: "deposit", title: "Deposit received", body: `${fmtCns(e.amountCNS)} AUSD added to your follow`, account: a.account, eventId: e.id, timestamp: e.timestamp };
  return null;
}
function pushFor(a, e) {
  const o = owners.get(lc(a.owner));
  if (!o?.notifyPub) return;
  const p = pushPayloadFor(a, e);
  if (!p) return;
  const env = seal(base64.decode(o.notifyPub), new TextEncoder().encode(JSON.stringify(p)));
  broadcast(a.owner, "push", env);
  broadcast(a.account, "push", env);
}

const share = makeShare({
  accounts, owners, chainId: CHAIN_ID, lc, cs, send: (...a) => send(...a), readBody: (r) => readBody(r), broadcast: (...a) => broadcast(...a),
  pushTo: (a, payload) => {
    const o = owners.get(lc(a.owner));
    if (!o?.notifyPub) return;
    const env = seal(base64.decode(o.notifyPub), new TextEncoder().encode(JSON.stringify(payload)));
    broadcast(a.account, "push", env);
  },
  posInfo: (a, perpId) => {
    const p = a?.positions.find((x) => x.perpId === Number(perpId));
    if (!p) return null;
    const mk = byPerp[p.perpId];
    return {
      side: p.side, entryPNS: p.entry.toString(), markPNS: markOf(p.perpId).toString(), symbol: mk?.symbol, lotDecimals: mk?.lotDecimals ?? 0, priceDecimals: mk?.priceDecimals ?? 0,
      copiedFrom: "0x7a3f…c91e", card: { lotLNS: p.lots.toString(), depositCNS: marginOf(p).toString(), pnlCNS: upnl(p).toString() },
    };
  },
});

// live generator: keeps the feed moving for connected owners
let liveTick = 0;
setInterval(() => {
  liveTick++;
  const connected = new Set();
  for (const c of clients) for (const k of c.keys) connected.add(k);
  for (const a of accounts.values()) {
    if (a.teamRun || !connected.has(lc(a.account)) && !connected.has(lc(a.owner))) continue;
    if (!a.policy || a.paused || a.leaderAccountId !== 1043) continue;
    const L = leaderById[a.leaderAccountId];
    const has = a.positions.find((p) => p.perpId === bySymbol.MON.perpId);
    const mark = markOf(bySymbol.MON.perpId);
    let e;
    if (!has) {
      const lots = 220n;
      a.positions.push({ perpId: bySymbol.MON.perpId, side: "short", lots, entry: mark, lev: 300, leaderAccountId: L.accountId });
      e = ev(a, "Mirrored", { leaderAccountId: L.accountId, leaderAddress: cs(L.address), perpId: bySymbol.MON.perpId, orderType: 1, lotLNS: lots.toString(), pricePNS: mark.toString(), leverageHdths: 300, notionalCNS: notional(bySymbol.MON.perpId, lots, mark).toString(), latencyMs: 540 + Math.round(Math.random() * 140) }, 0, "proposed");
    } else {
      const pnl = upnl(has) + 30_000n;
      a.positions = a.positions.filter((p) => p !== has);
      a.collateral += pnl;
      a.realisedByLeader.set(L.accountId, (a.realisedByLeader.get(L.accountId) ?? 0n) + pnl);
      e = ev(a, "Mirrored", { leaderAccountId: L.accountId, leaderAddress: cs(L.address), perpId: has.perpId, orderType: 3, lotLNS: has.lots.toString(), pricePNS: mark.toString(), leverageHdths: 0, notionalCNS: notional(has.perpId, has.lots, mark).toString(), realisedPnlCNS: pnl.toString(), latencyMs: 540 + Math.round(Math.random() * 140) }, 0, "proposed");
    }
    emitEvent(a, e);
  }
  // marks drift a little
  for (const m of markets) {
    const d = BigInt(Math.round(Number(m.markPNS) * (Math.random() - 0.5) * 0.0008));
    m.markPNS += d;
  }
}, Number(process.env.MOCK_LIVE_MS ?? 20000)).unref();

// ---------------------------------------------------------------- demo (team-run)
const demoFollower = newAccount(DEMO_LEADER.address, toHex(99n, { size: 32 }), {
  account: cs(DEMO_FOLLOWER),
  owner: cs("0xde30000000000000000000000000000000000000"),
  perplAccountId: 13001,
  collateral: 25_000_000n,
  netDeposits: 25_000_000n,
  teamRun: true,
  policy: policyFor(DEMO_LEADER.accountId, { lev: 500, ratio: 10_000, mk: ["BTC"], cap: 25_000_000n, days: 365 }),
  createdAt: now() - 6 * DAY,
});
accounts.delete(lc(demoFollower.account));
demoFollower.account = cs(DEMO_FOLLOWER);
accounts.set(lc(DEMO_FOLLOWER), demoFollower);
demoFollower.todayStart = 25_000_000n;
demoFollower.hwm = 25_420_000n;
demoFollower.realisedByLeader.set(DEMO_LEADER.accountId, 420_000n);
const demo = { cycles: [], busy: false, dailyCap: 200, dailyUsed: 37, perIpPerHour: 6, ipHits: new Map() };
(function seedDemo() {
  const t = now() - 26 * 60e3;
  demo.cycles.push({
    id: "c-0037",
    kind: "trade",
    startedAt: t,
    status: "done",
    steps: [
      { key: "leader_open", label: "Demo leader opened 1 lot BTC long at 3x", status: "done", txHash: txHash(), at: t + 300, commitState: "finalized" },
      { key: "copy_open", label: "Copied into the team-run demo account", status: "done", txHash: txHash(), latencyMs: 612, at: t + 912, commitState: "finalized" },
      { key: "leader_close", label: "Demo leader closed", status: "done", txHash: txHash(), at: t + 20300, commitState: "finalized" },
      { key: "copy_close", label: "Copy closed", status: "done", txHash: txHash(), latencyMs: 588, at: t + 20888, commitState: "finalized" },
    ],
  });
  ev(demoFollower, "Mirrored", { leaderAccountId: DEMO_LEADER.accountId, leaderAddress: cs(DEMO_LEADER.address), perpId: 1, orderType: 0, lotLNS: "1", pricePNS: "1183990", leverageHdths: 300, notionalCNS: "1183990", latencyMs: 612 }, 26 * 60e3);
  ev(demoFollower, "Mirrored", { leaderAccountId: DEMO_LEADER.accountId, leaderAddress: cs(DEMO_LEADER.address), perpId: 1, orderType: 2, lotLNS: "1", pricePNS: "1184120", leverageHdths: 0, notionalCNS: "1184120", realisedPnlCNS: "1300", latencyMs: 588 }, 25.6 * 60e3);
})();

function demoState() {
  return {
    leader: { accountId: DEMO_LEADER.accountId, address: cs(DEMO_LEADER.address), teamRun: true },
    follower: serializeAccount(demoFollower),
    cycles: SW.demoQuiet ? [] : demo.cycles.slice(-6).reverse(),
    busy: demo.busy,
    limits: { perIpPerHour: demo.perIpPerHour, dailyCap: demo.dailyCap, dailyRemaining: demo.dailyCap - demo.dailyUsed },
  };
}

function demoRateCheck(ip) {
  const hits = (demo.ipHits.get(ip) ?? []).filter((t) => now() - t < 3600e3);
  demo.ipHits.set(ip, hits);
  if (demo.busy) return { status: 409, body: { error: "busy", message: "A demo cycle is already running. Watch it below, then try again.", retryAfterSec: 20 } };
  if (hits.length >= demo.perIpPerHour) {
    const retry = Math.ceil((3600e3 - (now() - hits[0])) / 1000);
    return { status: 429, body: { error: "rate_limited", message: `Demo limit reached: ${demo.perIpPerHour} cycles per hour from one network.`, retryAfterSec: retry } };
  }
  if (demo.dailyUsed >= demo.dailyCap) return { status: 429, body: { error: "daily_cap", message: "Today's demo budget is used up. It resets at 00:00 UTC.", retryAfterSec: 3600 } };
  hits.push(now());
  demo.dailyUsed++;
  return null;
}

function runDemo(kind) {
  demo.busy = true;
  const id = `c-${String(demo.dailyUsed).padStart(4, "0")}`;
  const t0 = now();
  const steps =
    kind === "trade"
      ? [
          { key: "leader_open", label: "Demo leader opens 1 lot BTC long at 3x", status: "pending" },
          { key: "copy_open", label: "Copy lands in the team-run demo account", status: "pending" },
          { key: "leader_close", label: "Demo leader closes after about 20 s", status: "pending" },
          { key: "copy_close", label: "Copy close follows", status: "pending" },
        ]
      : [
          { key: "leader_open", label: "Demo leader opens 1 lot BTC long at 12x", status: "pending" },
          { key: "copy_blocked", label: "Copy blocked onchain: max leverage 5x", status: "pending" },
          { key: "leader_close", label: "Demo leader closes again", status: "pending" },
        ];
  const cycle = { id, kind, startedAt: t0, status: "running", steps };
  demo.cycles.push(cycle);
  const push = () => broadcast("demo", "demo", cycle);
  push();
  const L = cs(DEMO_LEADER.address);
  const at = (ms, fn) => setTimeout(() => { fn(); push(); }, ms);
  const mark = () => markOf(1);
  if (kind === "trade") {
    at(250, () => Object.assign(steps[0], { status: "running" }));
    at(700, () => {
      Object.assign(steps[0], { status: "done", txHash: txHash(), at: now(), commitState: "finalized" });
      steps[1].status = "running";
    });
    at(1310, () => {
      const lat = 560 + Math.round(Math.random() * 120);
      demoFollower.positions.push({ perpId: 1, side: "long", lots: 1n, entry: mark(), lev: 300, leaderAccountId: DEMO_LEADER.accountId });
      const e = ev(demoFollower, "Mirrored", { leaderAccountId: DEMO_LEADER.accountId, leaderAddress: L, perpId: 1, orderType: 0, lotLNS: "1", pricePNS: mark().toString(), leverageHdths: 300, notionalCNS: notional(1, 1n, mark()).toString(), latencyMs: lat }, 0, "proposed");
      Object.assign(steps[1], { status: "done", txHash: e.txHash, latencyMs: lat, at: now(), commitState: "proposed" });
      emitEvent(demoFollower, e);
      setTimeout(() => { steps[1].commitState = "voted"; push(); }, 400);
      setTimeout(() => { steps[1].commitState = "finalized"; push(); }, 820);
      steps[2].status = "running";
    });
    at(20000, () => Object.assign(steps[2], { status: "done", txHash: txHash(), at: now(), commitState: "finalized" }));
    at(20600, () => {
      const lat = 560 + Math.round(Math.random() * 120);
      const p = demoFollower.positions.find((x) => x.perpId === 1);
      const pnl = p ? upnl(p) : 0n;
      demoFollower.positions = demoFollower.positions.filter((x) => x !== p);
      demoFollower.collateral += pnl;
      demoFollower.realisedByLeader.set(DEMO_LEADER.accountId, (demoFollower.realisedByLeader.get(DEMO_LEADER.accountId) ?? 0n) + pnl);
      const e = ev(demoFollower, "Mirrored", { leaderAccountId: DEMO_LEADER.accountId, leaderAddress: L, perpId: 1, orderType: 2, lotLNS: "1", pricePNS: mark().toString(), leverageHdths: 0, notionalCNS: notional(1, 1n, mark()).toString(), realisedPnlCNS: pnl.toString(), latencyMs: lat }, 0, "proposed");
      Object.assign(steps[3], { status: "done", txHash: e.txHash, latencyMs: lat, at: now(), commitState: "finalized" });
      emitEvent(demoFollower, e);
      cycle.status = "done";
      demo.busy = false;
    });
  } else {
    at(250, () => Object.assign(steps[0], { status: "running" }));
    at(700, () => { Object.assign(steps[0], { status: "done", txHash: txHash(), at: now(), commitState: "finalized" }); steps[1].status = "running"; });
    at(1290, () => {
      const lat = 560 + Math.round(Math.random() * 120);
      const e = ev(demoFollower, "Blocked", {
        leaderAccountId: DEMO_LEADER.accountId, leaderAddress: L, perpId: 1, orderType: 0, lotLNS: "1", pricePNS: mark().toString(), leverageHdths: 1200, leaderLotLNS: "1", leaderLeverageHdths: 1200, latencyMs: lat,
        blocked: { reason: "LeverageTooHigh", reasonCode: 6, limit: "500", actual: "1200", rule: "Max leverage 5x" },
      }, 0, "proposed");
      Object.assign(steps[1], { status: "blocked", txHash: e.txHash, latencyMs: lat, at: now(), commitState: "finalized", detail: "Blocked event emitted in its own transaction. Funds untouched." });
      emitEvent(demoFollower, e);
      steps[2].status = "running";
    });
    at(4200, () => {
      Object.assign(steps[2], { status: "done", txHash: txHash(), at: now(), commitState: "finalized" });
      cycle.status = "done";
      demo.busy = false;
    });
  }
  return id;
}

// ---------------------------------------------------------------- quote
function quote(owner, leaderAccountId, policy, accountAddr) {
  const L = leaderById[leaderAccountId];
  if (!L) return { status: 404, body: { error: "not_found", message: "Unknown leader" } };
  const rule = (policy.leaders ?? []).find((l) => Number(l.accountId) === Number(leaderAccountId)) ?? policy.leaders?.[0];
  const ratio = BigInt(rule?.ratioBps ?? 0);
  const allowed = new Map((policy.markets ?? []).map((m) => [Number(m.perpId), BigInt(m.maxNotionalCNS)]));
  const alloc = BigInt(policy.allocationCNS ?? 12_000_000);
  const existing = accountAddr ? accounts.get(lc(accountAddr)) : null;
  const rows = [];
  const orders = [];
  const skipped = [];
  let marginSum = 0n;
  for (const lp of LEADER_POSITIONS[leaderAccountId] ?? []) {
    const m = bySymbol[lp.sym];
    const leaderLots = lns(lp.sym, lp.lots);
    if (!allowed.has(m.perpId)) {
      skipped.push({ perpId: m.perpId, reason: "MarketNotAllowed" });
      continue;
    }
    const target = (leaderLots * ratio + BPS - 1n) / BPS;
    const cur = existing?.positions.find((p) => p.perpId === m.perpId && p.side === lp.side && (!p.leaderAccountId || p.leaderAccountId === leaderAccountId))?.lots ?? 0n;
    const heldBy = existing?.positions.find((p) => p.perpId === m.perpId && p.leaderAccountId && p.leaderAccountId !== leaderAccountId)?.leaderAccountId;
    const lot = target - cur;
    const mark = m.markPNS;
    const slip = BigInt(policy.maxSlippageBps ?? 50);
    const isLong = lp.side === "long";
    const bound = isLong ? (mark * (BPS + slip)) / BPS : (mark * (BPS - slip) + BPS - 1n) / BPS;
    const fill = isLong ? (mark * 10_002n) / BPS : (mark * 9_998n) / BPS;
    const notl = notional(m.perpId, lot > 0n ? lot : 0n, mark);
    const margin = (notl * 100n) / BigInt(lp.lev);
    let wouldBlock = null;
    if (heldBy) wouldBlock = { reason: "MarketHeldByOtherLeader", limit: String(leaderAccountId), actual: String(heldBy), rule: `${lp.sym} is held by ${leaderById[heldBy] ? leaderById[heldBy].address.slice(0, 6) + "…" + leaderById[heldBy].address.slice(-4) : "Perpl #" + heldBy}` };
    else if (lot <= 0n) wouldBlock = { reason: "BelowOneLot", limit: "1", actual: "0", rule: `Rounds to 0 lots at this ratio. Smallest ${lp.sym} order is ${(1 / 10 ** m.lotDecimals).toFixed(m.lotDecimals)} ${lp.sym}` };
    else if (lp.lev > policy.maxLeverageHdths) wouldBlock = { reason: "LeverageTooHigh", limit: String(policy.maxLeverageHdths), actual: String(lp.lev), rule: `Max leverage ${policy.maxLeverageHdths / 100}x` };
    else if (notl > allowed.get(m.perpId)) wouldBlock = { reason: "ExceedsMaxNotional", limit: allowed.get(m.perpId).toString(), actual: notl.toString(), rule: `Copy would be ${fmtCns(notl)} AUSD. Max per market ${fmtCns(allowed.get(m.perpId))}` };
    else if (marginSum + margin > alloc) wouldBlock = { reason: "InsufficientMargin", limit: (alloc - marginSum).toString(), actual: margin.toString(), rule: `Needs ${fmtCns(margin)} AUSD margin, ${fmtCns(alloc - marginSum)} left in this follow` };
    if (!wouldBlock) marginSum += margin;
    const row = {
      perpId: m.perpId,
      orderType: isLong ? 0 : 1,
      lotLNS: (lot > 0n ? lot : 0n).toString(),
      sizeDisplay: `${(Number(lot > 0n ? lot : 0n) / 10 ** m.lotDecimals).toFixed(m.lotDecimals)} ${lp.sym}`,
      markPNS: mark.toString(),
      pricePNS: bound.toString(),
      expectedFillPNS: fill.toString(),
      notionalCNS: notl.toString(),
      marginCNS: margin.toString(),
      leverageHdths: lp.lev,
      leaderLotLNS: leaderLots.toString(),
      wouldBlock,
    };
    rows.push(row);
    // Onchain-checkable blocks are still sent so the contract records a Blocked event; pre-trade ones are not.
    if (!wouldBlock || ["LeverageTooHigh", "ExceedsMaxNotional", "MarketHeldByOtherLeader"].includes(wouldBlock.reason)) {
      orders.push({ leaderAccountId, perpId: m.perpId, orderType: row.orderType, lotLNS: row.lotLNS, pricePNS: row.pricePNS, leverageHdths: lp.lev, maxMatches: 100, leaderRef: "0x" + "0".repeat(64) });
    }
  }
  const ordersEncoded = encodeAbiParameters([MIRROR_ORDERS_PARAM], [orders.map((o) => ({ ...o, lotLNS: BigInt(o.lotLNS), pricePNS: BigInt(o.pricePNS) }))]);
  return { status: 200, body: { leaderAccountId, rows, orders, ordersEncoded, skipped, quotedAt: now() } };
}

// ---------------------------------------------------------------- relay
function relayResult(extra = {}) {
  return { txHash: txHash(), status: "success", block: ++block, gasUsed: String(180_000 + Math.floor(Math.random() * 90_000)), latencyMs: 380 + Math.floor(Math.random() * 300), commitState: "proposed", ...extra };
}
const err = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra } });

async function relayCreate({ owner, salt }) {
  const o = ownerState(owner);
  const addr = predictAccount(FACTORY, IMPLEMENTATION, cs(owner), salt);
  let a = accounts.get(lc(addr));
  if (!a) a = newAccount(owner, salt, { createdAt: now() });
  await sleep(500);
  void o;
  return { status: 200, body: relayResult({ account: a.account }) };
}

async function relayDeposit(b) {
  const a = accounts.get(lc(b.account));
  if (!a) return err(404, "not_found", "Account not deployed");
  const o = ownerState(a.owner);
  const amount = BigInt(b.amount);
  const sig = toSig(b);
  let signer;
  if (b.mode === "permit") {
    signer = await recoverTypedDataAddress({ ...permitTypedData(AUSD, CHAIN_ID, { owner: a.owner, spender: a.account, value: amount, nonce: o.permitNonce, deadline: BigInt(b.deadline) }), signature: sig });
  } else {
    if (o.used3009.has(b.nonce)) return err(400, "AuthorizationUsed", "Authorization already used", { revertReason: "AuthorizationUsedOrCanceled" });
    signer = await recoverTypedDataAddress({ ...receiveAuthTypedData(AUSD, CHAIN_ID, { from: a.owner, to: a.account, value: amount, validAfter: BigInt(b.validAfter), validBefore: BigInt(b.validBefore), nonce: b.nonce }), signature: sig });
  }
  if (lc(signer) !== lc(a.owner)) return err(400, "BadSignature", "Signature is not from the account owner", { revertReason: "ERC2612InvalidSigner" });
  if (amount > o.wallet) return err(400, "InsufficientBalance", "Not enough AUSD in your wallet", { revertReason: "ERC20InsufficientBalance" });
  if (a.netDeposits + amount > CAP) return err(400, "DepositCapExceeded", `Beta limit is 25 AUSD per follow`, { revertReason: `DepositCapExceeded(${CAP}, ${a.netDeposits + amount})` });
  if (!a.perplAccountId && amount < MIN_OPEN) return err(400, "BelowMinimumAccountOpen", "Perpl needs at least 10 AUSD to open the account", { revertReason: `BelowMinimumAccountOpen(${MIN_OPEN}, ${amount})` });
  if (b.mode === "permit") o.permitNonce++;
  else o.used3009.add(b.nonce);
  o.wallet -= amount;
  a.collateral += amount;
  a.netDeposits += amount;
  a.todayStart += amount;
  a.hwm += amount;
  if (!a.perplAccountId) a.perplAccountId = 13400 + accounts.size;
  await sleep(450);
  const r = relayResult();
  const e = ev(a, "Deposited", { amountCNS: amount.toString(), txHash: r.txHash }, 0, "proposed");
  e.txHash = r.txHash;
  emitEvent(a, e);
  return { status: 200, body: r };
}

function toSig(b) {
  const v = Number(b.v);
  return `${b.r}${b.s.slice(2)}${v.toString(16).padStart(2, "0")}`;
}

async function relayExecute({ account, action, signature }) {
  const a = accounts.get(lc(account));
  if (!a) return err(404, "not_found", "Account not deployed");
  if (BigInt(action.deadline) < BigInt(Math.floor(now() / 1000))) return err(400, "ActionExpired", "This approval expired. Sign again.", { revertReason: "ActionExpired()" });
  if (BigInt(action.nonce) !== a.actionNonce) return err(400, "BadNonce", "Out of date. Refresh and sign again.", { revertReason: "BadNonce()" });
  const msg = { kind: Number(action.kind), data: action.data, nonce: BigInt(action.nonce), deadline: BigInt(action.deadline) };
  const signer = await recoverTypedDataAddress({ ...actionTypedData(a.account, CHAIN_ID, msg), signature });
  if (lc(signer) !== lc(a.owner)) return err(400, "BadSignature", "Signature is not from the account owner", { revertReason: "BadSignature()" });
  await sleep(500);
  const r = relayResult();
  const events = [];
  const kind = msg.kind;
  try {
    if (kind === ACTION.SET_POLICY || kind === ACTION.FOLLOW) {
      let p, orders = [];
      if (kind === ACTION.FOLLOW) {
        const [pp, oo] = decodeAbiParameters([POLICY_PARAM, MIRROR_ORDERS_PARAM], msg.data);
        p = pp; orders = oo;
      } else {
        [p] = decodeAbiParameters([POLICY_PARAM], msg.data);
      }
      const policy = {
        maxLeverageHdths: Number(p.maxLeverageHdths), maxSlippageBps: Number(p.maxSlippageBps), dailyLossBps: Number(p.dailyLossBps), drawdownBps: Number(p.drawdownBps), expiry: Number(p.expiry),
        maxEntryDeviationBps: Number(p.maxEntryDeviationBps), stopSlippageBps: Number(p.stopSlippageBps), flattenOnStop: !!p.flattenOnStop, maxBuilderFeePer100K: Number(p.maxBuilderFeePer100K),
        leaders: p.leaders.map((l) => ({ accountId: Number(l.accountId), ratioBps: Number(l.ratioBps), budgetCNS: l.budgetCNS.toString(), lossStopBps: Number(l.lossStopBps) })),
        markets: p.markets.map((m) => ({ perpId: Number(m.perpId), maxNotionalCNS: m.maxNotionalCNS.toString() })),
      };
      if (policy.maxSlippageBps === 0 || policy.maxSlippageBps > 1000) return err(400, "InvalidPolicy", "Invalid policy: maxSlippageBps", { revertReason: 'InvalidPolicy("maxSlippageBps")' });
      if (policy.expiry <= now() / 1000) return err(400, "InvalidPolicy", "Invalid policy: expiry", { revertReason: 'InvalidPolicy("expiry")' });
      applyPolicyLeaders(a, a.policy?.leaders ?? [], policy.leaders);
      a.policy = policy;
      // A new policy lifts every halt a fired level set (MirrorAccount._setPolicy rebuilds the markets).
      stops.haltedOf(a).clear();
      if (a.detached) {
        a.detached = false;
        events.push(ev(a, "Detached", { txHash: null, onchain: false, label: "Following again", data: { detached: false, label: "Following again", reason: "policy" } }, 0, "offchain"));
      }
      a.leaderAccountId = policy.leaders[0]?.accountId ?? a.leaderAccountId;
      if (kind === ACTION.FOLLOW) a.paused = false;
      const pe = ev(a, kind === ACTION.FOLLOW ? "Followed" : "PolicyUpdated", { leaderAccountId: a.leaderAccountId, leaderAddress: leaderById[a.leaderAccountId] ? cs(leaderById[a.leaderAccountId].address) : undefined }, 0, "proposed");
      pe.txHash = r.txHash;
      events.push(pe);
      const executed = [];
      for (const o of orders) {
        const m = byPerp[Number(o.perpId)];
        const mark = m.markPNS;
        const cap = BigInt(policy.markets.find((x) => x.perpId === Number(o.perpId))?.maxNotionalCNS ?? 0);
        const lots = BigInt(o.lotLNS);
        const notl = notional(m.perpId, lots, mark);
        const base = { leaderAccountId: Number(o.leaderAccountId), leaderAddress: leaderById[Number(o.leaderAccountId)] ? cs(leaderById[Number(o.leaderAccountId)].address) : undefined, perpId: m.perpId, orderType: Number(o.orderType), lotLNS: lots.toString(), pricePNS: o.pricePNS.toString(), leverageHdths: Number(o.leverageHdths), matchNow: true, latencyMs: r.latencyMs };
        let block = null;
        if (cap === 0n) block = { reason: "MarketNotAllowed", limit: "0", actual: String(m.perpId), rule: `${m.symbol} is not in your allowed markets` };
        else if (Number(o.leverageHdths) > policy.maxLeverageHdths) block = { reason: "LeverageTooHigh", limit: String(policy.maxLeverageHdths), actual: String(o.leverageHdths), rule: `Max leverage ${policy.maxLeverageHdths / 100}x` };
        else if (notl > cap) block = { reason: "ExceedsMaxNotional", limit: cap.toString(), actual: notl.toString(), rule: `Copy would be ${fmtCns(notl)} AUSD. Max per market ${fmtCns(cap)}` };
        else block = leaderBlock(a, o, { marginOf, upnl, notionalAt: (perpId, l) => notional(perpId, l, byPerp[perpId].markPNS) });
        if (block) {
          const be = ev(a, "Blocked", { ...base, leaderLotLNS: base.lotLNS, leaderLeverageHdths: base.leverageHdths, blocked: { ...block, reasonCode: BLOCK_REASONS.indexOf(block.reason) } }, 0, "proposed");
          be.txHash = r.txHash;
          events.push(be);
          executed.push(false);
          continue;
        }
        const side = Number(o.orderType) === 0 ? "long" : "short";
        const fill = side === "long" ? (mark * 10_002n) / BPS : (mark * 9_998n) / BPS;
        a.positions.push({ perpId: m.perpId, side, lots, entry: fill, lev: Number(o.leverageHdths), leaderAccountId: Number(o.leaderAccountId) });
        const me = ev(a, "Mirrored", { ...base, pricePNS: fill.toString(), notionalCNS: notl.toString() }, 0, "proposed");
        me.txHash = r.txHash;
        events.push(me);
        executed.push(true);
      }
      r.result = encodeAbiParameters([{ type: "bool[]" }], [executed]);
      r.executed = executed;
    } else if (kind === ACTION.SET_PAUSED) {
      const [p] = decodeAbiParameters([{ type: "bool" }], msg.data);
      a.paused = p;
      const e = ev(a, "Paused", { paused: p }, 0, "proposed");
      e.txHash = r.txHash;
      events.push(e);
    } else if (kind === ACTION.CLOSE_ALL) {
      const [s] = decodeAbiParameters([{ type: "uint16" }], msg.data);
      if (s === 0 || s > 2000) return err(400, "InvalidPolicy", "Invalid slippage", { revertReason: 'InvalidPolicy("slippageBps")' });
      a.paused = true;
      let n = 0;
      for (const p of a.positions) {
        const pnl = upnl(p);
        a.collateral += pnl;
        a.realisedByLeader.set(p.leaderAccountId, (a.realisedByLeader.get(p.leaderAccountId) ?? 0n) + pnl);
        n++;
      }
      a.positions = [];
      const e = ev(a, "ClosedAll", { positionsClosed: n }, 0, "proposed");
      e.txHash = r.txHash;
      events.push(e);
    } else if (kind === ACTION.WITHDRAW) {
      const [amt] = decodeAbiParameters([{ type: "uint256" }], msg.data);
      const s = serializeAccount(a);
      if (amt > BigInt(s.withdrawableCNS)) return err(400, "InsufficientCollateral", "More than the withdrawable amount", { revertReason: "InsufficientFreeCollateral" });
      a.collateral -= amt;
      a.netDeposits = amt >= a.netDeposits ? 0n : a.netDeposits - amt;
      a.todayStart -= amt;
      a.hwm -= amt;
      ownerState(a.owner).wallet += amt;
      const e = ev(a, "Withdrawn", { amountCNS: amt.toString() }, 0, "proposed");
      e.txHash = r.txHash;
      events.push(e);
    } else if (kind === ACTION.SET_LEVELS || kind === ACTION.CLOSE_MARKET) {
      const out = kind === ACTION.SET_LEVELS ? stops.actSetLevels(a, msg.data) : stops.actCloseMarket(a, msg.data);
      if (out.error) return err(400, "Reverted", out.error, { revertReason: out.error });
      for (const e of out.events) {
        e.txHash = r.txHash;
        events.push(e);
      }
    } else if (kind === ACTION.MATCH_NOW || kind === ACTION.SWEEP || kind === ACTION.EXCHANGE_CALL) {
      // accepted, no state change in the mock
    } else {
      return err(400, "UnknownAction", `Unknown action ${kind}`, { revertReason: `UnknownAction(${kind})` });
    }
  } catch (e) {
    return err(400, "DecodeFailed", String(e?.message ?? e), { revertReason: "abi decode failed" });
  }
  a.actionNonce++;
  for (const e of events.slice().reverse()) emitEvent(a, e);
  return { status: 200, body: { ...r, events } };
}

async function relayTransfer(b) {
  const o = ownerState(b.from);
  const m = { from: cs(b.from), to: cs(b.to), value: BigInt(b.value), validAfter: BigInt(b.validAfter), validBefore: BigInt(b.validBefore), nonce: b.nonce };
  const signer = await recoverTypedDataAddress({ ...transferAuthTypedData(AUSD, CHAIN_ID, m), signature: toSig(b) });
  if (lc(signer) !== lc(b.from)) return err(400, "BadSignature", "Signature is not from the sender", { revertReason: "FiatTokenV2: invalid signature" });
  if (o.used3009.has(b.nonce)) return err(400, "AuthorizationUsed", "Authorization already used");
  if (m.value > o.wallet) return err(400, "InsufficientBalance", "Not enough AUSD in your wallet");
  o.used3009.add(b.nonce);
  o.wallet -= m.value;
  const dest = owners.get(lc(b.to));
  if (dest) dest.wallet += m.value;
  await sleep(450);
  return { status: 200, body: relayResult() };
}

// ---------------------------------------------------------------- JSON-RPC (reads only)
const RPC_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function actionNonce() view returns (uint256)",
  "function netDeposits() view returns (uint256)",
  "function predictAccount(address owner, bytes32 salt) view returns (address)",
]);
function rpc(req) {
  const ok = (result) => ({ jsonrpc: "2.0", id: req.id, result });
  switch (req.method) {
    case "eth_chainId":
      return ok(toHex(CHAIN_ID));
    case "eth_blockNumber":
      return ok(toHex(block));
    case "net_version":
      return ok(String(CHAIN_ID));
    case "eth_getLogs":
      return ok(rpcGetLogs(accounts, req.params[0]));
    case "eth_call": {
      const { to, data } = req.params[0];
      if (data?.startsWith(EQUITY_SELECTOR) && accounts.get(lc(to))) return ok(encodeAbiParameters([{ type: "uint256" }], [equity(accounts.get(lc(to)))]));
      const enc = (v) => encodeAbiParameters([{ type: "uint256" }], [v]);
      try {
        const d = decodeFunctionData({ abi: RPC_ABI, data });
        if (lc(to) === lc(AUSD) && d.functionName === "balanceOf") {
          const who = lc(d.args[0]);
          const o = owners.get(who);
          const a = accounts.get(who);
          return ok(enc(o ? o.wallet : a ? 0n : 0n));
        }
        if (lc(to) === lc(FACTORY) && d.functionName === "predictAccount") return ok(encodeAbiParameters([{ type: "address" }], [predictAccount(FACTORY, IMPLEMENTATION, d.args[0], d.args[1])]));
        if (lc(to) === lc(AUSD) && d.functionName === "nonces") return ok(enc(owners.get(lc(d.args[0]))?.permitNonce ?? 0n));
        const a = accounts.get(lc(to));
        if (a && d.functionName === "actionNonce") return ok(enc(a.actionNonce));
        if (a && d.functionName === "netDeposits") return ok(enc(a.netDeposits));
      } catch {}
      return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "execution reverted" } };
    }
    default:
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not supported by mock" } };
  }
}

// ---------------------------------------------------------------- leaders
function leaderSummary(l, window = "30d") {
  const c = leaderCurve(l, window);
  const ret = window === "30d" ? l.r30 : window === "7d" ? l.r7 : l.r90;
  return {
    accountId: l.accountId,
    address: cs(l.address),
    score: l.score,
    pnlUsd: Math.round(c.pnl),
    pnlPct: l.key === "c" && window === "30d" ? Math.round(c.ret * 10) / 10 : ret,
    maxDrawdownPct: l.key === "c" && window === "30d" ? c.drawdown.pct : l.dd,
    winRate: l.win,
    avgLeverage: l.lev,
    trades: window === "7d" ? Math.round(l.trades / 4.3) : window === "90d" ? l.trades * 3 : l.trades,
    markets: l.mk,
    followers: l.fol,
    nansen: { labels: l.labels },
    teamRun: false,
    adversarial: adversarialFor(l.accountId),
    spark: spark(l),
  };
}
function leaderProfile(l, window) {
  const c = leaderCurve(l, window);
  const s = leaderSummary(l, window);
  const share = { c: [["HYPE", 41], ["SOL", 27], ["MON", 18], ["BTC", 14]], a: [["BTC", 46], ["SOL", 31], ["ETH", 23]], b: [["BTC", 62], ["ETH", 38]], e: [["ZEC", 58], ["ETH", 42]], d: [["BTC", 55], ["ETH", 29], ["ZEC", 16]], f: [["SOL", 44], ["MON", 35], ["PUMP", 21]] }[l.key];
  const days = 30;
  let x = l.accountId;
  const tpd = Array.from({ length: days }, (_, i) => {
    x = (x * 16807) % 2147483647;
    const base = l.freq + ((x / 2147483647) - 0.5) * l.freq * 0.9 + (i > 10 && i < 16 && l.key === "c" ? 6 : 0);
    return { t: Date.UTC(2026, 8, 6) + i * DAY, n: Math.max(1, Math.round(base)) };
  });
  const flags = [];
  if (l.lev >= 6) flags.push({ kind: "warn", title: "High leverage", detail: `Averages ${l.lev}x and reached ${l.peak}x (Perpl's BTC maximum) twice in 30 days. A 5x max leverage rule would block those trades.` });
  if (s.maxDrawdownPct >= 15) flags.push({ kind: "warn", title: "Deep drawdown", detail: `Lost ${s.maxDrawdownPct}% from peak in ${c.drawdown.days} days.` });
  if (share[0][1] >= 40) flags.push({ kind: "info", title: "Concentrated", detail: `${share[0][1]}% of volume in ${share[0][0]}.` });
  if (l.labels.includes("Fund")) flags.push({ kind: "info", title: "Fund wallet", detail: "Large positions: at small allocations most copies round to the minimum lot or below it." });
  flags.push({ kind: "ok", title: "Established wallet", detail: l.key === "f" ? "Active since Aug 2026 on Perpl, 1 other venue." : "Active 2+ years across tracked venues." });
  const n = NANSEN[l.accountId] ?? { notes: l.labels.map((x) => ({ label: x, text: "Nansen label" })), venues: [{ venue: "Perpl", since: l.since, realisedPnlUsd: Math.round(c.pnl) }] };
  const posns = (LEADER_POSITIONS[l.accountId] ?? []).map((p) => {
    const m = bySymbol[p.sym];
    const lots = lns(p.sym, p.lots);
    const entry = pns(p.sym, p.entry);
    const diff = p.side === "long" ? m.markPNS - entry : entry - m.markPNS;
    return { perpId: m.perpId, side: p.side, lotLNS: lots.toString(), entryPNS: entry.toString(), markPNS: m.markPNS.toString(), leverageHdths: p.lev, pnlUsd: Math.round(Number(notional(m.perpId, lots, diff < 0n ? -diff : diff)) / 1e6) * (diff < 0n ? -1 : 1) };
  });
  return {
    ...s,
    nansen: { labels: l.labels, notes: n.notes, venues: n.venues },
    since: l.since,
    equityCurve: c.points,
    drawdown: c.drawdown,
    stats: { profitFactor: { a: 1.94, b: 2.31, c: 1.62, d: 1.28, e: 2.05, f: 1.17 }[l.key], largestLossUsd: -Math.round(l.eq0 * 0.07), peakLeverage: l.peak, tradesPerDay: l.freq, avgHoldMinutes: { a: 95, b: 1260, c: 220, d: 410, e: 380, f: 70 }[l.key] },
    marketShare: share.map(([symbol, pct]) => ({ symbol, pct })),
    tradesPerDay: tpd,
    positions: posns,
    recentTrades: posns.map((p, i) => ({ perpId: p.perpId, side: p.side, action: "open", lotLNS: p.lotLNS, pricePNS: p.entryPNS, leverageHdths: p.leverageHdths, timestamp: now() - (i + 1) * 47 * 60e3, txHash: txHash() })),
    riskFlags: flags,
    updatedAt: now() - 2 * 60e3,
  };
}

// ---------------------------------------------------------------- HTTP
function replacer(_k, v) {
  return typeof v === "bigint" ? v.toString() : v;
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers });
  res.end(JSON.stringify(body, replacer));
}
async function readBody(req) {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const ip = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "local";
  const t0 = Date.now();
  res.on("finish", () => {
    if (!p.startsWith("/v1/stream")) console.log(`${req.method} ${p}${url.search} -> ${res.statusCode} ${Date.now() - t0}ms`);
  });
  if (req.method === "OPTIONS") return send(res, 204, {}, { "Access-Control-Allow-Methods": "GET,POST,PUT", "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID, Cache-Control" });
  try {
    if (p.startsWith("/v1/") && SW.backend === "down") return req.socket.destroy();
    if (p.startsWith("/v1/") && SW.backend === "slow") await sleep(60_000);
    if (p === "/rpc" && SW.rpc === "down") return req.socket.destroy();
    if (NET_DELAY && !p.startsWith("/v1/stream") && p !== "/rpc") await sleep(NET_DELAY);
    let m;
    // ---- SSE
    if (req.method === "GET" && p === "/v1/stream") {
      const keys = new Set((url.searchParams.get("account") ?? "").split(",").map(lc).filter(Boolean));
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
      res.write(`: connected ${[...keys].join(",")}\n\n`);
      res.write(`event: hello\ndata: ${JSON.stringify({ channel: [...keys].join(","), block })}\n\n`);
      const c = { res, keys };
      clients.add(c);
      req.on("close", () => clients.delete(c));
      return;
    }
    if (req.method === "GET" && p === "/v1/health")
      return send(res, 200, { ok: true, chainId: CHAIN_ID, block, keeper: { address: KEEPER, balanceWei: "41200000000000000000" }, relayer: { address: KEEPER, balanceWei: "88400000000000000000", pending: 0 }, perpl: { wsConnected: true, lastMarkAt: now() - 900 }, indexer: { lagBlocks: 1 } });
    if (req.method === "GET" && p === "/v1/config") {
      const base = `http://${req.headers.host}`;
      return send(res, 200, {
        chainId: CHAIN_ID,
        rpc: `${base}/rpc`,
        explorerTx: MAINNET.explorerTx,
        explorerAddress: MAINNET.explorerAddress,
        contracts: { factory: FACTORY, keeperRegistry: KEEPER, perplExchange: MAINNET.perplExchange, collateral: AUSD, deployBlock: 75_000_000 },
        builder: { id: 26, feePer100K: 20, appliesTo: "opening size only" },
        keepers: [KEEPER],
        relayer: KEEPER,
        collateralDecimals: 6,
        depositCapCNS: CAP.toString(),
        perplMinAccountOpenCNS: MIN_OPEN.toString(),
        markets: markets.map((m) => ({ perpId: m.perpId, symbol: m.symbol, lotDecimals: m.lotDecimals, priceDecimals: m.priceDecimals, markPNS: m.markPNS.toString(), minOrderLots: 1, minOrderSize: (1 / 10 ** m.lotDecimals).toFixed(m.lotDecimals), minPostingCNS: "0", isOpen: true })),
        teamRun: { addresses: [cs(DEMO_LEADER.address), cs(DEMO_FOLLOWER)], demoLeaderAccountId: DEMO_LEADER.accountId, demoFollowerAccount: cs(DEMO_FOLLOWER) },
      });
    }
    if (req.method === "GET" && p === "/v1/markets")
      return send(res, 200, wireMarkets(markets.map((m) => ({ perpId: m.perpId, symbol: m.symbol, markPNS: m.markPNS, oraclePNS: m.markPNS, fundingRateBps: 0.6, openInterestLNS: "0", bestBidPNS: (m.markPNS * 9_999n) / BPS, bestAskPNS: (m.markPNS * 10_001n) / BPS, change24hPct: 1.2 }))));
    if (req.method === "GET" && p === "/v1/leaders") {
      const window = url.searchParams.get("window") ?? "30d";
      const sort = url.searchParams.get("sort") ?? "score";
      const market = url.searchParams.get("market");
      let list = LEADERS.map((l) => leaderSummary(l, window));
      if (market) list = list.filter((l) => l.markets.includes(market));
      list.sort((a, b) => (sort === "pnl" ? b.pnlPct - a.pnlPct : sort === "drawdown" ? a.maxDrawdownPct - b.maxDrawdownPct : b.score - a.score));
      return send(res, 200, { source: "indexer", nansenSource: "mock", window, sort, leaders: list.map(wireLeaderSummary) });
    }
    if (req.method === "GET" && p === "/v1/stats/copy-quality") return send(res, 200, copyQuality(accounts.values(), url.searchParams.get("period") ?? "30d"));
    if (req.method === "GET" && (m = p.match(/^\/v1\/leaders\/(\d+)\/copy-quality$/))) return send(res, 200, copyQuality(accounts.values(), url.searchParams.get("period") ?? "30d", Number(m[1])));
    if (req.method === "POST" && (m = p.match(/^\/v1\/leaders\/(\d+)\/backtest$/))) {
      const r = backtest(Number(m[1]), await readBody(req));
      return send(res, r.status, r.body);
    }
    if (req.method === "GET" && (m = p.match(/^\/v1\/leaders\/(\d+)$/))) {
      const l = leaderById[Number(m[1])];
      if (!l) return send(res, 404, { error: "not_found", message: "Unknown leader" });
      const w = url.searchParams.get("window") ?? "30d";
      return send(res, 200, { ...wireLeaderProfile(leaderProfile(l, w), w, sym), adversarial: adversarialFor(l.accountId) });
    }
    if (req.method === "GET" && (m = p.match(/^\/v1\/owners\/(0x[0-9a-fA-F]{40})\/accounts$/))) {
      const o = ownerState(m[1]);
      const list = [...accounts.values()].filter((a) => lc(a.owner) === lc(m[1]) && !a.teamRun).sort((x, y) => x.createdAt - y.createdAt);
      return send(res, 200, wireOwnerAccounts(o.owner, list.map(serializeAccount), predictAccount(FACTORY, IMPLEMENTATION, cs(m[1]), "0x" + "0".repeat(64))));
    }
    if (req.method === "GET" && (m = p.match(/^\/v1\/accounts\/(0x[0-9a-fA-F]{40})$/))) {
      const a = accounts.get(lc(m[1]));
      if (!a) return send(res, 404, { error: "not_found", message: "Unknown account" });
      return send(res, 200, wireAccount(serializeAccount(a)));
    }
    if (req.method === "GET" && (m = p.match(/^\/v1\/accounts\/(0x[0-9a-fA-F]{40})\/feed$/))) {
      const a = accounts.get(lc(m[1]));
      if (!a) return send(res, 404, { error: "not_found", message: "Unknown account" });
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      const src = a.teamRun && SW.demoQuiet ? a.feed.map((e) => ({ ...e, timestamp: e.timestamp - 2.2 * 3600e3 })) : a.feed;
      const page = src.slice(cursor, cursor + 30);
      return send(res, 200, wireFeedPage(page, cursor + 30 < a.feed.length ? cursor + 30 : null));
    }
    if (req.method === "GET" && (m = p.match(/^\/v1\/accounts\/(0x[0-9a-fA-F]{40})\/stops$/))) {
      const a = accounts.get(lc(m[1]));
      return send(res, 200, a ? stops.stopsFor(a) : { items: [] });
    }
    if (req.method === "POST" && (m = p.match(/^\/v1\/accounts\/(0x[0-9a-fA-F]{40})\/detach$/))) {
      // Engine: owner-signed Detach(bool detached,uint256 deadline) in the account's domain (services/detach.ts).
      const a = accounts.get(lc(m[1]));
      if (!a) return send(res, 404, { error: "Unknown account", code: "unknown_account" });
      const b = await readBody(req);
      const deadline = BigInt(b.deadline);
      const nowS = BigInt(Math.floor(now() / 1000));
      if (deadline < nowS) return send(res, 400, { error: "This approval expired. Sign again.", code: "expired" });
      if (deadline > nowS + 3600n) return send(res, 400, { error: "Deadline more than 3600 s ahead", code: "deadline_too_far" });
      if (a.detachDeadline !== undefined && deadline <= a.detachDeadline) return send(res, 409, { error: "This approval was already used. Sign again.", code: "replayed" });
      const signer = await recoverTypedDataAddress({ ...detachTypedData(a.account, CHAIN_ID, !!b.detached, deadline), signature: b.signature }).catch(() => null);
      if (!signer) return send(res, 400, { error: "Signature does not decode", code: "bad_signature" });
      if (lc(signer) !== lc(a.owner)) return send(res, 401, { error: "Signature is not from the account owner", code: "not_owner" });
      a.detached = !!b.detached;
      a.detachDeadline = deadline;
      const label = a.detached ? "Stopped following; positions kept" : "Following again";
      emitEvent(a, ev(a, "Detached", { txHash: null, onchain: false, label, data: { detached: a.detached, label, reason: "signed" } }, 0, "offchain"));
      return send(res, 200, { account: a.account, detached: a.detached, block });
    }
    if (req.method === "GET" && p === "/v1/stats") {
      const user = [...accounts.values()].filter((a) => !a.teamRun);
      return send(res, 200, { accountsCreated: user.length + 41, fundedAccounts: user.length + 29, netAusdDepositedCNS: "512400000", copiesExecuted: 1840, copiesBlocked: { LeverageTooHigh: 61, MarketNotAllowed: 22, ExceedsMaxNotional: 17, DailyLossStop: 4, DrawdownStop: 2 }, medianLatencyMs: 604, activeFollowers7d: 33, copies: [] });
    }
    if (req.method === "GET" && p === "/v1/demo") return send(res, 200, wireDemo(demoState()));
    if (req.method === "POST" && p === "/v1/quote/follow") {
      const b = await readBody(req);
      const r = quote(b.owner, Number(b.leaderAccountId), b.policy ?? {}, b.account);
      return send(res, r.status, r.status === 200 ? wireQuote(r.body, b.owner) : r.body);
    }
    if (req.method === "POST" && p === "/v1/relay/create") {
      const r = await relayCreate(await readBody(req));
      return send(res, r.status, r.body);
    }
    if (req.method === "POST" && p === "/v1/relay/deposit") {
      const r = await relayDeposit(await readBody(req));
      return send(res, r.status, r.body);
    }
    if (req.method === "POST" && p === "/v1/relay/execute") {
      const r = await relayExecute(await readBody(req));
      return send(res, r.status, r.body);
    }
    if (req.method === "POST" && p === "/v1/relay/transfer") {
      const r = await relayTransfer(await readBody(req));
      return send(res, r.status, r.body);
    }
    if (req.method === "POST" && (p === "/v1/demo/trade" || p === "/v1/demo/blocked")) {
      const lim = demoRateCheck(ip);
      if (lim) return send(res, lim.status, lim.body, lim.body.retryAfterSec ? { "Retry-After": String(lim.body.retryAfterSec) } : {});
      return send(res, 200, { cycleId: runDemo(p.endsWith("trade") ? "trade" : "blocked") });
    }
    if ((p.startsWith("/v1/share") || p.endsWith("/share") || p === "/__mock/suggest" || p === "/__mock/link" || p === "/__mock/endlink") && (await share.route(req, res, p))) return;
    if (req.method === "GET" && p === "/v1/push/config") return send(res, 200, { webPush: null, fcm: false, expo: false, sse: true, chainId: CHAIN_ID });
    if (req.method === "POST" && p === "/v1/push/register") {
      const b = await readBody(req);
      // Owner-signed PushRegister, as the engine (services/pushauth.ts).
      const [ch, target] = b.webPush ? ["webpush", b.webPush.endpoint] : b.fcmToken ? ["fcm", b.fcmToken] : ["app", ""];
      const signer = b.signature ? await recoverTypedDataAddress({ ...pushRegisterTypedData(CHAIN_ID, b.owner, b.notifyPublicKey, ch, target, BigInt(b.deadline ?? 0)), signature: b.signature }).catch(() => null) : null;
      if (!signer || lc(signer) !== lc(b.owner)) return send(res, 401, { error: "Signature is not from the owner", code: "not_owner" });
      const o = ownerState(b.owner);
      o.notifyPub = b.notifyPublicKey;
      o.pushToken = b.expoPushToken ?? null;
      return send(res, 200, { ok: true, owner: cs(b.owner), channels: ["sse"] });
    }
    if (req.method === "POST" && p === "/v1/push/unregister") return send(res, 200, { ok: true, removed: 0 });
    if (req.method === "PUT" && p === "/v1/notes") {
      const b = await readBody(req);
      if (!notes.has(lc(b.owner))) notes.set(lc(b.owner), new Map());
      notes.get(lc(b.owner)).set(lc(b.account), b.note);
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && (m = p.match(/^\/v1\/notes\/(0x[0-9a-fA-F]{40})$/))) {
      const n = notes.get(lc(m[1])) ?? new Map();
      return send(res, 200, { notes: [...n.entries()].map(([account, note]) => ({ account: cs(account), note })) });
    }
    if (req.method === "POST" && p === "/rpc") {
      const b = await readBody(req);
      return send(res, 200, Array.isArray(b) ? b.map(rpc) : rpc(b));
    }
    // ---- mock admin (screenshots / E2E)
    if (req.method === "POST" && p === "/__mock/scenario") {
      const b = await readBody(req);
      if (b.default) defaultScenario = b.default;
      if (b.owner) seedOwner(b.owner, b.scenario ?? defaultScenario);
      if (b.all) for (const k of [...owners.keys()]) seedOwner(k, b.scenario ?? defaultScenario);
      return send(res, 200, { ok: true, defaultScenario });
    }
    if (req.method === "POST" && p === "/__mock/switch") return send(res, 200, setSwitches(await readBody(req)));
    if (req.method === "POST" && p === "/__mock/push") {
      const b = await readBody(req);
      const a = [...accounts.values()].find((x) => lc(x.owner) === lc(b.owner) && x.feed.some((e) => e.kind === (b.kind ?? "Blocked")));
      if (!a) return send(res, 404, { error: "none" });
      pushFor(a, a.feed.find((e) => e.kind === (b.kind ?? "Blocked")));
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/__mock/stops") {
      const b = await readBody(req);
      for (const a of accounts.values()) if (lc(a.owner) === lc(b.owner) && a.leaderAccountId === Number(b.leaderAccountId ?? 1588)) a.todayStart = equity(a) * 2n;
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/__mock/trigger") {
      // A stranger executes a level: {owner, perpId, keeper?} (the mark is moved to the level first).
      const b = await readBody(req);
      const a = [...accounts.values()].find((x) => lc(x.owner) === lc(b.owner) && stops.levelsOf(x).has(Number(b.perpId)));
      if (!a) return send(res, 404, { error: "no level" });
      const lv = stops.levelsOf(a).get(Number(b.perpId));
      const saved = byPerp[Number(b.perpId)].markPNS;
      byPerp[Number(b.perpId)].markPNS = BigInt(lv.takeProfitPNS !== "0" ? lv.takeProfitPNS : lv.stopLossPNS);
      const e = stops.trigger(a, Number(b.perpId), b.keeper ?? STRANGER);
      byPerp[Number(b.perpId)].markPNS = saved;
      if (e) emitEvent(a, e);
      return send(res, 200, { ok: !!e, event: e });
    }
    if (req.method === "POST" && p === "/__mock/demo-limit") {
      demo.ipHits.set(ip, Array.from({ length: demo.perIpPerHour }, () => now() - 30 * 60e3));
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && p === "/__mock/state") {
      return send(res, 200, { owners: [...owners.values()].map((o) => ({ ...o, used3009: [...o.used3009] })), accounts: [...accounts.values()].map(serializeAccount) });
    }
    return send(res, 404, { error: "not_found", message: `No route ${req.method} ${p}` });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "internal", message: String(e?.message ?? e) });
  }
});

server.listen(PORT, () => console.log(`Mirror dev mock on http://localhost:${PORT} (scenario: ${defaultScenario})`));
