/**
 * Server-side reads from the Mirror engine API (docs/api.md) for the share cards. Every failure becomes a
 * CardUnavailable with a plain reason; the card then says "not available" and shows no numbers.
 */
import "server-only";
import { API_BASE, API_CONFIGURED } from "@/lib/site";

export class CardUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardUnavailable";
  }
}

type Json = Record<string, any>;

async function call(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 8000): Promise<Json> {
  if (!API_CONFIGURED) throw new CardUnavailable("Mirror's server is not configured for this site.");
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      ...(method === "GET" ? { next: { revalidate: 30 } } : { cache: "no-store" as const }),
    });
  } catch {
    throw new CardUnavailable("Mirror's server didn't answer.");
  }
  if (res.status === 404) throw new CardUnavailable("Mirror's server has no record of this.");
  if (res.status === 503 && path.includes("/backtest")) throw new CardUnavailable("Trade history for the simulation is not available right now.");
  if (res.status === 429) throw new CardUnavailable("Mirror's server is busy. Try again in a minute.");
  if (!res.ok) throw new CardUnavailable(`Mirror's server answered ${res.status}.`);
  try {
    return (await res.json()) as Json;
  } catch {
    throw new CardUnavailable("Mirror's server sent an unreadable answer.");
  }
}

export const getJson = (path: string) => call("GET", path);
export const postJson = (path: string, body: unknown) => call("POST", path, body, 30000);

/** Config is optional context (explorer, markets, team-run, builder fee); a card still renders without it. */
export async function getConfig(): Promise<Json | null> {
  return getJson("/v1/config").catch(() => null);
}

export type FeedRead = { items: Json[]; complete: boolean };
/** Reads an account's feed, following the cursor up to `maxPages`. `complete` is false when pages remain. */
export async function getFeed(account: string, maxPages = 8): Promise<FeedRead> {
  const items: Json[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page: Json = await getJson(`/v1/accounts/${account}/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    items.push(...((page.items ?? page.events ?? []) as Json[]));
    cursor = page.nextCursor ?? null;
    if (!cursor) return { items, complete: true };
  }
  return { items, complete: false };
}
