import webpush from 'web-push';
import type { Config } from '../config.js';
import type { WebPushSender } from './push.js';

/**
 * Web Push with VAPID (RFC 8030/8291/8292) through the `web-push` package: no Firebase project needed. The body is
 * the already-sealed Mirror envelope, which web-push encrypts once more (aes128gcm) to the browser's subscription
 * keys. Undefined when VAPID keys are not configured.
 */
export function webPushSender(env: Pick<Config['env'], 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>): WebPushSender | undefined {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return undefined;
  const vapidDetails = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  // Throws on malformed keys at startup rather than on the first alert.
  webpush.getVapidHeaders('https://fcm.googleapis.com', vapidDetails.subject, vapidDetails.publicKey, vapidDetails.privateKey, 'aes128gcm');
  // web-push builds the request (aes128gcm body, VAPID JWT); fetch sends it, so the Stage-A override can be plain http.
  return async (sub, body, headers) => {
    const req = webpush.generateRequestDetails(sub, body, { vapidDetails, TTL: 3600, urgency: 'high', headers });
    const res = await fetch(req.endpoint, { method: req.method, headers: req.headers as Record<string, string>, body: req.body as Uint8Array | null, signal: AbortSignal.timeout(10_000) });
    await res.arrayBuffer().catch(() => undefined);
    return { statusCode: res.status };
  };
}
