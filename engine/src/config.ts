import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getAddress, isAddress, type Address, type Hex } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
// src/ when run with tsx, dist/src/ when compiled.
const engineRoot = resolve(here, here.includes(`${sep}dist${sep}`) ? '../..' : '..');

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true' || v === 'yes');

const optAddress = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    if (!isAddress(v)) {
      ctx.addIssue({ code: 'custom', message: `invalid address ${v}` });
      return z.NEVER;
    }
    return getAddress(v);
  });

const addressList = z
  .string()
  .optional()
  .transform((v, ctx) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((a) => {
        if (!isAddress(a)) ctx.addIssue({ code: 'custom', message: `invalid address ${a}` });
        return getAddress(a);
      }),
  );

const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected 0x-prefixed 32-byte hex private key');

const keyList = z
  .string()
  .optional()
  .transform((v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(privateKey));

const int = (d: number) => z.coerce.number().int().default(d);

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(8080),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('*'),

  NETWORK: z.enum(['mainnet', 'testnet', 'localFork', 'localnet']).default('mainnet'),
  /** localnet: the env file written by localnet/start.mjs (Perpl's exchange from Perpl's test kit plus Mirror). */
  LOCALNET_ENV_PATH: z.string().optional(),
  SHARED_CONFIG_PATH: z.string().optional(),
  RPC_URL: z.string().url().optional(),
  WS_RPC_URL: z.string().optional(),
  /** auto: monadLogs/monadNewHeads when the WS endpoint supports them, else standard eth_subscribe, else polling. */
  LOG_SUBSCRIPTION: z.enum(['auto', 'monad', 'standard', 'poll']).default('auto'),
  POLL_INTERVAL_MS: int(400),

  FACTORY_ADDRESS: optAddress,
  KEEPER_REGISTRY_ADDRESS: optAddress,
  MIRROR_DEPLOY_BLOCK: z.coerce.number().int().optional(),
  PERPL_EXCHANGE: optAddress,
  COLLATERAL_TOKEN: optAddress,

  /** Default: the selected network's Perpl API (mainnet app.perpl.xyz, testnet testnet.perpl.xyz). */
  PERPL_API_URL: z.string().optional(),
  PERPL_WS_URL: z.string().optional(),
  PERPL_WS_ENABLED: z.string().default('1').transform((v) => v !== '0' && v !== 'false'),
  PERPL_CHAIN_ID: z.coerce.number().int().optional(),

  KEEPER_PRIVATE_KEYS: keyList,
  RELAYER_PRIVATE_KEY: privateKey.optional(),
  DEMO_LEADER_PRIVATE_KEY: privateKey.optional(),
  DEMO_FOLLOWER_ACCOUNT: optAddress,
  TEAM_RUN_ADDRESSES: addressList,

  DB_PATH: z.string().default(join(engineRoot, 'data', 'engine.db')),

  SLIPPAGE_SAFETY_BPS: int(5),
  MAX_MATCHES: int(100),
  PRIORITY_FEE_GWEI: z.coerce.number().default(2),
  /** Headroom over Monad's eth_estimateGas for ordinary calls. Monad charges the full limit; never below 1. */
  GAS_LIMIT_MULTIPLIER: z.coerce.number().min(1).default(1.2),
  /** Headroom for book- and price-dependent calls (keeper copies, stop triggers, match now, demo orders). */
  BOOK_GAS_LIMIT_MULTIPLIER: z.coerce.number().min(1).default(1.3),
  TX_TIMEOUT_MS: int(20_000),
  /** Block reasons for which a blocked opening copy is still submitted so the rule hit is recorded onchain. */
  BLOCKED_SUBMIT_REASONS: z
    .string()
    .default(
      'LeverageTooHigh,LeverageTooLow,SlippageTooHigh,ExceedsMaxNotional,ExceedsLeaderTarget,DailyLossStop,DrawdownStop,StaleMark,EntryTooFar,MarketHeldByOtherLeader,LeaderBudgetExceeded,LeaderLossStop',
    )
    .transform((v) => new Set(v.split(',').map((s) => s.trim()).filter(Boolean))),
  /** Stop executor: sends triggerLevel / triggerAccountStop / triggerLeaderStop once true onchain and simulated. */
  STOP_EXECUTOR_ENABLED: z.string().default('1').transform((v) => v !== '0' && v !== 'false'),
  /** Signer for stop triggers (anyone may trigger); defaults to the keeper pool. */
  STOP_EXECUTOR_PRIVATE_KEY: privateKey.optional(),
  STOP_CHECK_MS: int(3_000),
  /** After a trigger was sent or its simulation reverted, wait this long before trying the same stop again. */
  STOP_RETRY_MS: int(15_000),
  CIRCUIT_FAILURES: int(5),
  CIRCUIT_COOLDOWN_MS: int(30_000),

  DEMO_PERP_ID: int(1),
  DEMO_LOTS: int(1),
  DEMO_LEVERAGE_HDTHS: int(200),
  DEMO_BLOCKED_LEVERAGE_HDTHS: int(1000),
  DEMO_HOLD_MS: int(20_000),
  DEMO_SLIPPAGE_BPS: int(50),
  DEMO_IP_HOURLY: int(3),
  DEMO_DAILY_CAP: int(48),

  RELAY_OWNER_HOURLY: int(30),
  RELAY_IP_HOURLY: int(60),
  QUOTE_IP_MINUTE: int(30),

  INDEXER_GRAPHQL_URL: z.string().url().optional(),
  LEADER_BACKFILL_BLOCKS: int(20_000),

  /** Thin-book guard on opening copies (keeper copies and match-now quotes). 0 turns it off (e.g. anvil). */
  THIN_BOOK_GUARD_ENABLED: z.string().default('1').transform((v) => v !== '0' && v !== 'false'),
  /** Depth on the taking side within the limit must be at least this multiple of the order's lots. */
  THIN_BOOK_DEPTH_MULTIPLE: z.coerce.number().min(1).default(2),
  /** Adversarial leader flags: a leader exit within this many blocks of followers' fills counts. */
  ADVERSARIAL_EXIT_BLOCKS: int(20),
  /** Leader fill moved the last price by more than this (bps) ... */
  ADVERSARIAL_MOVE_BPS: int(30),
  /** ... and followers filled worse than the leader by more than this (bps). */
  ADVERSARIAL_WORSE_BPS: int(20),
  /** A leader is flagged when its score (0..100) reaches this and it has at least ADVERSARIAL_MIN_INCIDENTS. */
  ADVERSARIAL_FLAG_SCORE: int(25),
  ADVERSARIAL_MIN_INCIDENTS: int(2),
  /** 1: quotes and relayed follow actions refuse new follows of flagged leaders. Default: only flag. */
  ADVERSARIAL_REFUSE_FOLLOWS: z.string().default('0').transform((v) => v === '1' || v === 'true'),
  /** Backtest: follower slippage when no copy-quality median is measured for the leader. */
  BACKTEST_DEFAULT_SLIPPAGE_BPS: z.coerce.number().min(0).default(5),
  /** Backtest: Perpl taker fee in bps. */
  BACKTEST_TAKER_FEE_BPS: z.coerce.number().min(0).default(3.5),
  BACKTEST_MAX_EVENTS: int(20_000),

  /** auto (default): on when NANSEN_API_KEY or NANSEN_PAYER_PRIVATE_KEY is set; 0 forces off; 1 forces on. */
  NANSEN_ENABLED: z.enum(['auto', '0', '1', 'true', 'false']).default('auto'),
  NANSEN_API_URL: z.string().default('https://api.nansen.ai'),
  NANSEN_API_KEY: z.string().optional(),
  NANSEN_PAYER_PRIVATE_KEY: privateKey.optional(),
  NANSEN_NETWORK: z.string().default('eip155:143'),
  /** Hard cap per paid call in token base units (USDC 6 decimals): 50000 = $0.05. */
  NANSEN_MAX_PER_CALL: int(50_000),
  NANSEN_DAILY_BUDGET: int(1_000_000),
  NANSEN_CACHE_HOURS: int(24),

  PUSH_ENABLED: bool,
  EXPO_ACCESS_TOKEN: z.string().optional(),
});

