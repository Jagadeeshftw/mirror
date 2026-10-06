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

  NETWORK: z.enum(['mainnet', 'localFork']).default('mainnet'),
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

  PERPL_API_URL: z.string().default('https://app.perpl.xyz/api'),
  PERPL_WS_URL: z.string().default('wss://app.perpl.xyz'),
  PERPL_WS_ENABLED: z.string().default('1').transform((v) => v !== '0' && v !== 'false'),
  PERPL_CHAIN_ID: int(143),

  KEEPER_PRIVATE_KEYS: keyList,
  RELAYER_PRIVATE_KEY: privateKey.optional(),
  DEMO_LEADER_PRIVATE_KEY: privateKey.optional(),
  DEMO_FOLLOWER_ACCOUNT: optAddress,
  TEAM_RUN_ADDRESSES: addressList,

  DB_PATH: z.string().default(join(engineRoot, 'data', 'engine.db')),

  SLIPPAGE_SAFETY_BPS: int(5),
  MAX_MATCHES: int(100),
  PRIORITY_FEE_GWEI: z.coerce.number().default(2),
  GAS_LIMIT_MULTIPLIER: z.coerce.number().default(1.2),
  TX_TIMEOUT_MS: int(20_000),
  /** Block reasons for which a blocked opening copy is still submitted so the rule hit is recorded onchain. */
  BLOCKED_SUBMIT_REASONS: z
    .string()
    .default(
      'LeverageTooHigh,LeverageTooLow,SlippageTooHigh,ExceedsMaxNotional,ExceedsLeaderTarget,DailyLossStop,DrawdownStop,StaleMark',
    )
    .transform((v) => new Set(v.split(',').map((s) => s.trim()).filter(Boolean))),
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

  NANSEN_ENABLED: bool,
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
});

const SharedSchema = z.object({
  product: z.string(),
  networks: z.object({ mainnet: NetworkSchema, localFork: NetworkSchema.partial() }),
});

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
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const env = parsed.data;
  const sharedPath = env.SHARED_CONFIG_PATH ?? join(engineRoot, '..', 'shared', 'config.json');
  const shared = SharedSchema.parse(JSON.parse(readFileSync(sharedPath, 'utf8')));
  const main = shared.networks.mainnet;
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
    wsRpcUrl: env.WS_RPC_URL || (env.NETWORK === 'mainnet' ? main.wss : undefined),
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
  };
}
