import { createPublicClient, defineChain, http, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Config } from './config.js';
import { Db } from './db.js';
import type { Logger } from './log.js';
import { metrics } from './metrics.js';
import { ChainStreams } from './chain/streams.js';
import { Reads } from './chain/reads.js';
import { FeeOracle, SenderPool, TxSender, type SenderOptions } from './chain/sender.js';
import { MarketData } from './perpl/market.js';
import { Bus } from './services/bus.js';
import { Registry, nullRegistry } from './services/registry.js';
import { LeaderWatcher } from './services/watcher.js';
import { Copier } from './services/copier.js';
import { Tracker } from './services/tracker.js';
import { Relayer } from './services/relayer.js';
import { QuoteService } from './services/quote.js';
import { DemoService } from './services/demo.js';
import { LeaderService } from './services/leaders.js';
import { Views } from './services/views.js';
import { PushService } from './services/push.js';
import { RateLimiter } from './services/ratelimit.js';
import { createNansenSignal, type NansenSignal } from './nansen/client.js';
import { StopExecutor } from './services/stops.js';
import { mirrorAccountFactoryAbi } from './abi/MirrorAccountFactory.js';
import { ThinBookGuard } from './services/guard.js';
import { IndexerClient } from './services/indexer.js';
import { CopyQualityService } from './services/quality.js';
import { AdversarialService } from './services/adversarial.js';
import { BacktestService } from './services/backtest.js';