const MarketSchema = z.object({
  perpId: z.number(),
  symbol: z.string(),
  lotDecimals: z.number(),
  priceDecimals: z.number(),
});

const NetworkSchema = z.object({
  chainId: z.number(),
  rpc: z.string(),
  wss: z.string().optional(),
  explorerTx: z.string().optional(),
  explorerAddress: z.string().optional(),
  perplExchange: z.string().optional(),
  perplDeployBlock: z.number().optional(),
  collateral: z.string().optional(),
  collateralDecimals: z.number().optional(),
  minAccountOpenCNS: z.string().optional(),
  mirror: z
    .object({
      factory: z.string().nullable(),
      implementation: z.string().nullable(),
      keeperRegistry: z.string().nullable(),
      deployBlock: z.number().nullable(),
    })
    .optional(),
  teamRun: z
    .object({
      demoLeaderAddress: z.string().nullable(),
      demoLeaderAccountId: z.number().nullable(),
      demoFollowerAccount: z.string().nullable(),
    })
    .optional(),
  markets: z.array(MarketSchema).optional(),
  perplApi: z.string().optional(),
  perplWs: z.string().optional(),
});

const SharedSchema = z.object({
  product: z.string(),
  networks: z.object({ mainnet: NetworkSchema, testnet: NetworkSchema.optional(), localFork: NetworkSchema.partial() }),
});

