/**
 * Runtime settings read from the environment. Envio Cloud only forwards ENVIO_-prefixed variables,
 * so the unprefixed names are accepted as a fallback for self-hosting only.
 */

import { TEAM_RUN_ACCOUNT_IDS, TEAM_RUN_ADDRESSES } from "./constants.js";

function read(name: string): string {
  return process.env[`ENVIO_${name}`] ?? process.env[name] ?? "";
}

function parseList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

let cacheKey = "";
let addresses = new Set<string>();
let accountIds = new Set<string>();

function load(): void {
  const rawAddrs = read("TEAM_RUN_ADDRESSES");
  const rawIds = read("TEAM_RUN_ACCOUNT_IDS");
  const key = `${rawAddrs}|${rawIds}`;
  if (key === cacheKey) return;
  cacheKey = key;
  addresses = new Set([...TEAM_RUN_ADDRESSES.map((a) => a.toLowerCase()), ...parseList(rawAddrs)]);
  accountIds = new Set([...TEAM_RUN_ACCOUNT_IDS.map((id) => id.toString()), ...parseList(rawIds).map((s) => BigInt(s).toString())]);
}

/**
 * True when any of the given addresses or the Perpl account id is configured as team-run (the static
 * list in constants.ts plus the ENVIO_TEAM_RUN_* variables).
 */
export function isTeamRun(opts: {
  addresses?: readonly (string | null | undefined)[];
  accountId?: bigint | null;
}): boolean {
  load();
  if (opts.accountId != null && accountIds.has(opts.accountId.toString())) return true;
  for (const a of opts.addresses ?? []) {
    if (a && addresses.has(a.toLowerCase())) return true;
  }
  return false;
}

export function resolveAddressesEnabled(): boolean {
  return read("RESOLVE_PERPL_ADDRESSES").toLowerCase() !== "false";
}

export function rpcUrl(): string {
  return read("RPC_URL") || "https://rpc.monad.xyz";
}
