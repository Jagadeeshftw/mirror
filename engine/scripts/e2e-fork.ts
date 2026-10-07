/**
 * End-to-end test on a local anvil fork of Monad mainnet (no real funds, nothing sent to Monad):
 *   anvil fork (--disable-code-size-limit: MirrorAccount is above EIP-170, which Monad accepts) -> forge deploy
 *   -> fund demo leader, second leader and follower owner with AUSD (impersonating the Perpl Exchange) -> leaders
 *   open their own Perpl accounts -> engine starts -> follower MirrorAccount created, funded with a permit and set
 *   to follow three leaders through the relayer routes. Checks:
 *   - entry guard: match now on a real mainnet leader whose entry is far from the mark is Blocked(EntryTooFar)
 *   - /v1/demo/trade copied open and close, Mirrored carries the copy proof; /v1/demo/blocked LeverageTooHigh
 *   - a second leader's copy into the demo leader's market is Blocked(MarketHeldByOtherLeader)
 *   - a leader reduction is closed down to exactly that leader's target (engine == contract targetLots)
 *   - an owner take-profit level is executed by a stranger (the stop executor) once the mark reaches it
 *   - team-run exclusion in /v1/stats.
 *
 *   pnpm e2e:fork            (needs anvil + forge on PATH; uses port 8545 and E2E_API_PORT, default 8787)
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, createWriteStream, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  pad,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { perplExchangeAbi } from '../src/abi/PerplExchange.js';
import { mirrorAccountAbi } from '../src/abi/MirrorAccount.js';
import { mirrorAccountFactoryAbi } from '../src/abi/MirrorAccountFactory.js';
import { authTokenAbi } from '../src/abi/erc20.js';
import { contractSlippageBound, entryBound, targetLots } from '../src/domain/planner.js';
import { encodeFollowData, encodeLevels, encodePolicy } from '../src/domain/encode.js';
import { ACTION, CLOSE_LONG, OPEN_LONG, type MirrorOrder, type Policy } from '../src/domain/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const work = join(root, '.e2e');
const RPC = 'http://127.0.0.1:8545';
const API_PORT = Number(process.env.E2E_API_PORT ?? 8787);
const API = `http://127.0.0.1:${API_PORT}`;
const EXCHANGE = getAddress('0x34B6552d57a35a1D042CcAe1951BD1C370112a6F');
const AUSD = getAddress('0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a');
const PERPL_OWNER = getAddress('0xd0a0205e9188998E0bE7F2600a715aD3CD289Cb1');
const PRICE_ADMIN = getAddress('0x53d5c4f9a2f32f0c27671340d8af93384ea93881');
const BTC = 1;

// anvil default keys (test only)
const K = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  keeperA: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  keeperB: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  relayer: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  leader: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  follower: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  user: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  leader2: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  stranger: '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
} as const satisfies Record<string, Hex>;
const A = Object.fromEntries(Object.entries(K).map(([k, v]) => [k, privateKeyToAccount(v)])) as Record<keyof typeof K, ReturnType<typeof privateKeyToAccount>>;

const chain = defineChain({ id: 143, name: 'Monad fork', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 60_000 }) });
const wallet = (key: Hex) => createWalletClient({ chain, transport: http(RPC, { timeout: 60_000 }), account: privateKeyToAccount(key) });
const impersonated = (address: Address) => createWalletClient({ chain, transport: http(RPC, { timeout: 60_000 }), account: address });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const say = (...a: unknown[]) => console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok, detail: detail === undefined ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) });
  say(ok ? 'PASS' : 'FAIL', name, detail ?? '');
  if (!ok) throw new Error(`assertion failed: ${name}`);
}

const children: ChildProcess[] = [];
let deploymentsBackup: string | undefined;
const deploymentsFile = join(repo, 'contracts', 'deployments', '143.json');

async function rpc(method: string, params: unknown[] = []) {
  return pub.request({ method, params } as never);
}

async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false>, timeoutMs = 60_000, every = 500): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      last = err;
    }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${(last as Error).message}` : ''}`);
}

async function api<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const j = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return j as T;
}

function portBusy(port: number) {
  try {
    execFileSync('lsof', ['-ti', `tcp:${port}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function startAnvil() {
  if (portBusy(8545)) throw new Error('port 8545 is busy; stop the other anvil first');
  const log = createWriteStream(join(work, 'anvil.log'));
  const p = spawn('anvil', ['--fork-url', process.env.FORK_URL ?? 'https://rpc.monad.xyz', '--chain-id', '143', '--port', '8545', '--block-time', '1', '--disable-code-size-limit', '--silent'], { stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout?.pipe(log);
  p.stderr?.pipe(log);
  children.push(p);
  await waitFor('anvil', async () => (await pub.getBlockNumber()) > 0n, 60_000, 500);
  say('anvil fork up at block', await pub.getBlockNumber());
}

async function send(w: ReturnType<typeof wallet> | ReturnType<typeof impersonated>, req: { to: Address; data?: Hex; abi?: any; functionName?: string; args?: unknown[] }) {
  const hash = req.abi
    ? await w.writeContract({ address: req.to, abi: req.abi, functionName: req.functionName as never, args: req.args as never, chain, account: w.account! } as never)
    : await w.sendTransaction({ to: req.to, data: req.data, chain, account: w.account! } as never);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== 'success') throw new Error(`tx reverted: ${req.functionName ?? 'call'}`);
  return r;
}

/** The BTC mark the fork keeps pushing; tests move it to reach a level. */
let forkMark = 0n;