/** localnet/out/env.json, as written by localnet/start.mjs. */
const LocalnetSchema = z.object({
  chainId: z.number(),
  rpcUrl: z.string(),
  wsUrl: z.string().optional(),
  perplExchange: z.string(),
  collateral: z.string(),
  minAccountOpenCNS: z.string().optional(),
  mirror: z.object({ factory: z.string(), keeperRegistry: z.string(), implementation: z.string(), deployBlock: z.number() }),
  teamRun: z.object({ demoLeaderAddress: z.string(), demoLeaderAccountId: z.number() }),
  markets: z.array(MarketSchema),
});

function localnetNetwork(path: string): z.infer<typeof NetworkSchema> {
  const l = LocalnetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  return {
    chainId: l.chainId,
    rpc: l.rpcUrl,
    wss: l.wsUrl,
    perplExchange: l.perplExchange,
    perplDeployBlock: 0,
    collateral: l.collateral,
    collateralDecimals: 6,
    minAccountOpenCNS: l.minAccountOpenCNS ?? '10000000',
    mirror: { factory: l.mirror.factory, implementation: l.mirror.implementation, keeperRegistry: l.mirror.keeperRegistry, deployBlock: l.mirror.deployBlock },
    teamRun: { demoLeaderAddress: l.teamRun.demoLeaderAddress, demoLeaderAccountId: l.teamRun.demoLeaderAccountId, demoFollowerAccount: null },
    markets: l.markets,
  };
}

export type MarketMeta = z.infer<typeof MarketSchema>;

