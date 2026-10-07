import { getAddress, pad, type Address } from 'viem';
import type { Db } from '../db.js';
import type { Reads } from '../chain/reads.js';
import type { MarketData } from '../perpl/market.js';
import { MATCH_NOW_REF } from './constants.js';
import { feedJson, type FeedRow } from './feed.js';
import type { RegistryLike } from './registry.js';
import type { Relayer } from './relayer.js';

type AccountRow = {
  address: string;
  owner: string;
  salt: string;
  created_block: number;
  created_tx: string;
  created_ts: number | null;
  perpl_account_id: number | null;
  max_leverage_hdths: number | null;
  max_slippage_bps: number | null;
  daily_loss_bps: number | null;
  drawdown_bps: number | null;
  expiry: number | null;
  max_entry_deviation_bps: number | null;
  stop_slippage_bps: number | null;
  flatten_on_stop: number;
  max_builder_fee_per_100k: number | null;
  paused: number;
  net_deposits: string;
  funded_block: number | null;
  last_activity_ts: number | null;
};

/** Sum of Mirrored rows' builder fees (CopyProof.builderFeeCNS), collateral units. */
const sumBuilderFees = (rows: { builder_fee_cns?: string | null }[]) => rows.reduce((s, r) => s + BigInt(r.builder_fee_cns ?? 0), 0n);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

export class Views {
  constructor(
    private readonly db: Db,
    private readonly reads: Reads,
    private readonly market: MarketData,
    private readonly registry: RegistryLike,
    private readonly relayer: Relayer | undefined,
    private readonly explorerTx: string,
  ) {}

  private teamRun(r: { address: string; owner: string }) {
    return this.registry.isTeamRun(r.address) || this.registry.isTeamRun(r.owner);
  }

