// Which account events become alerts, and their text. The text is sealed to the device's notification key before it
// leaves the engine (pushcrypto.ts); push providers only ever see the generic "Mirror: new activity".

export type AlertKind = 'copied' | 'closed' | 'blocked' | 'stop' | 'leader_stop' | 'low_equity' | 'deposit' | 'withdraw' | 'suggestion';

/** The decrypted payload the app shows (app/src/lib/types.ts PushPayload). */
export interface AlertPayload {
  v: 1;
  kind: AlertKind;
  title: string;
  body: string;
  account: string;
  eventId: string;
  txHash: string | null;
  timestamp: number;
}

export interface MarketText {
  symbol: string;
  lotDecimals: number;
  priceDecimals: number;
}

export interface AlertContext {
  markets: Map<number, MarketText>;
  owner: string;
  /** Mirror's own signers (keepers, stop executor): StopTriggered by one of them reads "Mirror's keeper". */
  keepers: Set<string>;
}

/** The engine's feed JSON (services/feed.ts feedJson), as far as alerts read it. */
export interface FeedItem {
  id: number | string;
  account: string;
  kind: string;
  txHash: string | null;
  timestamp: number;
  leaderAccountId: number | null;
  perpId: number | null;
  orderType: number | null;
  lotLNS: string | null;
  pricePNS: string | null;
  reason: string | null;
  limit: string | null;
  actual: string | null;
  keeper: string | null;
  amount: string | null;
  label?: string | null;
  realisedPnlCNS?: string | null;
  proof?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
}

const big = (v: unknown): bigint => {
  try {
    return v === null || v === undefined || v === '' ? 0n : BigInt(String(v));
  } catch {
    return 0n;
  }
};

/** Fixed-point to text with thousands separators: fixed(123456789n, 6, 2) = "123.46". */
export function fixed(v: bigint, decimals: number, dp: number): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const q = 10n ** BigInt(Math.max(0, decimals - dp));
  const r = decimals > dp ? (a + q / 2n) / q : a * 10n ** BigInt(dp - decimals);
  const unit = 10n ** BigInt(dp);
  const whole = (r / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = dp ? `.${(r % unit).toString().padStart(dp, '0')}` : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}
export const ausd = (cns: unknown) => fixed(big(cns), 6, 2);
/** "+1.23", "-1.50"; amounts that round to zero read "0.00" (never "-0.00"). */
const signed = (cns: unknown) => {
  const t = ausd(cns);
  return /^-?0\.00$/.test(t) ? '0.00' : big(cns) > 0n ? `+${t}` : t;
};
const short = (a: unknown) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a ?? ''));

const RULES: Record<string, string> = {
  LeverageTooHigh: 'Max leverage', LeverageTooLow: 'Leverage safety', MarketNotAllowed: 'Market not allowed', ExceedsMaxNotional: 'Max notional',
  SlippageTooHigh: 'Max slippage', DailyLossStop: 'Daily loss stop', DrawdownStop: 'Account loss stop', Paused: 'Paused', Expired: 'Follow expired',
  LeaderNotAllowed: 'Leader not followed', LeaderSideMismatch: 'Leader position changed', FlipNotAllowed: 'No flip', StaleMark: 'Stale price',
  ExceedsLeaderTarget: 'Copy ratio', EntryTooFar: 'Entry filter', MarketHeldByOtherLeader: 'Market held by another leader',
  LeaderBudgetExceeded: 'Leader budget', LeaderLossStop: 'Leader loss stop', MarketHalted: 'Market halted by a stop', CloseBelowTarget: 'Close below target',
  BuilderFeeTooHigh: 'Fee cap', LeaderDetached: 'Stopped following this leader (positions kept)', ThinBook: 'Thin book', BookUnavailable: 'Book unavailable',
};
export const ruleName = (r: string) => RULES[r] ?? r.replace(/([a-z])([A-Z])/g, '$1 $2');

