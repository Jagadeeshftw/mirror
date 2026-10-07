// Owner-signed push registration typed data against the vector the engine test also uses
// (shared/test-vectors/push-register-v1.json).
import { readFileSync } from "fs";
import { join } from "path";
import { hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { channelHash, keyRegistered, PUSH_SIG_TTL_SEC, pushDeadline, pushRegisterTypedData, pushUnregisterTypedData, sameReg, signPushRegister } from "../src/lib/pushAuth";

const V = JSON.parse(readFileSync(join(__dirname, "../../shared/test-vectors/push-register-v1.json"), "utf8"));

describe("PushRegister typed data", () => {
  it("domain {Mirror Push, 1, chainId}, field order as the engine", () => {
    const td = pushRegisterTypedData(V.chainId, V.owner, V.notifyPublicKeyB64, "fcm", "tok", BigInt(V.deadline));
    expect(td.domain).toEqual({ name: "Mirror Push", version: "1", chainId: V.chainId });
    expect(td.types.PushRegister.map((f) => `${f.type} ${f.name}`).join(",")).toBe("address owner,bytes32 notifyPublicKey,bytes32 channelHash,uint256 deadline");
    expect(td.message.notifyPublicKey).toBe(V.notifyPublicKeyHex);
  });
  it("channel hashes and digests match the shared vector", () => {
    for (const [k, h] of Object.entries(V.channelHashes)) {
      const i = k.indexOf(":");
      expect(channelHash(k.slice(0, i) as never, k.slice(i + 1))).toBe(h);
    }
    expect(hashTypedData(pushRegisterTypedData(V.chainId, V.owner, V.notifyPublicKeyB64, "fcm", "tok", BigInt(V.deadline)))).toBe(V.registerFcmTokDigest);
    expect(hashTypedData(pushUnregisterTypedData(V.chainId, V.owner, "webpush", "https://fcm.googleapis.com/fcm/send/abc", BigInt(V.deadline)))).toBe(V.unregisterWebpushDigest);
  });
  it("the in-app channel ignores the target; a 31-byte key is refused", () => {
    expect(channelHash("app", "anything")).toBe(V.channelHashes["app:"]);
    expect(() => pushRegisterTypedData(V.chainId, V.owner, "AAAA", "app", "", 1n)).toThrow(/32 bytes/);
  });
  it("signs with the owner key, a deadline well inside the engine's hour", async () => {
    const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const before = Math.floor(Date.now() / 1000);
    const { deadline, signature } = await signPushRegister(acct as never, 143, acct.address, V.notifyPublicKeyB64, "webpush", "https://fcm.googleapis.com/fcm/send/x");
    expect(Number(deadline) - before).toBeLessThanOrEqual(PUSH_SIG_TTL_SEC + 1);
    expect(PUSH_SIG_TTL_SEC).toBeLessThan(3600);
    const signer = await recoverTypedDataAddress({ ...pushRegisterTypedData(143, acct.address, V.notifyPublicKeyB64, "webpush", "https://fcm.googleapis.com/fcm/send/x", BigInt(deadline)), signature });
    expect(signer).toBe(acct.address);
    expect(pushDeadline(0)).toBe(BigInt(PUSH_SIG_TTL_SEC));
  });
  it("remembered registration: same channel needs no new signature; a rotated token does", () => {
    const rec = { owner: V.owner.toLowerCase(), key: V.notifyPublicKeyB64, channel: "fcm" as const, hash: channelHash("fcm", "tok") };
    expect(sameReg(rec, V.owner, V.notifyPublicKeyB64, "fcm", "tok")).toBe(true);
    expect(sameReg(rec, V.owner, V.notifyPublicKeyB64, "fcm", "tok2")).toBe(false);
    expect(keyRegistered(rec, V.owner, V.notifyPublicKeyB64)).toBe(true);
    expect(keyRegistered(rec, "0x0000000000000000000000000000000000000001", V.notifyPublicKeyB64)).toBe(false);
  });
});

describe("envelopeFrom: every channel's message shape", () => {
  const { envelopeFrom } = require("../src/lib/pushEnvelope") as typeof import("../src/lib/pushEnvelope");
  const E = JSON.parse(readFileSync(join(__dirname, "../../shared/test-vectors/push-envelope-v1.json"), "utf8")).envelope;
  const mirror = JSON.stringify(E);
  it("FCM data message: background bundle, top-level data, and content.data parsed from data.body", () => {
    const data = { title: "Mirror", message: "New activity", channelId: "copies", mirror, body: JSON.stringify({ mirror }) };
    expect(envelopeFrom({ data })).toEqual(E);
    expect(envelopeFrom(data)).toEqual(E);
    expect(envelopeFrom(JSON.parse(data.body))).toEqual(E);
    expect(envelopeFrom({ body: data.body })).toEqual(E);
  });
  it("Web Push and generic-only messages", () => {
    expect(envelopeFrom({ mirror: E })).toEqual(E);
    expect(envelopeFrom({ title: "Mirror", body: "New activity" })).toBeNull();
  });
});
