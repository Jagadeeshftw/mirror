import { concat, encodeAbiParameters, hashTypedData, keccak256, recoverTypedDataAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeAbiParameters } from "viem";
import { ACTION, detachTypedData, mirrorDomain } from "../src/lib/contracts";
import { stopPlan } from "../src/lib/levels";
import type { MirrorAccount } from "../src/lib/types";

const ACCOUNT = "0x00000000000000000000000000000000000000aa" as const;
const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("Detach typed data (engine POST /v1/accounts/:account/detach)", () => {
  it("is Detach(bool detached,uint256 deadline) in the account's Mirror Account v1 domain", () => {
    const td = detachTypedData(ACCOUNT, 143, true, 1_800_000_600n);
    expect(td.domain).toEqual(mirrorDomain(ACCOUNT, 143));
    expect(td.domain).toMatchObject({ name: "Mirror Account", version: "1", chainId: 143, verifyingContract: ACCOUNT });
    // Digest computed by hand: keccak256(0x1901 || domainSeparator || structHash).
    const domainType = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
    const sep = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }], [domainType, keccak256(toHex("Mirror Account")), keccak256(toHex("1")), 143n, ACCOUNT]));
    const typeHash = keccak256(toHex("Detach(bool detached,uint256 deadline)"));
    const struct = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bool" }, { type: "uint256" }], [typeHash, true, 1_800_000_600n]));
    expect(hashTypedData(td)).toBe(keccak256(concat(["0x1901", sep, struct])));
  });
  it("a passkey-derived signer's signature recovers to the owner, and only for that value", async () => {
    const sig = await owner.signTypedData(detachTypedData(ACCOUNT, 143, true, 5n));
    expect(await recoverTypedDataAddress({ ...detachTypedData(ACCOUNT, 143, true, 5n), signature: sig })).toBe(owner.address);
    expect(await recoverTypedDataAddress({ ...detachTypedData(ACCOUNT, 143, false, 5n), signature: sig })).not.toBe(owner.address);
  });
  it("keep my positions on the only leader = detach + SET_PAUSED(true) onchain", () => {
    const a = { policy: { leaders: [{ accountId: 7 }], markets: [], expiry: 4e9 }, positions: [], leader: null, paused: false } as unknown as MirrorAccount;
    const p = stopPlan(a, 7, "keep");
    expect(p.how).toBe("detach");
    expect(p.actions.map((x) => x.kind)).toEqual([ACTION.SET_PAUSED]);
    expect(decodeAbiParameters([{ type: "bool" }], p.actions[0].data)[0]).toBe(true);
  });
});
