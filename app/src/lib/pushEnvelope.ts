// Finds the sealed Mirror envelope in a push message, whichever channel carried it (pure; native and web builds).
//   Web Push body / service worker inbox: {mirror: envelope}
//   FCM data message (engine services/fcm.ts): data.mirror in the background task bundle ({data: {mirror}}), and
//   content.data.mirror in JS, parsed by expo-notifications from data.body.
//   Expo push (fallback): data.mirror.
import type { PushEnvelope } from "./types";

export function envelopeFrom(data: unknown): PushEnvelope | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const nested = d.data && typeof d.data === "object" ? (d.data as Record<string, unknown>).mirror : undefined;
  const raw = d.mirror ?? nested ?? d.envelope ?? d.body ?? d;
  try {
    let env = (typeof raw === "string" ? JSON.parse(raw) : raw) as PushEnvelope | { mirror?: unknown };
    // data.body is itself JSON holding {mirror}.
    if (env && typeof env === "object" && "mirror" in env) env = (typeof env.mirror === "string" ? JSON.parse(env.mirror) : env.mirror) as PushEnvelope;
    const e = env as PushEnvelope;
    return e && e.v === 1 && e.ct ? e : null;
  } catch {
    return null;
  }
}
