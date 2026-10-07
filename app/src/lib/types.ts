// Types for the Mirror backend API (docs/api.md). Amounts are raw-unit decimal strings
// (CNS = collateral, 6 decimals; LNS = lots; PNS = price) unless the name ends in Usd/Display.

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type CommitState = "proposed" | "voted" | "finalized" | "offchain";
export type Side = "long" | "short";

export interface MarketConfig {
  perpId: number;
  symbol: string;
  lotDecimals: number;
  priceDecimals: number;
  markPNS?: string;
  minOrderLotLNS?: string;
  /** Perpl's max leverage for the market (e.g. BTC 15). */
  maxLeverage?: number;
}

export interface AppConfig {
  chainId: number;
  rpc: string;
  explorerTx: string;
  explorerAddress: string;
  contracts: {
    factory: Address | null;
    implementation: Address | null;
    keeperRegistry: Address | null;
    perplExchange: Address;
    collateral: Address;
    deployBlock?: number | null;
  };
  collateralDecimals: number;
  depositCapCNS: string;
  minAccountOpenCNS: string;
  markets: MarketConfig[];
  teamRun: {
    addresses?: Address[];
    demoLeaderAddress: Address | null;
    demoLeaderAccountId: number | null;
    demoFollowerAccount: Address | null;
  };
}

export interface MarketState {
  perpId: number;
  symbol: string;
  markPNS: string;
  oraclePNS: string;
  fundingRateBps: number;
  openInterestLNS: string;
  bestBidPNS: string;
  bestAskPNS: string;
  change24hPct?: number;
}

export interface NansenInfo {
  labels: string[];
  notes?: { label: string; text: string }[];
  venues?: { venue: string; since: string; realisedPnlUsd: number }[];
}

export interface LeaderSummary {
  accountId: number;
  address: Address;
  score: number;
  pnlUsd: number;
  pnlPct: number;
  maxDrawdownPct: number;
  winRate: number;
  avgLeverage: number;
  trades: number;
  markets: string[];
  followers: number;
  nansen: NansenInfo;
  teamRun: boolean;
  /** Normalised equity points for the row sparkline (optional). */
  spark?: number[];
  /** Engine's adversarial-leader record (docs/engine.md). */
  adversarial?: Adversarial | null;
}

export interface Adversarial {
  exitsIntoFollowers: number;
  bookMoving: number;
  lastSeen: number;
  score: number;
  flagged: boolean;
  copiedFills: number;
}

export interface LeaderPosition {
  perpId: number;
  side: Side;
  lotLNS: string;
  entryPNS: string;
  markPNS: string;
  leverageHdths: number;
  pnlUsd: number;
}

export interface LeaderTrade {
  perpId: number;
  side: Side;
  action: "open" | "close";
  lotLNS: string;
  pricePNS: string;
  leverageHdths: number;
  timestamp: number;
  txHash: Hex;
}

export interface RiskFlag {
  kind: "warn" | "info" | "ok";
  title: string;
  detail: string;
}

export interface LeaderProfile extends LeaderSummary {
  since: string;
  equityCurve: { t: number; v: number }[];
  drawdown: { fromT: number; toT: number; pct: number; days: number } | null;
  stats: {
    profitFactor: number;
    largestLossUsd: number;
    peakLeverage: number;
    tradesPerDay: number;
    avgHoldMinutes: number;
  };
  marketShare: { symbol: string; pct: number }[];
  tradesPerDay: { t: number; n: number }[];
  positions: LeaderPosition[];
  recentTrades: LeaderTrade[];
  riskFlags: RiskFlag[];
  updatedAt: number;
}

