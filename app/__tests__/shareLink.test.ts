import { concat, decodeAbiParameters, encodeAbiParameters, hashTypedData, keccak256, recoverTypedDataAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ACTION } from "../src/lib/contracts";
import { setLevelsAction } from "../src/lib/levels";
import {
  acceptPlan,
  acceptedFor,
  newLinkId,
  normalizeShareList,
  openLinkFor,
  pendingFor,
  positionLinkUrl,
  shareDeclineTypedData,
  shareLinkTypedData,
  shareRevokeTypedData,
  urlIdOf,
} from "../src/lib/shareLink";
import type { Position, PositionLevel } from "../src/lib/types";

const ACCOUNT = "0x00000000000000000000000000000000000000aa" as const;
const LINK = `0x${"ab".repeat(32)}` as const;
const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const domainSep = (chainId: number) => {
  const t = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }], [t, keccak256(toHex("Mirror Account")), keccak256(toHex("1")), BigInt(chainId), ACCOUNT]));
};

describe("share typed data (engine POST /v1/share, /revoke, /decline)", () => {
  it("ShareLink(uint32 perpId,bytes32 linkId,uint256 deadline) in the account's Mirror Account v1 domain", () => {
    const td = shareLinkTypedData(ACCOUNT, 143, 1, LINK, 5n);
    const struct = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "uint256" }], [keccak256(toHex("ShareLink(uint32 perpId,bytes32 linkId,uint256 deadline)")), 1, LINK, 5n]));
    expect(hashTypedData(td)).toBe(keccak256(concat(["0x1901", domainSep(143), struct])));
  });
  it("ShareRevoke(bytes32 linkId,uint256 deadline) and ShareDecline(uint256 suggestionId,uint256 deadline)", () => {
    const r = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [keccak256(toHex("ShareRevoke(bytes32 linkId,uint256 deadline)")), LINK, 9n]));
    expect(hashTypedData(shareRevokeTypedData(ACCOUNT, 10143, LINK, 9n))).toBe(keccak256(concat(["0x1901", domainSep(10143), r])));
    const d = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }], [keccak256(toHex("ShareDecline(uint256 suggestionId,uint256 deadline)")), 42n, 9n]));
    expect(hashTypedData(shareDeclineTypedData(ACCOUNT, 143, 42, 9n))).toBe(keccak256(concat(["0x1901", domainSep(143), d])));
  });
  it("the owner's signature recovers to the owner, and only for that link", async () => {
    const sig = await owner.signTypedData(shareLinkTypedData(ACCOUNT, 143, 1, LINK, 5n));
    expect(await recoverTypedDataAddress({ ...shareLinkTypedData(ACCOUNT, 143, 1, LINK, 5n), signature: sig })).toBe(owner.address);
    expect(await recoverTypedDataAddress({ ...shareLinkTypedData(ACCOUNT, 143, 2, LINK, 5n), signature: sig })).not.toBe(owner.address);
  });
  it("link ids: 32 random bytes, 43-char base64url in /p/<id> (same encoding as the engine)", () => {
    const id = newLinkId();
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(newLinkId()).not.toBe(id);
    expect(urlIdOf(id)).toBe(Buffer.from(id.slice(2), "hex").toString("base64url"));
    expect(urlIdOf(LINK)).toHaveLength(43);
    expect(positionLinkUrl("abc", "https://mirror.0xo.in")).toBe("https://mirror.0xo.in/p/abc");
  });
});

const long: Position = { perpId: 1, side: "long", entryPNS: "1178800", markPNS: "1184205", lotLNS: "10" } as Position;
const short: Position = { perpId: 1, side: "short", entryPNS: "1178800", markPNS: "1184205", lotLNS: "10" } as Position;
const lv = (side: "long" | "short", sl: string, tp: string, slip = 300): PositionLevel[] => [{ perpId: 1, side, stopLossPNS: sl, takeProfitPNS: tp, slippageBps: slip }];

