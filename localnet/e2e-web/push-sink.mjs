// Stage-A stand-in for a browser push service. The engine runs with PUSH_WEBPUSH_ENDPOINT_OVERRIDE pointing here, so
// every Web Push request it would send to FCM/Mozilla/Apple lands on this server instead. The browser's subscription
// is a test double whose keys are made here, so the sink can take off the Web Push layer (RFC 8291 aes128gcm) and
// show what the push service would carry: the Mirror envelope, which is still sealed to the device's notification key.
import { createDecipheriv, createECDH, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const b64u = (b) => Buffer.from(b).toString("base64url");

/** A fresh VAPID key pair for the engine (env VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). */
export function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")])), privateKey: priv.d };
}

/** Subscription keys as a browser would make them (P-256 key + 16-byte auth secret). */
export function subscriptionKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}

/** RFC 8291 decryption of one aes128gcm record with the subscription's private key. */
export function decryptAes128gcm(body, ecdh, auth) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const secret = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(-16));
  const padded = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error("bad aes128gcm padding delimiter");
  return padded.subarray(0, end).toString("utf8");
}

/** Starts the sink. `subs` maps a subscription endpoint to {ecdh, auth}; requests say which one in x-mirror-endpoint. */
export function startPushSink({ port, status = 201 }) {
  const requests = [];
  const subs = new Map();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const endpoint = req.headers["x-mirror-endpoint"] ?? null;
      const rec = { at: Date.now(), path: req.url, endpoint, headers: { ...req.headers }, size: body.length, plaintext: null, error: null };
      const sub = endpoint ? subs.get(endpoint) : null;
      try {
        if (!sub) throw new Error("no subscription keys for this endpoint");
        rec.plaintext = decryptAes128gcm(body, sub.ecdh, sub.auth);
      } catch (e) {
        rec.error = String(e.message);
      }
      requests.push(rec);
      res.writeHead(status);
      res.end();
    });
  });
  return new Promise((resolve, reject) =>
    server.once("error", reject).listen(port, "127.0.0.1", () =>
      resolve({ url: `http://127.0.0.1:${port}/push`, requests, subs, stop: () => new Promise((r) => server.close(r)) }),
    ),
  );
}