async function pushMark() {
  try {
    await send(impersonated(PRICE_ADMIN), { to: EXCHANGE, abi: perplExchangeAbi, functionName: 'updateMarkPricePNS', args: [BigInt(BTC), Number(forkMark)] });
  } catch (err) {
    say('mark push failed', (err as Error).message.slice(0, 120));
  }
}

/** On the fork nobody updates Perpl marks, so they go stale after 60 s: ignore the oracle and re-push the mark. */
async function keepMarksFresh() {
  await rpc('anvil_impersonateAccount', [PERPL_OWNER]);
  await rpc('anvil_impersonateAccount', [PRICE_ADMIN]);
  await rpc('anvil_setBalance', [PERPL_OWNER, '0x56BC75E2D63100000']);
  await rpc('anvil_setBalance', [PRICE_ADMIN, '0x56BC75E2D63100000']);
  await send(impersonated(PERPL_OWNER), { to: EXCHANGE, abi: perplExchangeAbi, functionName: 'setIgnOracle', args: [BigInt(BTC), true] });
  const [, mark] = await pub.readContract({ address: EXCHANGE, abi: perplExchangeAbi, functionName: 'getPositionV2', args: [BigInt(BTC), 1n] });
  forkMark = mark;
  await pushMark();
  const timer = setInterval(() => void pushMark(), 15_000);
  timer.unref();
  say('fork marks kept fresh at', mark.toString());
  return timer;
}