export interface LeaderRule {
  accountId: number;
  ratioBps: number;
  /** Most margin this leader's positions may hold, AUSD 6-decimal units as a string. */
  budgetCNS: string;
  /** Stop copying this leader below -lossStopBps x budget (0 = off). */
  lossStopBps: number;
}
export interface MarketRule {
  perpId: number;
  maxNotionalCNS: string;
}
/** Mirrors MirrorAccount.Policy. */
export interface Policy {
  maxLeverageHdths: number;
  maxSlippageBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  expiry: number;
  /** Refuse an opening copy further than this from the leader's onchain entry (0 = off). */
  maxEntryDeviationBps: number;
  /** Slippage bound for closes sent by a triggered stop. */
  stopSlippageBps: number;
  /** Anyone may close positions once a loss stop is hit. */
  flattenOnStop: boolean;
  /** Highest Perpl builder fee (per 100,000 of opening size) the owner accepts; Mirror charges 20 (0.02%). */
  maxBuilderFeePer100K: number;
  leaders: LeaderRule[];
  markets: MarketRule[];
}

/** Mirrors MirrorAccount.Level: an owner-signed stop-loss / take-profit on one market. */
export interface Level {
  perpId: number;
  side: 0 | 1;
  stopLossPNS: string;
  takeProfitPNS: string;
  slippageBps: number;
}

/** Mirrors MirrorAccount.MirrorOrder (JSON form). */
export interface MirrorOrderJson {
  leaderAccountId: number;
  perpId: number;
  orderType: 0 | 1 | 2 | 3;
  lotLNS: string;
  pricePNS: string;
  leverageHdths: number;
  maxMatches: number;
  leaderRef: Hex;
  leaderFillPNS: string;
}

export interface Position {
  perpId: number;
  side: Side;
  lotLNS: string;
  entryPNS: string;
  markPNS: string;
  liqPNS: string;
  leverageHdths: number;
  marginCNS: string;
  notionalCNS: string;
  upnlCNS: string;
  leaderAccountId: number;
}

export interface LeaderAttribution {
  leaderAccountId: number;
  realisedCNS: string;
  unrealisedCNS: string;
}

export interface MirrorAccount {
  account: Address;
  owner: Address;
  salt: Hex;
  deployed: boolean;
  perplAccountId: number | null;
  balanceCNS: string;
  equityCNS: string;
  withdrawableCNS: string;
  marginCNS: string;
  netDepositsCNS: string;
  depositCapCNS: string;
  actionNonce: string;
  paused: boolean;
  expiry: number;
  policy: Policy | null;
  positions: Position[];
  pnl: {
    realisedCNS: string;
    unrealisedCNS: string;
    todayCNS: string;
    byLeader: LeaderAttribution[];
  };
  equityHistory?: { t: number; v: number }[];
  leader?: { accountId: number; address: Address; labels: string[] } | null;
  stops?: { dailyLossHit: boolean; drawdownHit: boolean };
  createdAt: number;
  teamRun: boolean;
}

export interface OwnerAccounts {
  owner: Address;
  walletBalanceCNS?: string;
  accounts: MirrorAccount[];
}

export interface BlockInfo {
  reason: string;
  reasonCode: number;
  limit: string;
  actual: string;
  /** Human sentence, e.g. "Max leverage 5x". */
  rule?: string;
}

export type FeedKind =
  | "Mirrored"
  | "Blocked"
  | "Deposited"
  | "Withdrawn"
  | "PolicyUpdated"
  | "Paused"
  | "ClosedAll"
  | "Followed"
  | "LevelSet"
  | "StopTriggered"
  | "LeaderStopped"
  | "MarketClosed"
  | "EngineShrunk"
  | "EngineSkipped";

/** CopyProof from the Mirrored event (all PNS; deviation positive = follower paid worse than the leader's entry). */
export interface CopyProof {
  leaderFillPNS: string;
  leaderEntryPNS: string;
  markPNS: string;
  fillPNS: string;
  entryDeviationBps: number;
}