/** Loss stops that pause new exposure: a Blocked with one of these is a "stop hit", not a rule refusal. */
const STOP_BLOCKS = new Set(['DailyLossStop', 'DrawdownStop', 'LeaderLossStop']);

function blockedNumbers(e: FeedItem, m: MarketText | undefined): string {
  const limit = big(e.limit);
  const actual = big(e.actual);
  const px = (v: bigint) => (m ? fixed(v, m.priceDecimals, 1) : v.toString());
  switch (e.reason) {
    case 'LeverageTooHigh':
      return `leader ${fixed(actual, 2, 1)}x, your max ${fixed(limit, 2, 1)}x`;
    case 'ExceedsMaxNotional':
      return `copy ${ausd(actual)} AUSD, your max ${ausd(limit)} AUSD`;
    case 'LeaderBudgetExceeded':
      return `needed ${ausd(actual)} AUSD margin, budget ${ausd(limit)} AUSD`;
    case 'SlippageTooHigh':
      return `price ${px(actual)} past your bound ${px(limit)}`;
    case 'EntryTooFar': {
      const entry = big(e.data?.leaderFillPNS ?? e.data?.leaderEntryPNS);
      if (entry <= 0n) return `price ${px(actual)}, your bound ${px(limit)}`;
      const pct = (v: bigint) => ((Math.abs(Number(v - entry)) / Number(entry)) * 100).toFixed(1);
      return `price moved ${pct(actual)}% past the leader's entry, your limit ${pct(limit)}%`;
    }
    default:
      return '';
  }
}