function deploy(): { factory: Address; keeperRegistry: Address; block: number } {
  if (existsSync(deploymentsFile)) deploymentsBackup = readFileSync(deploymentsFile, 'utf8');
  const out = execFileSync(
    'forge',
    ['script', 'script/Deploy.s.sol', '--rpc-url', RPC, '--private-key', K.deployer, '--broadcast', '--disable-code-size-limit'],
    {
      cwd: join(repo, 'contracts'),
      env: { ...process.env, WRITE_DEPLOYMENT: 'true', KEEPERS: `${A.keeperA.address},${A.keeperB.address}`, FOUNDRY_BROADCAST: join(work, 'broadcast') },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const d = JSON.parse(readFileSync(deploymentsFile, 'utf8'));
  restoreDeployments();
  say('deployed', { factory: d.factory, keeperRegistry: d.keeperRegistry, block: d.block });
  void out;
  return { factory: getAddress(d.factory), keeperRegistry: getAddress(d.keeperRegistry), block: Number(d.block) };
}

function restoreDeployments() {
  // Put back the real deployment record, or remove the fork one if there was none.
  if (deploymentsBackup !== undefined) writeFileSync(deploymentsFile, deploymentsBackup);
  else if (existsSync(deploymentsFile)) rmSync(deploymentsFile);
}

async function fundAusd(to: Address, amount: bigint) {
  await rpc('anvil_impersonateAccount', [EXCHANGE]);
  await rpc('anvil_setBalance', [EXCHANGE, '0x56BC75E2D63100000']);
  await send(impersonated(EXCHANGE), { to: AUSD, abi: authTokenAbi, functionName: 'transfer', args: [to, amount] });
  await rpc('anvil_stopImpersonatingAccount', [EXCHANGE]);
}

async function blockTime() {
  return Number((await pub.getBlock()).timestamp);
}

/** A live mainnet BTC position whose average entry is worse than the mark by more than `devBps` for a copier. */
async function pickLiveLeader(exclude: number[], devBps: number): Promise<{ id: number; lots: bigint; side: 0 | 1; entry: bigint }> {
  const abi = parseAbi([
    'struct P { uint256 accountId; uint256 nextNodeId; uint256 prevNodeId; uint8 positionType; uint256 depositCNS; uint256 pricePNS; uint256 lotLNS; uint256 entryBlock; int256 pnlCNS; int256 deltaPnlCNS; int256 premiumPnlCNS; uint256 priceResiduePNSQ16; }',
    'function getPositionsV2(uint256 perpId, uint256 pageStartPositionId, uint256 positionsPerPage) view returns (P[] positions, uint256 numPositions, uint256 markPricePNS, bool markPriceValid)',
  ]);
  const [ps, , mark] = await pub.readContract({ address: EXCHANGE, abi, functionName: 'getPositionsV2', args: [BigInt(BTC), 0n, 100n] });
  const far = (p: (typeof ps)[number]) => {
    const side = p.positionType === 0 ? 0 : 1;
    const eb = entryBound(side, p.pricePNS, devBps)!;
    return side === 0 ? mark > eb : mark < eb;
  };
  const c = ps.find((p) => p.lotLNS >= 100n && p.lotLNS <= 30_000n && !exclude.includes(Number(p.accountId)) && far(p));
  if (!c) throw new Error('no suitable live BTC position on the fork');
  return { id: Number(c.accountId), lots: c.lotLNS, side: c.positionType === 0 ? 0 : 1, entry: c.pricePNS };
}

async function startEngine(env: Record<string, string>) {
  if (portBusy(API_PORT)) throw new Error(`port ${API_PORT} is busy; set E2E_API_PORT`);
  const log = createWriteStream(join(work, 'engine.log'));
  const p = spawn(join(root, 'node_modules', '.bin', 'tsx'), ['src/index.ts'], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout?.pipe(log);
  p.stderr?.pipe(log);
  children.push(p);
  p.on('exit', (code) => code && code !== 0 && say('engine exited with', code));
  await waitFor('engine health', async () => (await api('GET', '/v1/health')).ok, 120_000, 1_000);
  say('engine up');
  return p;
}

/** Streams /v1/stream?account=demo to the console while the test runs. */
function watchDemoStream() {
  const ctrl = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`${API}/v1/stream?account=demo`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!data) continue;
          const ev = JSON.parse(data.slice(6));
          if (ev.type === 'demo') say('  sse demo:', ev.step, ev.txHash ?? ev.reason ?? ev.error ?? '');
          else if (ev.type === 'feed') say('  sse feed:', ev.item.kind, ev.item.reason ?? '', 'latencyMs', ev.item.latencyMs);
          else if (ev.type === 'copy') say('  sse copy:', ev.stage, ev.blocked ?? ev.reason ?? '', ev.txHash ?? '');
          else if (ev.type === 'commit') say('  sse commit:', ev.kind, ev.commitState, 'block', ev.block);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return () => ctrl.abort();
}

async function runCycle(kind: 'trade' | 'blocked') {
  const started = await api('POST', `/v1/demo/${kind}`);
  say(`demo ${kind} started`, started.cycleId);
  const cycle = await waitFor(
    `demo ${kind} cycle`,
    async () => {
      const s = await api('GET', '/v1/demo');
      const c = s.cycles.find((x: any) => x.id === started.cycleId);
      return c && c.status !== 'running' ? c : undefined;
    },
    150_000,
    1_000,
  );
  check(`demo ${kind} cycle completed`, cycle.status === 'done', { status: cycle.status, error: cycle.error });
  return cycle;
}

async function signAction(account: Address, kind: number, data: Hex) {
  const nonce = await pub.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'actionNonce' });
  const deadline = BigInt((await blockTime()) + 600);
  const signature = await A.follower.signTypedData({
    domain: { name: 'Mirror Account', version: '1', chainId: 143, verifyingContract: account },
    types: { Action: [{ name: 'kind', type: 'uint8' }, { name: 'data', type: 'bytes' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'Action',
    message: { kind, data, nonce, deadline },
  });
  return { action: { kind, data, nonce: nonce.toString(), deadline: deadline.toString() }, signature };
}

/** Opens or closes on the Exchange directly from a test leader EOA (IOC, 50 bps from the mark). */
async function leaderTrade(key: Hex, orderType: number, lots: bigint, leverage: number) {
  const [, mark] = await pub.readContract({ address: EXCHANGE, abi: perplExchangeAbi, functionName: 'getPositionV2', args: [BigInt(BTC), 1n] });
  const args = [{ orderDescId: BigInt(Date.now()), perpId: BigInt(BTC), orderType, orderId: 0n, pricePNS: contractSlippageBound(orderType, mark, 50), lotLNS: lots, expiryBlock: 0n, postOnly: false, fillOrKill: false, immediateOrCancel: true, maxMatches: 100n, leverageHdths: BigInt(leverage), lastExecutionBlock: 0n, amountCNS: 0n, maxNegPnlCollatBPS: 1000n }] as const;
  // Simulate first so a revert is reported with its decoded Perpl error.
  await pub.simulateContract({ address: EXCHANGE, abi: perplExchangeAbi, functionName: 'execOrder', args, account: privateKeyToAccount(key) }).catch((err) => {
    throw new Error(`leader order would revert: ${(err as Error).message.split('\n').slice(0, 4).join(' ')}`);
  });
  const r = await send(wallet(key), { to: EXCHANGE, abi: perplExchangeAbi, functionName: 'execOrder', args: args as never });
  return r.transactionHash;
}

async function openPerplAccount(key: Hex) {
  const a = privateKeyToAccount(key);
  await fundAusd(a.address, 20_000_000n);
  await send(wallet(key), { to: AUSD, abi: authTokenAbi, functionName: 'approve', args: [EXCHANGE, 15_000_000n] });
  await send(wallet(key), { to: EXCHANGE, abi: perplExchangeAbi, functionName: 'createAccount', args: [15_000_000n] });
  const info = await pub.readContract({ address: EXCHANGE, abi: perplExchangeAbi, functionName: 'getAccountByAddr', args: [a.address] });
  return Number(info.accountId);
}

const position = async (accountId: number | bigint) => (await pub.readContract({ address: EXCHANGE, abi: perplExchangeAbi, functionName: 'getPositionV2', args: [BigInt(BTC), BigInt(accountId)] }))[0];

/** Policy as the contract takes it (bigints) and as the API takes it (strings). */
const apiPolicy = (p: Policy) => ({
  ...p,
  leaders: p.leaders.map((l) => ({ ...l, budgetCNS: l.budgetCNS.toString() })),
  markets: p.markets.map((m) => ({ ...m, maxNotionalCNS: m.maxNotionalCNS.toString() })),
});

async function feedItem(account: Address, pred: (f: any) => boolean, what: string, timeoutMs = 60_000) {
  return waitFor(what, async () => (await api('GET', `/v1/accounts/${account}/feed?limit=200`)).items.find(pred), timeoutMs, 500);
}

async function main() {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  await startAnvil();
  const markTimer = await keepMarksFresh();

  const { factory, keeperRegistry, block } = deploy();
  const code = await pub.getCode({ address: await pub.readContract({ address: factory, abi: mirrorAccountFactoryAbi, functionName: 'implementation' }) });
  check('MirrorAccount implementation deployed above EIP-170 (anvil --disable-code-size-limit)', (code?.length ?? 0) / 2 - 1 > 24_576, { bytes: (code?.length ?? 0) / 2 - 1 });

  // Leaders with their own Perpl accounts, funded from the Exchange's AUSD on the fork.
  const leaderId = await openPerplAccount(K.leader);
  const leader2Id = await openPerplAccount(K.leader2);
  await fundAusd(A.follower.address, 20_000_000n);
  check('demo leader and second leader Perpl accounts opened', leaderId > 0 && leader2Id > 0, { leaderId, leader2Id });

  const salt = pad('0x0', { size: 32 });
  const predicted = await pub.readContract({ address: factory, abi: mirrorAccountFactoryAbi, functionName: 'predictAccount', args: [A.follower.address, salt] });

  await startEngine({
    NETWORK: 'localFork',
    RPC_URL: RPC,
    WS_RPC_URL: 'ws://127.0.0.1:8545',
    LOG_SUBSCRIPTION: 'auto',
    FACTORY_ADDRESS: factory,
    KEEPER_REGISTRY_ADDRESS: keeperRegistry,
    MIRROR_DEPLOY_BLOCK: String(block - 5),
    KEEPER_PRIVATE_KEYS: `${K.keeperA},${K.keeperB}`,
    RELAYER_PRIVATE_KEY: K.relayer,
    DEMO_LEADER_PRIVATE_KEY: K.leader,
    DEMO_FOLLOWER_ACCOUNT: predicted,
    TEAM_RUN_ADDRESSES: A.follower.address,
    STOP_EXECUTOR_PRIVATE_KEY: K.stranger,
    STOP_CHECK_MS: '1000',
    STOP_RETRY_MS: '5000',
    DB_PATH: join(work, 'engine.db'),
    PORT: String(API_PORT),
    LEADER_BACKFILL_BLOCKS: '0',
    DEMO_HOLD_MS: process.env.DEMO_HOLD_MS ?? '10000',
    DEMO_IP_HOURLY: '10',
    NANSEN_ENABLED: '0',
    LOG_LEVEL: 'info',
  });
  const stopStream = watchDemoStream();

  // 1. Create the follower account through the relayer (plus one non-team user account for the stats check).
  const created = await api('POST', '/v1/relay/create', { owner: A.follower.address, salt: '0' });
  check('relay create deployed predicted account', created.status === 'success' && getAddress(created.account) === predicted, created);
  const userCreated = await api('POST', '/v1/relay/create', { owner: A.user.address, salt: '0' });
  check('relay create (non-team user)', userCreated.status === 'success', { account: userCreated.account });
  const account = predicted;

  // 2. Deposit 12 AUSD with an EIP-2612 permit, relayed.
  const [, name, version] = await pub.readContract({ address: AUSD, abi: authTokenAbi, functionName: 'eip712Domain' });
  const nonce = await pub.readContract({ address: AUSD, abi: authTokenAbi, functionName: 'nonces', args: [A.follower.address] });
  const amount = 12_000_000n;
  const deadline = BigInt((await blockTime()) + 3600);
  const permitSig = await A.follower.signTypedData({
    domain: { name, version, chainId: 143, verifyingContract: AUSD },
    types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'Permit',
    message: { owner: A.follower.address, spender: account, value: amount, nonce, deadline },
  });
  const dep = await api('POST', '/v1/relay/deposit', { account, mode: 'permit', amount: amount.toString(), deadline: deadline.toString(), signature: permitSig });
  const perplId = await pub.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'perplAccountId' });
  check('relay deposit (permit) opened the Perpl account', dep.status === 'success' && perplId > 0, { tx: dep.txHash, gasUsed: dep.gasUsed, gasLimit: dep.gasLimit, perplId });
  check('gas limit = Monad eth_estimateGas x headroom (used < limit)', BigInt(dep.gasUsed) < BigInt(dep.gasLimit), { gasUsed: dep.gasUsed, gasLimit: dep.gasLimit });

  // 3. Follow three leaders with a tight entry guard: the demo leader, a second test leader, and a live mainnet
  //    BTC position whose entry is far from the mark. Match now on the live leader must be Blocked(EntryTooFar).
  const live = await pickLiveLeader([leaderId, leader2Id], 5);
  const ratio = Math.max(1, Math.floor(20_000 / Number(live.lots)));
  const policy: Policy = {
    maxLeverageHdths: 300,
    maxSlippageBps: 80,
    dailyLossBps: 500,
    drawdownBps: 1500,
    expiry: (await blockTime()) + 7 * 86_400,
    maxEntryDeviationBps: 5,
    stopSlippageBps: 200,
    flattenOnStop: true,
    leaders: [
      { accountId: leaderId, ratioBps: 5_000, budgetCNS: 5_000_000n, lossStopBps: 5_000 },
      { accountId: leader2Id, ratioBps: 10_000, budgetCNS: 5_000_000n, lossStopBps: 0 },
      { accountId: live.id, ratioBps: ratio, budgetCNS: 5_000_000n, lossStopBps: 0 },
    ],
    markets: [{ perpId: BTC, maxNotionalCNS: 50_000_000n }],
  };
  const quote = await api('POST', '/v1/quote/follow', { owner: A.follower.address, leaderAccountId: live.id, policy: apiPolicy(policy) });
  const q0 = quote.quotes[0];
  say('quote', { live, ratio, simulation: quote.simulation, q0 });
  check('quote predicts EntryTooFar for the live leader, with the entry bound', q0?.wouldBlock?.reason === 'EntryTooFar' && q0.entryBoundPNS !== null && quote.matchOrders.length === 0, { wouldBlock: q0?.wouldBlock, leaderEntry: q0?.leaderEntryPNS, entryBound: q0?.entryBoundPNS, price: q0?.pricePNS, mark: q0?.markPNS });

  // Send the predicted-blocked order anyway so the rule hit is recorded onchain.
  const order: MirrorOrder = { leaderAccountId: live.id, perpId: BTC, orderType: q0.orderType, lotLNS: BigInt(q0.lotLNS), pricePNS: BigInt(q0.pricePNS), leverageHdths: q0.leverageHdths, maxMatches: 100, leaderRef: `0x${'00'.repeat(32)}`, leaderFillPNS: 0n };
  const follow = await signAction(account, ACTION.FOLLOW, encodeFollowData(policy, [order]));
  const followRes = await api('POST', '/v1/relay/execute', { account, ...follow });
  const entryBlocked = await feedItem(account, (f) => f.kind === 'Blocked' && f.txHash === followRes.txHash, 'EntryTooFar block in the feed');
  const eb = entryBound(live.side, live.entry, 5)!;
  check('entry guard: live leader copy Blocked(EntryTooFar), limit = entry bound, actual = mark', entryBlocked.reason === 'EntryTooFar' && BigInt(entryBlocked.limit) === eb && entryBlocked.data?.markPNS === entryBlocked.actual, { tx: followRes.txHash, limit: entryBlocked.limit, actual: entryBlocked.actual, mark: entryBlocked.data?.markPNS });
  check('nothing was opened for the live leader', (await position(perplId)).lotLNS === 0n);

  // Loosen the guard for the demo leg (ACTION_SET_POLICY).
  policy.maxEntryDeviationBps = 300;
  const setPolicy = await signAction(account, ACTION.SET_POLICY, encodePolicy(policy));
  const spRes = await api('POST', '/v1/relay/execute', { account, ...setPolicy });
  check('relay execute(ACTION_SET_POLICY) with the new policy fields', spRes.status === 'success', { tx: spRes.txHash });
  await waitFor('registry to index the policy', async () => {
    const a = await api('GET', `/v1/accounts/${account}`);
    return a.policy?.maxEntryDeviationBps === 300 && a.policy?.leaders?.length === 3 && a.policy.stopSlippageBps === 200 ? a : undefined;
  });

  // 4. Demo trade: leader opens 1 lot at 2x; the engine copies it; leader closes; the engine copies the close.
  const trade = await runCycle('trade');
  const copyOpen = await feedItem(account, (f) => f.kind === 'Mirrored' && f.leaderRef === trade.open_tx, 'copied open');
  const copyClose = await feedItem(account, (f) => f.kind === 'Mirrored' && f.leaderRef === trade.close_tx, 'copied close');
  check('Mirrored event for the copied open, latency recorded', copyOpen.orderTypeName === 'OpenLong' && copyOpen.latencyMs > 0, { tx: copyOpen.txHash, lots: copyOpen.lotLNS, lev: copyOpen.leverageHdths, latencyMs: copyOpen.latencyMs, commitState: copyOpen.commitState });
  const p = copyOpen.proof;
  check('copy proof in Mirrored: leader fill, leader entry, mark, follower fill, deviation', p && p.leaderFillPNS !== '0' && p.leaderEntryPNS !== '0' && p.markPNS !== '0' && p.fillPNS !== '0' && typeof p.entryDeviationBps === 'number', p);
  check('Mirrored event for the copied close', copyClose.orderTypeName === 'CloseLong' && copyClose.data.lotsAfter === '0', { tx: copyClose.txHash, lots: copyClose.lotLNS, latencyMs: copyClose.latencyMs, proof: copyClose.proof });

  // 5. Demo blocked: leader opens at 10x > follower max 3x; the copy is blocked onchain with its own tx.
  const blocked = await runCycle('blocked');
  const blockedEv = await feedItem(account, (f) => f.kind === 'Blocked' && f.leaderRef === blocked.open_tx, 'LeverageTooHigh block');
  check('Blocked event LeverageTooHigh (limit 300, actual 1000)', blockedEv.reason === 'LeverageTooHigh' && blockedEv.limit === '300' && blockedEv.actual === '1000', { tx: blockedEv.txHash, reason: blockedEv.reason, limit: blockedEv.limit, actual: blockedEv.actual });
  const receipt = await pub.getTransactionReceipt({ hash: blockedEv.txHash });
  check('blocked copy is its own successful keeper tx', receipt.status === 'success' && [A.keeperA.address, A.keeperB.address].includes(getAddress(receipt.from)), { from: receipt.from });
  await waitFor('demo leader flat', async () => (await position(leaderId)).lotLNS === 0n);

  // 6. Multi-leader: the demo leader opens 4 lots (follower target ceil(4 x 50%) = 2), then the second leader
  //    opens in the same market: its copy is Blocked(MarketHeldByOtherLeader).
  const open4 = await leaderTrade(K.leader, OPEN_LONG, 4n, 200);
  const copy4 = await feedItem(account, (f) => f.kind === 'Mirrored' && f.leaderRef === open4, 'copy of the 4-lot open');
  check('demo leader 4 lots copied at 50% (2 lots), market held by the demo leader', copy4.data.lotsAfter === '2' && Number(await pub.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'marketLeader', args: [BigInt(BTC)] })) === leaderId, { lotsAfter: copy4.data.lotsAfter });
  const open2 = await leaderTrade(K.leader2, OPEN_LONG, 2n, 200);
  const held = await feedItem(account, (f) => f.kind === 'Blocked' && f.leaderRef === open2, 'MarketHeldByOtherLeader block');
  check('second leader blocked from the first leader market (MarketHeldByOtherLeader)', held.reason === 'MarketHeldByOtherLeader' && held.limit === String(leader2Id) && held.actual === String(leaderId), { tx: held.txHash, limit: held.limit, actual: held.actual });

  // 7. Keeper close sized to target: the demo leader goes 4 -> 1 lot; target ceil(1 x 50%) = 1, so close 1 of 2.
  const reduce = await leaderTrade(K.leader, CLOSE_LONG, 3n, 0);
  const closeCopy = await feedItem(account, (f) => f.kind === 'Mirrored' && f.leaderRef === reduce, 'close copy of the reduction');
  const onchainTarget = await pub.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'targetLots', args: [BigInt(BTC), leaderId, 0] });
  const lp = await position(leaderId);
  const engineTarget = targetLots({ ratioBps: 5_000, side: lp.positionType === 1 ? 1 : 0, lots: lp.lotLNS }, 0);
  const fpos = await position(perplId);
  check('keeper close sized to the holder target (2 -> 1), never below', closeCopy.orderTypeName === 'CloseLong' && closeCopy.lotLNS === '1' && fpos.lotLNS === onchainTarget && onchainTarget === 1n, { lots: closeCopy.lotLNS, after: fpos.lotLNS, onchainTarget });
  check('engine targetLots == contract targetLots (per leader)', onchainTarget === engineTarget, { onchainTarget, engineTarget });
  const l2Target = await pub.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'targetLots', args: [BigInt(BTC), leader2Id, 0] });
  const l2 = await position(leader2Id);
  check('engine targetLots == contract targetLots (second leader)', l2Target === targetLots({ ratioBps: 10_000, side: l2.positionType === 1 ? 1 : 0, lots: l2.lotLNS }, 0), { l2Target });

  // 8. Take-profit level executed by a stranger: set TP 30 bps above the mark (not reached: nothing is sent),
  //    then move the fork mark above it; the stop executor simulates and sends triggerLevel.
  const startMark = forkMark;
  const tp = (startMark * 10_030n) / 10_000n;
  const lv = await signAction(account, ACTION.SET_LEVELS, encodeLevels([{ perpId: BTC, side: 0, stopLossPNS: 0n, takeProfitPNS: tp, slippageBps: 200 }]));
  const lvRes = await api('POST', '/v1/relay/execute', { account, ...lv });
  check('relay execute(ACTION_SET_LEVELS) take-profit', lvRes.status === 'success', { tx: lvRes.txHash, tp });
  await waitFor('level indexed', async () => ((await api('GET', `/v1/accounts/${account}`)).levels?.length ? true : undefined));
  await sleep(4_000);
  const early = (await api('GET', `/v1/accounts/${account}/stops`)).items;
  check('stop executor sends nothing while the level is not reached', early.length === 0 && (await position(perplId)).lotLNS === 1n, { attempts: early.length });
  forkMark = (startMark * 10_040n) / 10_000n;
  await pushMark();
  const tpEv = await feedItem(account, (f) => f.kind === 'StopTriggered' && f.reason === 'TakeProfit', 'TakeProfit StopTriggered', 60_000);
  const tpReceipt = await pub.getTransactionReceipt({ hash: tpEv.txHash });
  const afterTp = await position(perplId);
  check('take-profit triggered by a stranger via the stop executor; follower flat', getAddress(tpReceipt.from) === A.stranger.address && getAddress(tpEv.data.caller) === A.stranger.address && afterTp.lotLNS === 0n, { tx: tpEv.txHash, from: tpReceipt.from, level: tpEv.limit, mark: tpEv.actual, gasUsed: tpReceipt.gasUsed });
  const attempts = (await api('GET', `/v1/accounts/${account}/stops`)).items;
  check('stop executor recorded only simulated-then-mined triggers, with an estimated gas limit', attempts.length >= 1 && attempts.every((a: any) => a.status === 'mined' || a.status === 'simulation_reverted') && attempts.some((a: any) => a.status === 'mined' && BigInt(a.gasUsed) < BigInt(a.gasLimit)), attempts);
  forkMark = startMark;
  await pushMark();

  // Leaders flatten (no follower position left for them), then closeAll via the relayer.
  await leaderTrade(K.leader, CLOSE_LONG, (await position(leaderId)).lotLNS, 0);
  await leaderTrade(K.leader2, CLOSE_LONG, (await position(leader2Id)).lotLNS, 0);
  const closeAll = await signAction(account, ACTION.CLOSE_ALL, pad('0x64', { size: 32 }));
  const closeRes = await api('POST', '/v1/relay/execute', { account, ...closeAll });
  const finalPos = await position(perplId);
  check('closeAll via relayer leaves the follower flat', closeRes.status === 'success' && finalPos.lotLNS === 0n, { tx: closeRes.txHash });

  // 9. Stats exclude team-run accounts; team-run listed separately.
  await sleep(2_000);
  const stats = await api('GET', '/v1/stats');
  check('stats exclude team-run', stats.excludesTeamRun === true && stats.accountsCreated === 1 && stats.fundedAccounts === 0 && stats.copiesExecuted === 0 && stats.copiesBlocked === 0 && stats.stopsTriggered === 0, { accountsCreated: stats.accountsCreated, copiesExecuted: stats.copiesExecuted });
  check('team-run section lists demo copies, blocks and stops', stats.teamRun.accounts.includes(account.toLowerCase()) && stats.teamRun.copiesExecuted >= 3 && stats.teamRun.copiesBlockedPerRule.LeverageTooHigh >= 1 && stats.teamRun.copiesBlockedPerRule.MarketHeldByOtherLeader >= 1 && stats.teamRun.copiesBlockedPerRule.EntryTooFar >= 1 && stats.teamRun.stopsTriggered >= 1 && stats.teamRun.medianLatencyMs > 0, {
    copiesExecuted: stats.teamRun.copiesExecuted,
    blocked: stats.teamRun.copiesBlockedPerRule,
    stops: stats.teamRun.stopsTriggeredByKind,
    medianLatencyMs: stats.teamRun.medianLatencyMs,
  });

  // 10. Ops surface.
  const health = await api('GET', '/v1/health');
  const markets = await api('GET', '/v1/markets');
  const btc = markets.markets.find((m: any) => m.perpId === BTC);
  const metricsText = await (await fetch(`${API}/metrics`)).text();
  check('health + metrics', health.ok && health.keeper?.address && health.stopExecutor?.enabled && /mirror_copies_submitted_total/.test(metricsText) && /mirror_stop_triggers_total/.test(metricsText), { streams: health.streams, perpl: health.perpl, nansen: health.nansen });
  say('markets[BTC]', { mark: btc?.markPNS, bid: btc?.bestBidPNS, ask: btc?.bestAskPNS, source: btc?.source, trades: btc?.recentTrades?.length });
  const feedFinal = (await api('GET', `/v1/accounts/${account}/feed?limit=200`)).items;
  say('commit states', [...new Set(feedFinal.map((f: any) => f.commitState))]);
  stopStream();
  clearInterval(markTimer);
}

async function cleanup() {
  restoreDeployments();
  for (const c of children.reverse()) {
    if (c.exitCode === null) {
      c.kill('SIGTERM');
      await Promise.race([new Promise((r) => c.once('exit', r)), sleep(8_000)]);
      if (c.exitCode === null) c.kill('SIGKILL');
    }
  }
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nE2E FAILED:', (err as Error).message);
    console.error(`engine log: ${join(work, 'engine.log')}`);
    await cleanup();
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
    process.exit(1);
  });