  async account(address: string) {
    const r = this.db.get<AccountRow>('SELECT * FROM accounts WHERE address = ?', address.toLowerCase());
    if (!r) return undefined;
    const leaders = this.db.all<{ leader_id: number; ratio_bps: number; budget_cns: string; loss_stop_bps: number; stopped: number }>('SELECT * FROM account_leaders WHERE account = ?', r.address);
    const markets = this.db.all<{ perp_id: number; max_notional_cns: string; halted: number }>('SELECT * FROM account_markets WHERE account = ?', r.address);
    const levels = this.db.all<{ perp_id: number; side: number; stop_loss_pns: string; take_profit_pns: string; slippage_bps: number }>('SELECT * FROM account_levels WHERE account = ?', r.address);
    const addr = getAddress(r.address);
    let equity: bigint | null = null;
    let idle = 0n;
    let perplBalance = 0n;
    try {
      [equity, idle, perplBalance] = await Promise.all([
        this.reads.account(addr).then((s) => s.equity),
        this.reads.tokenBalance(addr),
        r.perpl_account_id ? this.reads.perplBalance(r.perpl_account_id) : Promise.resolve(0n),
      ]);
    } catch {
      /* chain read failed; return indexed data */
    }
    const positions = r.perpl_account_id
      ? (
          await Promise.all(
            markets.map(async (m) => {
              const p = await this.reads.position(m.perp_id, r.perpl_account_id!).catch(() => undefined);
              if (!p || p.lots === 0n) return undefined;
              const holder = await this.reads.marketLeader(addr, m.perp_id).catch(() => null);
              return {
                perpId: m.perp_id,
                symbol: this.market.meta(m.perp_id)?.symbol ?? String(m.perp_id),
                side: p.side === 0 ? 'long' : 'short',
                lotLNS: p.lots.toString(),
                entryPricePNS: p.entryPricePNS.toString(),
                markPNS: p.mark.toString(),
                depositCNS: p.depositCNS.toString(),
                unrealizedPnlCNS: p.pnlCNS.toString(),
                /** The leader whose copy opened this market (MirrorAccount.marketLeader). */
                leaderAccountId: holder,
              };
            }),
          )
        ).filter((x): x is NonNullable<typeof x> => Boolean(x))
      : [];

    // Exact per-leader book from the contract: every market is attributed to one leader.
    const pnlByLeader = r.perpl_account_id
      ? (
          await Promise.all(
            leaders.map(async (l) => {
              const b = await this.reads.leaderBook(addr, l.leader_id).catch(() => undefined);
              return b
                ? { leaderAccountId: l.leader_id, unrealizedPnlCNS: b.unrealizedCNS.toString(), realizedPnlCNS: b.realizedCNS.toString(), marginCNS: b.marginCNS.toString(), budgetCNS: l.budget_cns, stopped: b.stopped }
                : undefined;
            }),
          )
        ).filter((x): x is NonNullable<typeof x> => Boolean(x))
      : [];
    const netDeposits = BigInt(r.net_deposits);
    const feeRows = this.db.all<{ builder_fee_cns: string | null }>(`SELECT builder_fee_cns FROM feed WHERE account = ? AND kind = 'Mirrored'`, r.address);
    return {
      address: addr,
      owner: getAddress(r.owner),
      deployed: true,
      predicted: false,
      salt: r.salt,
      teamRun: this.teamRun(r),
      perplAccountId: r.perpl_account_id,
      createdBlock: r.created_block,
      createdTx: r.created_tx,
      balanceCNS: (idle + perplBalance).toString(),
      equityCNS: equity?.toString() ?? null,
      netDepositsCNS: netDeposits.toString(),
      pnlCNS: equity !== null ? (equity - netDeposits).toString() : null,
      /** Builder fees Perpl charged on this account's copies and match-now orders (sum of proof.builderFeeCNS). */
      builderFeesCNS: sumBuilderFees(feeRows).toString(),
      paused: r.paused === 1,
      expiry: r.expiry,
      policy: r.max_leverage_hdths
        ? {
            maxLeverageHdths: r.max_leverage_hdths,
            maxSlippageBps: r.max_slippage_bps,
            dailyLossBps: r.daily_loss_bps,
            drawdownBps: r.drawdown_bps,
            expiry: r.expiry,
            maxEntryDeviationBps: r.max_entry_deviation_bps ?? 0,
            stopSlippageBps: r.stop_slippage_bps,
            flattenOnStop: r.flatten_on_stop === 1,
            maxBuilderFeePer100K: r.max_builder_fee_per_100k ?? 0,
            leaders: leaders.map((l) => ({ accountId: l.leader_id, ratioBps: l.ratio_bps, budgetCNS: l.budget_cns, lossStopBps: l.loss_stop_bps, stopped: l.stopped === 1 })),
            markets: markets.map((m) => ({ perpId: m.perp_id, maxNotionalCNS: m.max_notional_cns, halted: m.halted === 1 })),
          }
        : null,
      levels: levels.map((v) => ({ perpId: v.perp_id, side: v.side === 0 ? 'long' : 'short', stopLossPNS: v.stop_loss_pns, takeProfitPNS: v.take_profit_pns, slippageBps: v.slippage_bps })),
      positions,
      pnlByLeader,
    };
  }

  async ownerAccounts(owner: Address) {
    const rows = this.db.all<{ address: string }>('SELECT address FROM accounts WHERE owner = ? ORDER BY created_block', owner.toLowerCase());
    const accounts = (await Promise.all(rows.map((r) => this.account(r.address)))).filter(Boolean);
    const zeroSalt = pad('0x0', { size: 32 });
    if (!rows.length && this.relayer) {
      const predicted = await this.relayer.predict(owner, zeroSalt).catch(() => undefined);
      if (predicted) accounts.push({ address: predicted, owner, deployed: false, predicted: true, salt: zeroSalt, teamRun: this.registry.isTeamRun(owner) } as never);
    }
    return { owner, accounts };
  }

