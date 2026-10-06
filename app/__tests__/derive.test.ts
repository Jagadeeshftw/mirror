import { addressFromPrf, mnemonicFromPrf, sessionFromPrf } from "../src/lib/derive";
import { deriveNotifyKey, fingerprint, open, openJson, openNote, seal, sealNote } from "../src/lib/notifyKey";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const PRF = new Uint8Array(32).fill(7);

describe("owner key derivation (PRF -> BIP-39 -> m/44'/60'/0'/0/0)", () => {
  it("matches `cast wallet address --mnemonic` for the same phrase", () => {
    expect(mnemonicFromPrf(PRF)).toBe(
      "alpha deal scrub asthma idea logic bright thought alpha deal scrub asthma idea logic bright thought alpha deal scrub asthma idea logic bright truly",
    );
    expect(addressFromPrf(PRF)).toBe("0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f");
  });
  it("ends the signing session (key zeroed) after use", async () => {
    const { session } = sessionFromPrf(PRF);
    session.end();
    await expect(session.signDigest(new Uint8Array(32))).rejects.toThrow();
  });
});

describe("namespaced notification key (HKDF info mirror.v1.notify.x25519)", () => {
  it("is deterministic per passkey and independent of the owner key", () => {
    const a = deriveNotifyKey(PRF);
    const b = deriveNotifyKey(PRF);
    expect(Buffer.from(a.publicKey).toString("hex")).toBe(Buffer.from(b.publicKey).toString("hex"));
    expect(a.publicKey.length).toBe(32);
    const other = deriveNotifyKey(new Uint8Array(32).fill(8));
    expect(Buffer.from(other.publicKey).toString("hex")).not.toBe(Buffer.from(a.publicKey).toString("hex"));
    expect(fingerprint(a.publicKey)).toMatch(/^([0-9a-f]{2}:){7}[0-9a-f]{2}$/);
  });
  it("decrypts a sealed push payload; the server only sees ciphertext", () => {
    const k = deriveNotifyKey(PRF);
    const payload = { kind: "blocked", title: "Blocked by your rule", body: "Leader opened 12x BTC long. Your max leverage is 5x. Not copied.", timestamp: 1 };
    const env = seal(k.publicKey, utf8ToBytes(JSON.stringify(payload)));
    expect(env.ct).not.toContain("Blocked");
    expect(openJson(k, env)).toEqual(payload);
  });
  it("rejects tampered ciphertext and the wrong key", () => {
    const k = deriveNotifyKey(PRF);
    const env = seal(k.publicKey, utf8ToBytes("hello ✓ ünïcode"));
    expect(new TextDecoder().decode(open(k, env))).toBe("hello ✓ ünïcode");
    const bad = { ...env, ct: env.ct.slice(0, -4) + (env.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
    expect(() => open(k, bad)).toThrow();
    expect(() => open(deriveNotifyKey(new Uint8Array(32).fill(9)), env)).toThrow();
  });
  it("seals private follow notes to the owner's own key, with a separate HKDF domain", () => {
    const k = deriveNotifyKey(PRF);
    const env = sealNote(k, "Fund wallet, low drawdown. Re-check in Nov.");
    expect(openNote(k, env)).toBe("Fund wallet, low drawdown. Re-check in Nov.");
    expect(() => open(k, env)).toThrow(); // push domain cannot open a note
  });
});
