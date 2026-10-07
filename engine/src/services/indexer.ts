import type { Logger } from '../log.js';

/** Minimal GraphQL client for the Envio indexer (Hasura). Returns undefined on any failure, after logging. */
export class IndexerClient {
  constructor(
    readonly url: string | undefined,
    private readonly log: Logger,
    private readonly timeoutMs = 8_000,
  ) {}

  get enabled() {
    return Boolean(this.url);
  }

  async query<T>(query: string, variables: Record<string, unknown>, what: string): Promise<T | undefined> {
    if (!this.url) return undefined;
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const j = (await res.json()) as { data?: T; errors?: unknown };
      if (!res.ok || j.errors || !j.data) throw new Error(JSON.stringify(j.errors ?? res.status));
      return j.data;
    } catch (err) {
      this.log.warn({ err: (err as Error).message, what }, 'indexer query failed');
      return undefined;
    }
  }
}