  feed(account: string, cursor?: number, limit = 50) {
    const rows = this.db.all<FeedRow>(
      `SELECT * FROM feed WHERE account = ? ${cursor ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
      ...(cursor ? [account.toLowerCase(), cursor, limit] : [account.toLowerCase(), limit]),
    );
    return { items: rows.map((r) => feedJson(r, this.explorerTx)), nextCursor: rows.length === limit ? rows.at(-1)!.id : null };
  }

  stats(page = 1, limit = 50, keepers: string[] = []) {
    const accounts = this.db.all<AccountRow>('SELECT * FROM accounts');
    const team = new Set(accounts.filter((a) => this.teamRun(a)).map((a) => a.address));
    const build = (rows: AccountRow[]) => {
      const set = new Set(rows.map((a) => a.address));
      const inSet = (f: { account: string }) => set.has(f.account);
      const feed = this.db.all<FeedRow>(`SELECT * FROM feed WHERE kind IN ('Mirrored', 'Blocked') ORDER BY id DESC`).filter(inSet);
      const copies = feed.filter((f) => f.kind === 'Mirrored' && f.leader_ref !== MATCH_NOW_REF);
      const matchNow = feed.filter((f) => f.kind === 'Mirrored' && f.leader_ref === MATCH_NOW_REF);
      const blocked = feed.filter((f) => f.kind === 'Blocked');
      const stops = this.db.all<FeedRow>(`SELECT * FROM feed WHERE kind = 'StopTriggered'`).filter(inSet);
      const stopsByKind: Record<string, number> = {};
      for (const st of stops) stopsByKind[st.reason ?? 'Unknown'] = (stopsByKind[st.reason ?? 'Unknown'] ?? 0) + 1;
      const perRule: Record<string, number> = {};
      for (const b of blocked) perRule[b.reason ?? 'Unknown'] = (perRule[b.reason ?? 'Unknown'] ?? 0) + 1;
      const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86_400;
      const active = rows.filter((a) => a.funded_block !== null && a.max_leverage_hdths !== null && (a.last_activity_ts ?? 0) >= weekAgo && a.paused === 0);
      return {
        accountsCreated: rows.length,
        fundedAccounts: rows.filter((a) => a.funded_block !== null).length,
        netDepositedCNS: rows.reduce((s, a) => s + BigInt(a.net_deposits), 0n).toString(),
        copiesExecuted: copies.length,
        matchNowOrders: matchNow.length,
        /** Builder fees Perpl charged on keeper copies and match-now orders (opening size only), from Mirrored proofs. */
        builderFeesCNS: sumBuilderFees([...copies, ...matchNow]).toString(),
        builderFeesCopiesCNS: sumBuilderFees(copies).toString(),
        builderFeesMatchNowCNS: sumBuilderFees(matchNow).toString(),
        copiesBlocked: blocked.length,
        copiesBlockedPerRule: perRule,
        medianLatencyMs: median(copies.map((c) => c.latency_ms).filter((x): x is number => x !== null)),
        stopsTriggered: stops.length,
        stopsTriggeredByKind: stopsByKind,
        activeFollowers7d: active.length,
        executed: copies,
      };
    };
    const users = build(accounts.filter((a) => !team.has(a.address)));
    const teamRun = build(accounts.filter((a) => team.has(a.address)));
    const pageRows = (rows: FeedRow[]) => rows.slice((page - 1) * limit, page * limit).map((r) => feedJson(r, this.explorerTx));
    const { executed: ue, ...userStats } = users;
    const { executed: te, ...teamStats } = teamRun;
    return {
      excludesTeamRun: true,
      ...userStats,
      copies: { page, limit, total: ue.length, items: pageRows(ue) },
      keepers,
      teamRun: {
        label: 'team-run (demo leader and demo follower; excluded from every count above)',
        accounts: [...team],
        ...teamStats,
        copies: { page, limit, total: te.length, items: pageRows(te) },
      },
    };
  }
}