describe("suggestion validation: the level the owner signs on Accept", () => {
  it("suggested fields replace the current ones, the others and the slippage stay; encoded as ACTION_SET_LEVELS", () => {
    const p = acceptPlan({ perpId: 1, side: "long", stopLossPNS: null, takeProfitPNS: "1350000" }, long, lv("long", "1084500", "1414560", 500));
    expect(p.error).toBeNull();
    expect(p.level).toEqual({ perpId: 1, side: 0, stopLossPNS: "1084500", takeProfitPNS: "1350000", slippageBps: 500 });
    const a = setLevelsAction([p.level]);
    expect(a.kind).toBe(ACTION.SET_LEVELS);
    const [levels] = decodeAbiParameters([{ type: "tuple[]", components: [{ name: "perpId", type: "uint32" }, { name: "side", type: "uint8" }, { name: "stopLossPNS", type: "uint64" }, { name: "takeProfitPNS", type: "uint64" }, { name: "slippageBps", type: "uint16" }] }], a.data) as any;
    expect(levels[0]).toMatchObject({ perpId: 1, side: 0, stopLossPNS: 1084500n, takeProfitPNS: 1350000n, slippageBps: 500 });
  });
  it("no current level: default slippage 3%", () => {
    expect(acceptPlan({ perpId: 1, side: "long", stopLossPNS: "1120000", takeProfitPNS: null }, long, []).level).toEqual({ perpId: 1, side: 0, stopLossPNS: "1120000", takeProfitPNS: "0", slippageBps: 300 });
  });
  it("re-checked against the mark now: a long's take-profit below the mark, a stop above it, or stop >= take-profit is refused", () => {
    expect(acceptPlan({ perpId: 1, side: "long", stopLossPNS: null, takeProfitPNS: "1180000" }, long, [])?.error?.field).toBe("tp");
    expect(acceptPlan({ perpId: 1, side: "long", stopLossPNS: "1190000", takeProfitPNS: null }, long, [])?.error?.field).toBe("sl");
    expect(acceptPlan({ perpId: 1, side: "long", stopLossPNS: "1170000", takeProfitPNS: null }, { ...long, markPNS: "0" }, lv("long", "0", "1160000"))?.error?.message).toMatch(/below the take-profit/);
  });
  it("a short mirrors it; a suggestion for the other side is refused", () => {
    expect(acceptPlan({ perpId: 1, side: "short", stopLossPNS: "1250000", takeProfitPNS: "1100000" }, short, []).error).toBeNull();
    expect(acceptPlan({ perpId: 1, side: "short", stopLossPNS: null, takeProfitPNS: "1200000" }, short, [])?.error?.field).toBe("tp");
    expect(acceptPlan({ perpId: 1, side: "long", stopLossPNS: null, takeProfitPNS: "1100000" }, short, [])?.error?.message).toMatch(/another position/);
  });
});

describe("owner list (decrypted)", () => {
  const raw = {
    links: [
      { linkId: LINK, urlId: urlIdOf(LINK), perpId: 1, side: "long", status: "open", createdMs: 1 },
      { linkId: "nope", perpId: 1 },
    ],
    suggestions: [
      { id: 3, linkId: LINK, perpId: 1, side: "long", stopLossPNS: null, takeProfitPNS: "1350000", prevStopLossPNS: "1084500", prevTakeProfitPNS: "1414560", note: "x".repeat(300), status: "pending", createdMs: 5 },
      { id: 2, linkId: LINK, perpId: 1, side: "long", takeProfitPNS: "1360000", status: "accepted", txHash: "0xAB" },
      { id: "bad" },
    ],
  };
  it("drops malformed rows and caps the note at 140", () => {
    const l = normalizeShareList(raw, ACCOUNT);
    expect(l.links).toHaveLength(1);
    expect(l.suggestions.map((s) => s.id)).toEqual([3, 2]);
    expect(l.suggestions[0].note).toHaveLength(140);
    expect(l.suggestions[0].stopLossPNS).toBeNull();
  });
  it("open link, pending and accepted for a position", () => {
    const l = normalizeShareList(raw, ACCOUNT);
    expect(openLinkFor(l, long)?.linkId).toBe(LINK);
    expect(openLinkFor(l, short)).toBeNull();
    expect(pendingFor(l, long).map((s) => s.id)).toEqual([3]);
    expect(acceptedFor(l, long, "0xab")?.id).toBe(2);
    expect(acceptedFor(l, long, "0xcd")).toBeNull();
  });
});