/** The alert for one feed item, or null when the item is not alerted. */
export function alertFor(e: FeedItem, ctx: AlertContext): AlertPayload | null {
  const m = e.perpId !== null ? ctx.markets.get(Number(e.perpId)) : undefined;
  const sym = m?.symbol ?? (e.perpId !== null ? `market ${e.perpId}` : '');
  const side = e.orderType === 1 || e.orderType === 3 ? 'short' : 'long';
  const leader = e.leaderAccountId ? `leader #${e.leaderAccountId}` : 'the leader';
  const base = { v: 1 as const, account: e.account, eventId: String(e.id), txHash: e.txHash, timestamp: Number(e.timestamp) * 1000 };
  const mk = (kind: AlertKind, title: string, body: string): AlertPayload => ({ ...base, kind, title, body });

  switch (e.kind) {
    case 'Mirrored': {
      const lots = big(e.lotLNS);
      const fill = big(e.proof?.fillPNS) || big(e.proof?.markPNS) || big(e.pricePNS);
      const size = m ? `${fixed(lots, m.lotDecimals, m.lotDecimals)} ${sym}` : `${lots} lots ${sym}`;
      const at = m && fill > 0n ? ` at ${fixed(fill, m.priceDecimals, 1)}` : '';
      if ((e.orderType ?? 0) <= 1) {
        const notional = m && fill > 0n ? (lots * fill * 10n ** 6n) / 10n ** BigInt(m.lotDecimals + m.priceDecimals) : null;
        const fee = big(e.proof?.builderFeeCNS);
        return mk('copied', `Copied ${sym} ${side}`, [`${size}${at}`, notional !== null ? `${ausd(notional)} AUSD` : '', `Mirror fee ${fixed(fee, 6, 4)} AUSD`, leader].filter(Boolean).join(' · '));
      }
      const pnl = e.realisedPnlCNS != null ? `realised ${signed(e.realisedPnlCNS)} AUSD` : '';
      return mk('closed', `Closed ${sym} ${side}`, [`${size}${at}`, pnl, leader].filter(Boolean).join(' · '));
    }
    case 'Blocked': {
      const reason = e.reason ?? 'Unknown';
      if (STOP_BLOCKS.has(reason)) {
        if (reason === 'LeaderLossStop') return mk('stop', `Leader loss stop hit: ${leader}`, `${sym} ${side} not copied. New trades from ${leader} are no longer copied; your other leaders keep running.`);
        return mk('stop', `${ruleName(reason)} hit`, `Equity ${ausd(e.actual)} AUSD is under ${ausd(e.limit)} AUSD. New exposure is paused; open positions still follow the leader's closes.`);
      }
      if (reason === 'LeaderDetached') return mk('blocked', `Not copied: you stopped following ${leader}`, `${sym} ${side} refused by your own contract (positions kept). Follow ${leader} again to resume copying.`);
      const nums = blockedNumbers(e, m);
      return mk('blocked', `Blocked by your rule: ${ruleName(reason)}`, `${sym} ${side} from ${leader} not copied${nums ? ` · ${nums}` : ''}`);
    }
    case 'EngineSkipped':
      return mk('blocked', `Not copied: ${ruleName(e.reason ?? 'ThinBook')}`, `${sym} ${side} from ${leader} · ${e.label ?? 'the book could not fill the copy within your slippage'}`);
    case 'StopTriggered': {
      const k = String(e.data?.kind ?? e.reason ?? '');
      const caller = String(e.keeper ?? e.data?.caller ?? '').toLowerCase();
      const who = caller === ctx.owner.toLowerCase() ? 'you' : ctx.keepers.has(caller) ? "Mirror's keeper" : `${short(caller)} (anyone may trigger it)`;
      const closed = Number(e.data?.closed ?? 0);
      const tail = `Triggered by ${who} · ${closed} position${closed === 1 ? '' : 's'} closed`;
      if (k === 'StopLoss' || k === 'TakeProfit') {
        const lvl = m ? ` at ${fixed(big(e.limit), m.priceDecimals, 1)}` : '';
        return mk('stop', `${k === 'StopLoss' ? 'Stop-loss' : 'Take-profit'} hit: ${sym}${lvl}`, `${tail}. New ${sym} copies wait until you set limits again.`);
      }
      if (k === 'LeaderLoss') return mk('stop', `Leader loss stop triggered: leader #${e.data?.scope ?? e.leaderAccountId ?? ''}`, `${tail}.`);
      const name = k === 'DailyLoss' ? 'Daily loss stop' : k === 'Drawdown' ? 'Account loss stop' : `${k} stop`;
      return mk('stop', `${name} triggered`, `Equity ${ausd(e.actual)} AUSD, floor ${ausd(e.limit)} AUSD. ${tail}.`);
    }
    case 'LeaderStopped':
      return mk('leader_stop', `Stopped copying ${leader}`, `Loss stop for this leader: PnL ${signed(e.actual)} AUSD, limit ${ausd(e.limit)} AUSD. Its new trades are no longer copied.`);
    case 'Deposited':
      return mk('deposit', 'Deposit confirmed', `${ausd(e.amount)} AUSD added to your follow account`);
    case 'Withdrawn':
      return mk('withdraw', 'Withdrawal confirmed', `${ausd(e.amount)} AUSD sent to ${short(e.data?.to)}`);
    default:
      return null;
  }
}

/** Low-equity alert: equity under `pct`% of net deposits. One per account per UTC day (eventId carries the day). */
export function lowEquityAlert(account: string, equityCNS: bigint, netDepositsCNS: bigint, pct: number, nowMs = Date.now()): AlertPayload | null {
  if (pct <= 0 || netDepositsCNS <= 0n || equityCNS * 100n >= netDepositsCNS * BigInt(pct)) return null;
  const share = Number((equityCNS * 1000n) / netDepositsCNS) / 10;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return {
    v: 1, kind: 'low_equity', title: 'Low equity', account, eventId: `low-equity:${account.toLowerCase()}:${day}`, txHash: null, timestamp: nowMs,
    body: `Equity ${ausd(equityCNS)} AUSD is ${share.toFixed(1)}% of the ${ausd(netDepositsCNS)} AUSD you put in. Loss stops still apply.`,
  };
}