export interface FeedEvent {
  id: string;
  kind: FeedKind;
  account: Address;
  /** null for engine-side items (EngineShrunk / EngineSkipped), which have no transaction. */
  txHash: Hex | null;
  txUrl?: string | null;
  /** false for engine-side items. */
  onchain?: boolean;
  /** Engine label, e.g. "Shrunk: thin book". */
  label?: string;
  /** Engine-side reason ("ThinBook" | "BookUnavailable") with its numbers (required lots / depth). */
  reason?: string;
  limit?: string | null;
  actual?: string | null;
  data?: Record<string, unknown>;
  proof?: CopyProof;
  /** Leader's fill reference (bytes32, the leader's transaction). */
  leaderRef?: Hex;
  leaderBlock?: number;
  latencyBlocks?: number;
  block: number;
  timestamp: number;
  commitState: CommitState;
  latencyMs?: number;
  leaderAccountId?: number;
  leaderAddress?: Address;
  perpId?: number;
  orderType?: 0 | 1 | 2 | 3;
  lotLNS?: string;
  pricePNS?: string;
  leverageHdths?: number;
  notionalCNS?: string;
  realisedPnlCNS?: string;
  leaderLotLNS?: string;
  leaderLeverageHdths?: number;
  matchNow?: boolean;
  blocked?: BlockInfo;
  amountCNS?: string;
  paused?: boolean;
  positionsClosed?: number;
  teamRun?: boolean;
}

export interface FeedPage {
  events: FeedEvent[];
  cursor: string | null;
}

export interface QuoteRow {
  perpId: number;
  orderType: 0 | 1;
  lotLNS: string;
  sizeDisplay: string;
  markPNS: string;
  /** Limit price = slippage bound. */
  pricePNS: string;
  expectedFillPNS: string;
  notionalCNS: string;
  marginCNS: string;
  leverageHdths: number;
  leaderLotLNS?: string;
  wouldBlock: null | { reason: string; limit: string; actual: string; rule?: string };
}

export interface FollowQuote {
  leaderAccountId: number;
  rows: QuoteRow[];
  orders: MirrorOrderJson[];
  ordersEncoded?: Hex;
  quotedAt: number;
}

export interface RelayResult {
  txHash: Hex;
  status: "success" | "reverted";
  block: number;
  gasUsed: string;
  latencyMs?: number;
  commitState?: CommitState;
  result?: Hex;
}

export interface DemoStep {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "blocked" | "failed";
  txHash?: Hex;
  latencyMs?: number;
  commitState?: CommitState;
  at?: number;
  detail?: string;
}

export interface DemoCycle {
  id: string;
  kind: "trade" | "blocked";
  startedAt: number;
  status: "running" | "done" | "failed";
  steps: DemoStep[];
  /** How long the leader holds before closing (engine `holdMs`). */
  holdMs?: number;
}

export interface DemoState {
  leader: { accountId: number; address: Address; teamRun: true };
  follower: MirrorAccount;
  cycles: DemoCycle[];
  busy: boolean;
  limits: { perIpPerHour: number; dailyCap: number; dailyRemaining: number };
}

export interface HealthState {
  ok: boolean;
  chainId: number;
  block: number;
  keeper: { address: Address; balanceWei: string };
  relayer: Record<string, unknown>;
  perpl: { wsConnected: boolean; lastMarkAt: number };
  indexer: { lagBlocks: number };
}

/** Encrypted push envelope (X25519 + HKDF-SHA256 + ChaCha20-Poly1305). */
export interface PushEnvelope {
  v: 1;
  epk: string;
  nonce: string;
  ct: string;
}

/** Decrypted alert (engine: engine/src/services/alerts.ts AlertPayload). */
export interface PushPayload {
  v?: 1;
  kind: "copied" | "blocked" | "closed" | "stop" | "leader_stop" | "low_equity" | "expiry" | "deposit" | "withdraw" | "demo";
  title: string;
  body: string;
  account?: Address;
  eventId?: string;
  txHash?: string | null;
  timestamp: number;
}

/** A browser Web Push subscription as PushSubscription.toJSON() returns it. */
export interface WebPushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** GET /v1/push/config: which channels the server can deliver on. */
export interface PushConfig {
  webPush: { vapidPublicKey: string } | null;
  expo: boolean;
  sse: boolean;
}