export interface Engine {
  cfg: Config;
  db: Db;
  client: PublicClient;
  streams: ChainStreams;
  reads: Reads;
  market: MarketData;
  bus: Bus;
  limiter: RateLimiter;
  fees: FeeOracle;
  keepers?: SenderPool;
  relayerSender?: TxSender;
  registry?: Registry;
  watcher: LeaderWatcher;
  copier?: Copier;
  tracker: Tracker;
  relayer?: Relayer;
  quote?: QuoteService;
  demo?: DemoService;
  leaders: LeaderService;
  views: Views;
  push: PushService;
  nansen: NansenSignal;
  stops?: StopExecutor;
  guard: ThinBookGuard;
  quality: CopyQualityService;
  adversarial: AdversarialService;
  backtest: BacktestService;
  balances: Map<string, bigint>;
  depositCap?: bigint;
  startedMs: number;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function buildEngine(cfg: Config, log: Logger): Engine {
  const env = cfg.env;
  const chain = defineChain({
    id: cfg.chainId,
    name: 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(cfg.rpcUrl, { timeout: 15_000, retryCount: 2, retryDelay: 200 }) }) as PublicClient;
  const db = new Db(env.DB_PATH);
  const bus = new Bus();
  const limiter = new RateLimiter();
  const streams = new ChainStreams(client, cfg.wsRpcUrl, env.LOG_SUBSCRIPTION, env.POLL_INTERVAL_MS, log.child({ mod: 'streams' }));
  const reads = new Reads(client, cfg.exchange, cfg.collateral);
  const fees = new FeeOracle(client);
  const bookMarkets = [...new Set([env.DEMO_PERP_ID, ...cfg.markets.map((m) => m.perpId)])];
  const market = new MarketData(
    client,
    cfg.exchange,
    cfg.markets,
    { apiUrl: cfg.perplApiUrl, wsUrl: cfg.perplWsUrl, wsEnabled: env.PERPL_WS_ENABLED, chainId: cfg.perplChainId, bookMarkets },
    log.child({ mod: 'perpl' }),
  );

  const senderOpts: SenderOptions = {
    chainId: cfg.chainId,
    priorityFeeWei: BigInt(Math.round(env.PRIORITY_FEE_GWEI * 1e9)),
    gasMultiplier: env.GAS_LIMIT_MULTIPLIER,
    bookGasMultiplier: env.BOOK_GAS_LIMIT_MULTIPLIER,
    timeoutMs: env.TX_TIMEOUT_MS,
    circuitFailures: env.CIRCUIT_FAILURES,
    circuitCooldownMs: env.CIRCUIT_COOLDOWN_MS,
  };
  // One key may serve several roles; reuse a single TxSender per key so nonces are shared.
  const senders = new Map<string, TxSender>();
  const senderFor = (key: `0x${string}`, name: string) => {
    const account = privateKeyToAccount(key);
    const existing = senders.get(account.address);
    if (existing) return existing;
    const s = new TxSender(name, account, client, fees, senderOpts, log.child({ mod: 'sender', sender: name }));
    senders.set(account.address, s);
    return s;
  };
  const keepers = cfg.keeperKeys.length ? new SenderPool(cfg.keeperKeys.map((k, i) => senderFor(k, `keeper${i}`))) : undefined;
  const relayerSender = cfg.relayerKey ? senderFor(cfg.relayerKey, 'relayer') : undefined;
  const demoLeader = cfg.demoLeaderKey ? senderFor(cfg.demoLeaderKey, 'demo-leader') : undefined;
  if (demoLeader) cfg.teamRun.add(demoLeader.address.toLowerCase());

  const demoFollower = cfg.demoFollowerAccount?.toLowerCase();
  const registry = cfg.factory
    ? new Registry(db, client, streams, cfg.factory, cfg.deployBlock ?? Number(0), cfg.teamRun, cfg.explorerTx, bus, log.child({ mod: 'registry' }))
    : undefined;
  const relayer = relayerSender ? new Relayer(client, relayerSender, cfg.factory, cfg.collateral, log.child({ mod: 'relayer' })) : undefined;
  const guard = new ThinBookGuard(db, market, bus, env.THIN_BOOK_GUARD_ENABLED, env.THIN_BOOK_DEPTH_MULTIPLE, cfg.explorerTx);
  const copier = registry && keepers
    ? new Copier(db, reads, registry, keepers, market, bus, { safetyBps: env.SLIPPAGE_SAFETY_BPS, maxMatches: env.MAX_MATCHES, blockedSubmitReasons: env.BLOCKED_SUBMIT_REASONS, demoFollower, guard }, log.child({ mod: 'copier' }))
    : undefined;
  // The watcher also runs without a factory: it stores Perpl position events for the leader ranking.
  const watcher = new LeaderWatcher(db, client, streams, cfg.exchange, (id) => registry?.leaderIds().has(id) ?? false, log.child({ mod: 'watcher' }));
  if (copier) watcher.onChange = (c) => void copier.onLeaderChange(c).catch((err) => log.error({ err: (err as Error).message }, 'copy failed'));
  if (registry) {
    registry.onFeed = (item) => {
      if (demoFollower && item.account === demoFollower) bus.publish('demo', { type: 'feed', item });
    };
  }
  const tracker = new Tracker(db, streams, bus, fees, demoFollower, log.child({ mod: 'tracker' }));
  const demo = registry
    ? new DemoService(db, reads, demoLeader, cfg.exchange, registry, market, bus, limiter, {
        perpId: env.DEMO_PERP_ID,
        lots: env.DEMO_LOTS,
        leverageHdths: env.DEMO_LEVERAGE_HDTHS,
        blockedLeverageHdths: env.DEMO_BLOCKED_LEVERAGE_HDTHS,
        holdMs: env.DEMO_HOLD_MS,
        slippageBps: env.DEMO_SLIPPAGE_BPS,
        ipHourly: env.DEMO_IP_HOURLY,
        dailyCap: env.DEMO_DAILY_CAP,
        followerAccount: cfg.demoFollowerAccount,
      }, log.child({ mod: 'demo' }))
    : undefined;
  // API key when set, else x402 when a payer is set, else no Nansen signal (ranking unaffected).
  const nansen = createNansenSignal(db, {
    enabled: env.NANSEN_ENABLED,
    apiUrl: env.NANSEN_API_URL,
    apiKey: env.NANSEN_API_KEY,
    payer: env.NANSEN_PAYER_PRIVATE_KEY ? privateKeyToAccount(env.NANSEN_PAYER_PRIVATE_KEY as `0x${string}`) : undefined,
    network: env.NANSEN_NETWORK,
    maxPerCall: BigInt(env.NANSEN_MAX_PER_CALL),
    dailyBudget: BigInt(env.NANSEN_DAILY_BUDGET),
    cacheHours: env.NANSEN_CACHE_HOURS,
  }, log.child({ mod: 'nansen' }));
  // Stop triggers are permissionless; a dedicated signer if configured, else the keeper pool.
  const stopSender = env.STOP_EXECUTOR_PRIVATE_KEY ? senderFor(env.STOP_EXECUTOR_PRIVATE_KEY as `0x${string}`, 'stops') : undefined;
  const stops = registry && env.STOP_EXECUTOR_ENABLED && (stopSender || keepers)
    ? new StopExecutor(db, reads, () => registry.all(), () => stopSender ?? keepers!.pick(), bus, { intervalMs: env.STOP_CHECK_MS, retryMs: env.STOP_RETRY_MS }, log.child({ mod: 'stops' }), (res) => registry.handleReceipt(res))
    : undefined;
  const fallbackRegistry = registry ?? nullRegistry(cfg.teamRun);
  const indexer = new IndexerClient(env.INDEXER_GRAPHQL_URL, log.child({ mod: 'indexer' }));
  const isTeamRun = (account: string, owner: string | null, leaderId: number) =>
    fallbackRegistry.isTeamRun(account) || (owner !== null && fallbackRegistry.isTeamRun(owner)) || (leaderId !== 0 && leaderId === (demo?.leaderAccountId ?? 0));
  const quality = new CopyQualityService(db, indexer, isTeamRun);
  const adversarial = new AdversarialService(db, {
    exitBlocks: env.ADVERSARIAL_EXIT_BLOCKS,
    moveBps: env.ADVERSARIAL_MOVE_BPS,
    worseBps: env.ADVERSARIAL_WORSE_BPS,
    flagScore: env.ADVERSARIAL_FLAG_SCORE,
    minIncidents: env.ADVERSARIAL_MIN_INCIDENTS,
  }, isTeamRun);
  const backtest = new BacktestService(indexer, quality, { defaultSlippageBps: env.BACKTEST_DEFAULT_SLIPPAGE_BPS, takerFeeBps: env.BACKTEST_TAKER_FEE_BPS, safetyBps: env.SLIPPAGE_SAFETY_BPS, maxEvents: env.BACKTEST_MAX_EVENTS }, { db, markets: cfg.markets });
  const quote = relayer
    ? new QuoteService(client, reads, market, relayer, env.SLIPPAGE_SAFETY_BPS, env.MAX_MATCHES, { guard, adversarial, refuseFlagged: env.ADVERSARIAL_REFUSE_FOLLOWS })
    : undefined;
  const leaders = new LeaderService(db, reads, market, fallbackRegistry, nansen, env.INDEXER_GRAPHQL_URL, () => demo?.leaderAccountId ?? 0, log.child({ mod: 'leaders' }));
  const views = new Views(db, reads, market, fallbackRegistry, relayer, cfg.explorerTx);
  const push = new PushService(db, fallbackRegistry, bus, { enabled: env.PUSH_ENABLED, accessToken: env.EXPO_ACCESS_TOKEN }, log.child({ mod: 'push' }));

  const balances = new Map<string, bigint>();
  let balanceTimer: NodeJS.Timeout | undefined;
  const refreshBalances = async () => {
    for (const s of senders.values()) {
      try {
        const b = await client.getBalance({ address: s.address });
        balances.set(s.address, b);
        metrics.balanceWei.set(Number(b), { signer: s.name, address: s.address });
      } catch {
        /* next round */
      }
    }
  };

  const engine: Engine = {
    cfg, db, client, streams, reads, market, bus, limiter, fees, keepers, relayerSender, registry, watcher, copier, tracker, relayer, quote, demo,
    leaders, views, push, nansen, stops, guard, quality, adversarial, backtest, balances, startedMs: Date.now(),
    async start() {
      const id = await client.getChainId();
      if (id !== cfg.chainId) throw new Error(`RPC chain id ${id} != configured ${cfg.chainId}`);
      await market.start();
      await streams.start();
      tracker.start();
      if (registry) await registry.start();
      await watcher.start(env.LEADER_BACKFILL_BLOCKS);
      if (registry) registry.onLeadersChanged = () => log.debug({ leaders: [...registry.leaderIds()] }, 'leader set changed');
      await demo?.init();
      if (stops) streams.onHead(() => stops.kick());
      if (cfg.factory) {
        engine.depositCap = await client.readContract({ address: cfg.factory, abi: mirrorAccountFactoryAbi, functionName: 'depositCap' }).catch(() => undefined);
      }
      push.start();
      await refreshBalances();
      balanceTimer = setInterval(() => void refreshBalances(), 30_000);
      balanceTimer.unref();
      log.info(
        {
          chainId: id,
          streams: streams.mode,
          factory: cfg.factory ?? null,
          keepers: keepers?.addresses ?? [],
          relayer: relayerSender?.address ?? null,
          demoLeader: demoLeader?.address ?? null,
          demoFollower: cfg.demoFollowerAccount ?? null,
          leaders: registry ? [...registry.leaderIds()] : [],
          stopExecutor: stops ? (stopSender?.address ?? 'keeper pool') : null,
          nansen: nansen.mode,
          gasMultiplier: env.GAS_LIMIT_MULTIPLIER,
          bookGasMultiplier: env.BOOK_GAS_LIMIT_MULTIPLIER,
        },
        'engine started',
      );
    },
    async stop() {
      clearInterval(balanceTimer);
      streams.stop();
      market.stop();
      await copier?.drain(10_000);
      db.close();
    },
  };
  return engine;
}
