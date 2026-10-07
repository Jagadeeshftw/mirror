// Alert envelope v1 against the test vector the engine test also uses (shared/test-vectors/push-envelope-v1.json).
import { readFileSync } from "fs";
import { join } from "path";
import { base64 } from "@scure/base";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { deriveNotifyKey, open, openJson, seal } from "../src/lib/notifyKey";

const V = JSON.parse(readFileSync(join(__dirname, "../../shared/test-vectors/push-envelope-v1.json"), "utf8"));
const mockKeys = deriveNotifyKey(hexToBytes(V.notifyPrfHex));
const keys = mockKeys;

const mockAdd = jest.fn(async (_p: unknown) => true);
jest.mock("../src/lib/wallet", () => ({ loadNotifyKey: async () => mockKeys }));
jest.mock("../src/state/notifications", () => ({ addNotification: (p: unknown) => mockAdd(p) }));
jest.mock("../src/state/alertsPref", () => ({ getAlertsPref: async () => "on" }));
jest.mock("../src/lib/api", () => ({ api: {} }));
jest.mock("../src/lib/pwa", () => ({ basePath: () => "" }));

describe("alert envelope v1 (shared vector)", () => {
  it("the notification PRF output derives the vector's X25519 key pair", () => {
    expect(base64.encode(keys.privateKey)).toBe(V.recipientPrivateKey);
    expect(base64.encode(keys.publicKey)).toBe(V.recipientPublicKey);
  });

  it("decrypts the engine's envelope to the alert JSON", () => {
    expect(openJson(keys, V.envelope)).toEqual(JSON.parse(V.plaintext));
  });

  it("sealing with the vector's ephemeral key and nonce gives the same envelope (byte-for-byte with the engine)", () => {
    const env = seal(keys.publicKey, utf8ToBytes(V.plaintext), V.info, base64.decode(V.ephemeralPrivateKey), base64.decode(V.nonce));
    expect(env).toEqual(V.envelope);
  });

  it("refuses a tampered ciphertext, another device's key and another version", () => {
    const ct = base64.decode(V.envelope.ct);
    ct[3] ^= 0x10;
    expect(() => open(keys, { ...V.envelope, ct: base64.encode(ct) })).toThrow();
    expect(() => open(deriveNotifyKey(new Uint8Array(32).fill(7)), V.envelope)).toThrow();
    expect(() => open(keys, { ...V.envelope, v: 2 })).toThrow(/version/);
  });
});

describe("web delivery (push.web.ts)", () => {
  // Required after the mocks are in place.
  const web = require("../src/lib/push.web") as typeof import("../src/lib/push.web");

  it("reads the envelope from the Web Push body the service worker stores ({mirror: envelope})", () => {
    expect(web.envelopeFrom({ mirror: V.envelope })).toEqual(V.envelope);
    expect(web.envelopeFrom({ mirror: JSON.stringify(V.envelope) })).toEqual(V.envelope);
    expect(web.envelopeFrom({ title: "Mirror", body: "New activity" })).toBeNull();
  });

  it("decrypts into the Alerts list; envelopes for another device are ignored", async () => {
    mockAdd.mockClear();
    const p = await web.presentEncrypted(V.envelope);
    expect(p).toMatchObject({ kind: "copied", title: "Copied BTC long" });
    expect(mockAdd).toHaveBeenCalledWith(JSON.parse(V.plaintext));
    const other = seal(deriveNotifyKey(new Uint8Array(32).fill(9)).publicKey, utf8ToBytes(V.plaintext));
    expect(await web.presentEncrypted(other)).toBeNull();
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });
});