export interface Config {
  env: z.infer<typeof EnvSchema>;
  chainId: number;
  rpcUrl: string;
  wsRpcUrl: string | undefined;
  explorerTx: string;
  explorerAddress: string;
  exchange: Address;
  collateral: Address;
  collateralDecimals: number;
  minAccountOpenCNS: bigint;
  perplDeployBlock: number;
  factory: Address | undefined;
  keeperRegistry: Address | undefined;
  deployBlock: number | undefined;
  markets: MarketMeta[];
  keeperKeys: Hex[];
  relayerKey: Hex | undefined;
  demoLeaderKey: Hex | undefined;
  demoFollowerAccount: Address | undefined;
  teamRun: Set<string>;
  perplApiUrl: string;
  perplWsUrl: string;
  perplChainId: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const env = parsed.data;
  const sharedPath = env.SHARED_CONFIG_PATH ?? join(engineRoot, '..', 'shared', 'config.json');
  const shared = SharedSchema.parse(JSON.parse(readFileSync(sharedPath, 'utf8')));
  // `main` is the selected network's full description; localFork overlays the mainnet one (same chain state).
  const main =
    env.NETWORK === 'testnet'
      ? (shared.networks.testnet ?? (() => { throw new Error('shared config has no testnet network'); })())
      : env.NETWORK === 'localnet'
        ? localnetNetwork(env.LOCALNET_ENV_PATH ?? join(engineRoot, '..', 'localnet', 'out', 'env.json'))
        : shared.networks.mainnet;
  const net = { ...main, ...(env.NETWORK === 'localFork' ? shared.networks.localFork : {}) };

  const addr = (v: string | null | undefined): Address | undefined => (v && isAddress(v) ? getAddress(v) : undefined);
  const exchange = env.PERPL_EXCHANGE ?? addr(net.perplExchange);
  const collateral = env.COLLATERAL_TOKEN ?? addr(net.collateral);
  if (!exchange || !collateral) throw new Error('PERPL_EXCHANGE and COLLATERAL_TOKEN must be configured');

  const teamRun = new Set<string>(env.TEAM_RUN_ADDRESSES.map((a) => a.toLowerCase()));
  for (const a of [main.teamRun?.demoLeaderAddress, main.teamRun?.demoFollowerAccount, env.DEMO_FOLLOWER_ACCOUNT]) {
    if (a && isAddress(a)) teamRun.add(a.toLowerCase());
  }

  const relayerKey = env.RELAYER_PRIVATE_KEY ?? (env.KEEPER_PRIVATE_KEYS[0] as Hex | undefined);

  return {
    env,
    chainId: net.chainId ?? 143,
    rpcUrl: env.RPC_URL ?? net.rpc ?? main.rpc,
    wsRpcUrl: env.WS_RPC_URL || (env.NETWORK !== 'localFork' ? main.wss : undefined),
    explorerTx: main.explorerTx ?? 'https://monadvision.com/tx/',
    explorerAddress: main.explorerAddress ?? 'https://monadvision.com/address/',
    exchange,
    collateral,
    collateralDecimals: main.collateralDecimals ?? 6,
    minAccountOpenCNS: BigInt(main.minAccountOpenCNS ?? '10000000'),
    perplDeployBlock: main.perplDeployBlock ?? 0,
    factory: env.FACTORY_ADDRESS ?? addr(main.mirror?.factory),
    keeperRegistry: env.KEEPER_REGISTRY_ADDRESS ?? addr(main.mirror?.keeperRegistry),
    deployBlock: env.MIRROR_DEPLOY_BLOCK ?? main.mirror?.deployBlock ?? undefined,
    markets: main.markets ?? [],
    keeperKeys: env.KEEPER_PRIVATE_KEYS as Hex[],
    relayerKey: relayerKey as Hex | undefined,
    demoLeaderKey: env.DEMO_LEADER_PRIVATE_KEY as Hex | undefined,
    demoFollowerAccount: env.DEMO_FOLLOWER_ACCOUNT ?? addr(main.teamRun?.demoFollowerAccount),
    teamRun,
    perplApiUrl: env.PERPL_API_URL ?? main.perplApi ?? 'https://app.perpl.xyz/api',
    perplWsUrl: env.PERPL_WS_URL ?? main.perplWs ?? 'wss://app.perpl.xyz',
    perplChainId: env.PERPL_CHAIN_ID ?? net.chainId ?? 143,
  };
}
