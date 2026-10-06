#!/usr/bin/env node
// Measure Monad mainnet block time and finality from a public RPC. No dependencies (Node 22+).
//
//   node scripts/measure-monad.mjs            (30 s sample)
//   SECONDS=60 node scripts/measure-monad.mjs
//
// Block time: eth_blockNumber at the start and end of the sample.
// Finality: the `monadNewHeads` subscription reports each block's commit state (Proposed, Voted,
// Finalized); we time how long after a block is first seen as Proposed it is reported Finalized.

const HTTP = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const WSS = process.env.MONAD_WSS_URL ?? "wss://rpc.monad.xyz";
const SECONDS = Number(process.env.SECONDS ?? 30);

async function rpc(method, params = []) {
  const r = await fetch(HTTP, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

const proposedAt = new Map();
const voted = [];
const finalized = [];
const ws = new WebSocket(WSS);
ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadNewHeads"] }));
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  const h = msg?.params?.result;
  if (!h) return;
  const id = h.blockId ?? h.hash ?? h.number;
  const state = String(h.commitState ?? "").toLowerCase();
  const now = performance.now();
  if (state === "proposed" && !proposedAt.has(id)) proposedAt.set(id, now);
  const t0 = proposedAt.get(id);
  if (t0 === undefined) return;
  if (state === "voted") voted.push(now - t0);
  if (state === "finalized") finalized.push(now - t0);
};

const b0 = BigInt(await rpc("eth_blockNumber"));
const t0 = performance.now();
console.log(`sampling Monad mainnet for ${SECONDS} s via ${HTTP} and ${WSS} ...`);
await new Promise((r) => setTimeout(r, SECONDS * 1000));
const b1 = BigInt(await rpc("eth_blockNumber"));
const elapsed = (performance.now() - t0) / 1000;
ws.close();

const blocks = Number(b1 - b0);
console.log(`blocks          ${blocks} in ${elapsed.toFixed(1)} s (${b0} -> ${b1})`);
console.log(`block time      ${((elapsed * 1000) / blocks).toFixed(0)} ms average`);
console.log(`voted after     ${median(voted).toFixed(0)} ms median (${voted.length} blocks)`);
console.log(`finalized after ${median(finalized).toFixed(0)} ms median after first seen as Proposed (${finalized.length} blocks)`);
process.exit(0);
