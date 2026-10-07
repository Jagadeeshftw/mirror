# Mirror indexer (Envio HyperIndex)

The indexer turns Perpl Exchange and Mirror contract events on Monad mainnet (chain 143) into a
GraphQL API. The engine reads leaders, leader profiles, follower PnL and public stats from it
(see [api.md](./api.md)). Code: [`indexer/`](../indexer). Engine queries:
[`indexer/queries/engine.graphql`](../indexer/queries/engine.graphql). Stats-page copy quality:
[`indexer/queries/copy-quality.graphql`](../indexer/queries/copy-quality.graphql). Simulation inputs:
[`indexer/queries/simulation.graphql`](../indexer/queries/simulation.graphql).

```
Perpl Exchange 0x34B6…2a6F ──┐                      ┌─ Postgres ── Hasura GraphQL ── engine (/v1/leaders, /v1/stats, …)
MirrorAccountFactory ────────┼─ HyperSync / RPC ─ HyperIndex handlers (TypeScript, bigint math)
MirrorAccount clones ────────┘  (clones registered dynamically from AccountCreated)
```

- Envio `envio@3.12.1` (HyperIndex V3), Node 24, TypeScript, Vitest.
- Data source: HyperSync (`https://143.hypersync.xyz`, needs `ENVIO_API_TOKEN`) in production, with the
  Monad RPC as fallback. `ENVIO_RPC_MODE=sync` switches historical sync to RPC so it runs without a
  token (Monad RPCs cap `eth_getLogs` at 100 blocks, which the config respects).
- Start block: Perpl deploy block `54773010`. Every number is exact when synced from there.

## Indexed events

| Contract | Events |
|---|---|
| PerplExchange (fixed address) | `AccountCreated`, `CollateralDeposit`, `CollateralWithdrawal`, `PositionOpened(V2)`, `PositionIncreased(V2)`, `PositionDecreased`, `PositionClosed`, `PositionInverted`, `PositionLiquidated`, `PositionDeleveraged(V2)`, `PositionCollateralDecreased`, `TakerOrderFilledV2` (only fills with Mirror's builder id, see [Builder fees](#builder-fees)), `FundingEventCompleted`, `ContractAdded(V2)` |
| MirrorAccountFactory (`ENVIO_MIRROR_FACTORY_ADDRESS`) | `AccountCreated(owner, account, salt)`; also registers the clone with `contractRegister` |
| MirrorAccount (dynamic) | `Initialized(owner)`, `PerplAccountCreated`, `PolicyUpdated` (with entry-deviation, stop slippage, flatten-on-stop, max builder fee, per-leader budget and loss stop), `PausedSet`, `Deposited`, `Withdrawn`, `Mirrored` (with the 6-field `CopyProof` tuple, ending in `builderFeeCNS`), `Blocked` (with leader fill and mark), `ClosedAll`, `MarketClosed`, `LevelSet`, `StopTriggered`, `LeaderStopped`, `Followed` |

All 33 signatures in `config.yaml` were checked against `shared/abi/*.json` (selectors and indexed flags).
Solidity enums (`BlockReason`, `StopKind`) are `uint8` in the ABI and decoded by position.

## Units

`*CNS` = AUSD collateral units (6 decimals). `*PNS` = Perpl price units (market `priceDecimals`).
`*LNS` = lot units (market `lotDecimals`). `*Hdths` = hundredths (leverage 1000 = 10x). `*Bps` = basis
points. Timestamps are unix seconds; `day` = `floor(timestamp / 86400)` (UTC). Over GraphQL, `BigInt`
fields are `numeric` and arrive as strings. Addresses are EIP-55 checksummed.

Notional is `lots * price * 10^6 / 10^(lotDecimals + priceDecimals)`. Market decimals come from a
static table (mirrors `shared/config.json`) and are overridden by `ContractAdded(V2)` events.

## Entity reference

### Perpl

| Entity | Key | What it holds |
|---|---|---|
| `Market` | perpId | symbol, decimals, last execution price, indexed volume and trades, long/short open interest (lots), last funding rate |
| `PerplAccount` | Perpl account id | address, `isMirrorAccount`, link to `MirrorAccount`, `teamRun`, collateral balance, deposited/withdrawn/net; relations `stats`, `positions`, `events`, `daily`, `equityCurve`, `windows` |
| `Position` | `<accountId>-<perpId>` | current position: side, lots, Perpl average entry (+ Q16 residue), deposit, leverage, `isOpen`, opened at, lifetime realized PnL / funding / fees, last execution price and tx; for MirrorAccounts `heldForLeaderAccountId` (the leader whose copy opened it; one leader per market until flat) |
| `PositionEvent` | `<txHash>-<logIndex>` | full trade history: kind (OPEN, INCREASE, DECREASE, CLOSE, INVERT, LIQUIDATION, DELEVERAGE), side, lots before/after, lots opened/closed/traded, execution price and how it was obtained (`priceSource`), entry after, notional, realized PnL, funding, fees, net, leverage, deposit before/after, block, timestamp, tx hash |
| `LeaderStats` | account id | all-time leaderboard row: trades (opening/closing), wins, losses, win rate, liquidations, realized PnL, funding, fees, **net PnL** (realized + funding − fees), volume, notional-weighted average leverage, peak and **max drawdown of the realized equity curve** (absolute and in bps of capital base + peak), capital base (high-water net deposit), PnL in bps, markets traded, open positions, first/last trade; Mirror aggregates: `followers` (non-team-run MirrorAccounts whose policy lists the leader), copies executed/blocked, copied notional, `builderFeesCNS` (builder fees on copies of the leader by non-team-run followers), follower PnL attributed to the leader |
| `LeaderWindowStats` | `<accountId>-<D7\|D30\|D90>` | the same figures over rolling 7/30/90 UTC days, `asOfDay`, active days, window max drawdown |
| `DailyAccountStats` | `<accountId>-<day>` | per account per day: trades, wins, losses, PnL parts, volume, leverage sums, opening/closing/high/low cumulative PnL, max intraday drawdown, markets |
| `EquityPoint` | `<accountId>-<day>` | end-of-day point of the realized equity curve: cumulative net PnL, peak, drawdown, net deposited, equity |

### Mirror

| Entity | Key | What it holds |
|---|---|---|
| `MirrorAccount` | clone address | owner, salt, Perpl account, `teamRun`, created at/tx, policy (max leverage, slippage, daily loss, drawdown, expiry, max entry deviation, stop slippage, flatten-on-stop, `maxBuilderFeePer100K`, leader ids + ratios + budgets + loss stops, market ids + max notionals, version), paused, net/total deposits and withdrawals, funded, copies executed/blocked, match-now copies, copied notional, `builderFeesCNS`, close-all / market-close / stop / leader-stop counts, last copy; relations `leaderRules`, `marketRules`, `levels`, `stops`, `leaderPnl`, `copies`, `blocked`, `activity` |
| `MirrorLeaderRule` / `MirrorMarketRule` | `<account>-<leader>` / `<account>-<perp>` | policy rows with `active` flags (history kept when a leader or market is removed). Leader rows: ratio, `budgetCNS`, `lossStopBps`, `stopped` (set by `LeaderStopped`, cleared by the next policy, which re-arms the leader), last stop time / PnL / limit, `stopCount`. Market rows: max notional, `halted` (set when an owner level fires, cleared by the next policy) |
| `MirrorLevel` | `<account>-<perp>` | owner stop-loss / take-profit (`LevelSet`): side, prices, slippage, `active` (false once cleared or once it fired and closed the whole position), last trigger time and kind |
| `StopTrigger` | `<txHash>-<logIndex>` | `StopTriggered`: caller, `kind` (DailyLoss, Drawdown, LeaderLoss, StopLoss, TakeProfit), scope, `perpId` (levels) or `leaderAccountId` (leader stop), `limit`, `actual`, oracle price, `positionsClosed` (account/leader stops) or `lotsClosedLNS` (levels; the contract reuses the last field) |
| `CopyEvent` | `<txHash>-<logIndex>` | `Mirrored`: keeper, leader, perp, order type, IOC limit price, **fill price** (from the follower's Perpl event in the same tx), lots before/after, filled lots, notional, `leaderRef`, **`isMatchNow`** (`leaderRef == keccak256("MIRROR_MATCH_NOW")`), `builderFeeCNS` / `builderFeePerplCNS` (see [Builder fees](#builder-fees)), and the copy-quality proof (see [Copy quality](#copy-quality)) |
| `BlockedCopy` | `<txHash>-<logIndex>` | `Blocked`: decoded `reason` (enum in Solidity order: None, Paused, Expired, LeaderNotAllowed, LeaderSideMismatch, MarketNotAllowed, LeverageTooHigh, SlippageTooHigh, FlipNotAllowed, StaleMark, ExceedsLeaderTarget, ExceedsMaxNotional, DailyLossStop, DrawdownStop, LeverageTooLow, EntryTooFar, MarketHeldByOtherLeader, LeaderBudgetExceeded, LeaderLossStop, MarketHalted, CloseBelowTarget, BuilderFeeTooHigh), raw code, `limit`, `actual`, order type, lots, keeper-reported leader fill, mark, `excludedFromStats` |
| `BuilderFeeFill` | `<txHash>-<logIndex>` | Perpl `TakerOrderFilledV2` with Mirror's builder id: builder id, builder fee, taker fee, lots, entry price, `copy` (the `CopyEvent` it was attributed to) |
| `FollowerLeaderPnl` | `<account>-<leaderAccountId>` | realized PnL, funding, fees and net of one follower attributed to one leader by FIFO lots; wins/losses; copied opens/closes and notional. Leader `0` = the owner's own trades (not copies) |
| `MirrorActivity` | `<txHash>-<logIndex>` | unified feed: CREATED, PERPL_ACCOUNT_CREATED, DEPOSITED, WITHDRAWN, POLICY_UPDATED, PAUSED, UNPAUSED, MIRRORED, BLOCKED, CLOSED_ALL, FOLLOWED, STOP_TRIGGERED, LEVEL_SET, LEADER_STOPPED, MARKET_CLOSED with amount, links to the copy/blocked/stop row, JSON detail |
| `FollowerLotQueue` (`@internal`) | `<perplAccountId>-<perpId>` | FIFO tranches `{leaderId, lots}`; not exposed over GraphQL |

### Stats

| Entity | Key | What it holds |
|---|---|---|
| `GlobalStats` | `global` | public traction, **team-run excluded**: Mirror accounts, funded, paused, net/total deposits and withdrawals, copies executed/blocked, match-now copies, copied notional, builder fees, follower realized PnL, close-alls, policy updates, stops triggered, leader stops; Perpl-wide accounts, trades and volume |
| `TeamRunStats` | `teamRun` | the same fields for team-run accounts only |
| `BlockReasonCount` | `<scope>-<reason>` | blocked copies per rule, per scope |
| `DailyStats` | `<scope>-<day>` | daily new accounts, copies, blocks, match-now, copied notional, builder fees, deposits, withdrawals, Perpl trades and volume |
| `CopyQualityStats` | `<scope>-<leaderAccountId\|all>-<day\|all>` | copy quality per scope, for all leaders or one leader, all time (`period: ALL_TIME`) or one UTC day (`DAY`): copies, match-now, opens/closes, copied notional, `builderFeesCNS`, blocked, deviation samples (and how many against the actual leader fill), average / **median / p90 deviation (bps)**, copies worse than the leader, **median / p90 latency in blocks** and in seconds, leader fills verified onchain, keeper-report mismatches |
| `BlockReasonStats` | `<scope>-<leaderAccountId\|all>-<day\|all>-<reason>` | blocked copies per reason with the same scope / leader / period split |
| `CopyQualityHistogram` (`@internal`) | same as `CopyQualityStats` | exact value counts behind the percentiles; not exposed over GraphQL |

## How the numbers are derived

**Execution prices.** Perpl does not emit a price on every position event, so the indexer derives it
and records the method in `PositionEvent.priceSource`:

- OPEN, CLOSE, INVERT, LIQUIDATION, DELEVERAGE: the event's price (`EVENT`).
- DECREASE: Perpl realizes `deltaPnl = ±(exit − entry) · lots` against the average entry, so
  `exit = entry ± deltaPnl · 10^(lotDec+priceDec) / (lots · 10^6)` (`DERIVED_FROM_PNL`).
- INCREASE: `pricePNS` on the event is the new average entry, so the fill is
  `(entryAfter · lotsAfter − entryBefore · lotsBefore) / added` using the Q16 residue (`DERIVED_FROM_ENTRY`).
- Entry unknown (position opened before the start block): last trade price of the market (`LAST_TRADE`).

Checked live against the `MakerOrderFilledV2` fill of the same account in the same transaction:
of 72 derived prices, 58 are exact, 71 are within 1 PNS and the worst is 2 PNS off
([`samples/derived-price-check.json`](../indexer/samples/derived-price-check.json)).

**PnL.** `realizedPnl` = Perpl `deltaPnlCNS` (price PnL of the closed lots). Funding is separate and
positive when received (checked against the maker fill: `amount = depositReleased + deltaPnl + funding − fee`).
Fees are `insFeeCNS + protFeeCNS` on opening legs. `netPnl = realized + funding − fees`.

**Trades, wins, losses.** Every position event is a trade. Reducing events (decrease, close, invert,
liquidation, deleverage) are closing trades. A closing trade is a win when `realized + funding > 0` and
a loss when it is `< 0`. Win rate = wins / (wins + losses).

**Average leverage.** Notional-weighted over opening legs: `Σ(leverage · openingNotional) / Σ openingNotional`.

**Max drawdown.** On the realized equity curve (cumulative net PnL, starting at 0): the largest fall from
a running peak. `maxDrawdownBps = drawdown / (capitalBase + peak)`. The capital base is the
high-water mark of net collateral deposited into Perpl (0 = unknown, then the bps fields are 0).

**Windows.** `DailyAccountStats` holds per-day sums plus the day's opening, high and low cumulative PnL
and its max intraday drawdown. A window's drawdown is
`max over days D of max(intradayDD_D, peakBefore_D − low_D)`, which is exact (property-tested against a
brute-force path computation). Windows are updated incrementally on each trade. On the first trade of a
new UTC day they are recomputed from the day rows, and an hourly block handler rolls stale windows of
idle accounts forward once the indexer is at the head. Check `asOfDay` against the current UTC day.

**Follower attribution (FIFO).** Each follower position keeps a queue of `{leaderId, lots}` tranches
that always sums to the position size. A Perpl opening leg pushes an unattributed tranche; the
`Mirrored` event in the same transaction (always a later log) labels those newest lots with the copied
leader and assigns the opening fee to them. Each reduction consumes the oldest lots first and splits the
realized PnL and funding of that reduction across the consumed tranches pro rata by lots (exact bigint
split, remainder to the last tranche). Closes from `closeAll`, owner `exchangeCall` or liquidations are
attributed the same way, so per-leader PnL always sums to the follower's realized PnL.

**Team-run.** `ENVIO_TEAM_RUN_ADDRESSES` (EOAs, MirrorAccount clones or owners) and
`ENVIO_TEAM_RUN_ACCOUNT_IDS` (Perpl ids) mark accounts `teamRun`, on top of the build-time lists
`TEAM_RUN_ADDRESSES` / `TEAM_RUN_ACCOUNT_IDS` in `indexer/src/lib/constants.ts`, which mirror the
`teamRun` block of `shared/config.json` (demo leader EOA and Perpl id, demo follower clone). Team-run
activity goes to `TeamRunStats` and the `teamRun` scope of `DailyStats` / `BlockReasonCount`, never to
`GlobalStats`. Team-run followers do not count toward a leader's `followers`, `copiesExecuted`,
`copiesBlocked`, `followerPnlCNS` or `followerLeaderStops`. For copy quality the rule is wider: a copy
or block is excluded (`excludedFromStats`, `teamRun` scope of `CopyQualityStats` / `BlockReasonStats`)
when the follower **or the leader** is team-run, because demo-leader trades are produced on demand by
the team. Every row with an account carries `teamRun` for filtering, and excluded rows stay queryable.

## Copy quality

Every `Mirrored` event carries a `CopyProof` (keeper-reported leader fill, the leader's onchain average
entry, Perpl mark and, for opens, the follower's average fill of the added lots and its deviation from
the leader's entry). The indexer stores it on the `CopyEvent` and adds figures it can check itself:

| Field | How it is obtained |
|---|---|
| `leaderRef` | the leader's transaction hash, as submitted by the keeper (`keccak256("MIRROR_MATCH_NOW")` for owner match-now orders) |
| `leaderFillReportedPNS` | `proof.leaderFillPNS` (0 = not reported). Informational; no contract rule trusts it |
| `leaderFillActualPNS`, `leaderEvent` | the leader's own Perpl position event(s) in this market in the `leaderRef` transaction (looked up by `PositionEvent.txHash`), priced exactly as in the trade history; lots-weighted if there are several. Null when that transaction was not indexed or holds no priced event (`LAST_TRADE` estimates are ignored) |
| `leaderFillMismatch`, `leaderFillDiffBps` | both fills known and more than 1 PNS apart (derived prices can be 1 PNS off); diff = `(reported − actual) / actual` |
| `leaderEntryPNS`, `markPNS`, `proofFillPNS`, `entryDeviationBps` | the proof as emitted |
| `followerFillPNS`, `followerFillSource` | opens: `proof.fillPNS` (`PROOF`). Closes, which carry no proof fill: the follower's own `PositionDecreased` / `PositionClosed` event in the same transaction (the latest earlier log for this account and market), priced by the trade-history rules: `PositionClosed` emits the price, a decrease's exit is derived from `deltaPnl` and the entry (`PERPL_EVENT`). `NONE` when nothing filled |
| `leaderFillBasis` | `ACTUAL` when the actual leader fill is known, else `REPORTED` when the keeper reported one, else `NONE`; always `NONE` for match-now |
| `deviationBps` | `(follower − leader) / leader · 10^4` for buys (open long, close short) and `(leader − follower) / leader · 10^4` for sells (open short, close long), rounded half away from zero: **positive = the follower got the worse price** |
| `latencyBlocks`, `latencySeconds` | copy block / timestamp minus the leader event's. Monad block timestamps are whole seconds at ~0.4 s blocks, so sub-second latency only shows in the block delta |
| `excludedFromStats` | follower or leader team-run |

**Aggregates.** Each copy and each block updates four `CopyQualityStats` rows in its scope (`global`,
or `teamRun` when excluded): all leaders × all time, all leaders × its UTC day, its leader × all time,
its leader × day. Blocks also update the matching `BlockReasonStats` rows. Deviation samples come from
filled keeper copies with a leader fill (actual or reported; `deviationSamplesActual` counts the actual
ones); latency samples from keeper copies whose `leaderRef` transaction was indexed. Match-now copies
count as copies but never as samples: they copy an existing position, not a fresh fill. Medians and
p90s are nearest-rank (the smallest value with at least ⌈p · n⌉ samples at or below it, so the median
of an even count is the lower middle) over exact per-value counts kept in `CopyQualityHistogram`, so
they are exact, not estimated. Query examples are in
[`indexer/queries/copy-quality.graphql`](../indexer/queries/copy-quality.graphql).

## Builder fees

MirrorAccount opening orders (keeper copies and owner match-now) go through Perpl `execOrderV2` with the
account's fixed builder (`BUILDER_ID` 26, `BUILDER_FEE_PER_100K` 20 = 0.02% of opening notional); reducing
orders never carry a builder fee. The owner caps the fee with `Policy.maxBuilderFeePer100K`
(`MirrorAccount.maxBuilderFeePer100K`); an opening copy is refused with `BuilderFeeTooHigh` (reason 21)
when the account's fee is above it.

| Field | How it is obtained |
|---|---|
| `CopyEvent.builderFeeCNS` | `proof.builderFeeCNS`: the contract's figure (added lots x fill x rate, rounded up as Perpl does; 0 for closes) |
| `CopyEvent.builderFeePerplCNS` | Perpl's exact fee: the sum of `TakerOrderFilledV2.builderFeeCNS` over the fills with builder id `ENVIO_MIRROR_BUILDER_ID` (default `MIRROR_BUILDER_ID = 26` in `indexer/src/lib/constants.ts`) logged earlier in the same transaction and not already claimed by an earlier copy. Null when there is none (closes, copies before the builder change) |

`TakerOrderFilledV2` carries no account or perp id, so the fill is stored as a `BuilderFeeFill` keyed by
log and linked by transaction order: Perpl emits it inside `execOrderV2`, before the MirrorAccount emits
`Mirrored`, so the next `Mirrored` log in the tx claims it (several copies in one tx each claim the fills
between them). Fallback, should a `Mirrored` log ever be processed before its fill: the fill handler adds
the fee to the nearest later `CopyEvent` in the same transaction.

Aggregates sum `builderFeeCNS` (the contract figure, defined for every copy): `MirrorAccount.builderFeesCNS`
(per follower), `LeaderStats.builderFeesCNS` (per leader, non-team-run followers), `GlobalStats` /
`TeamRunStats` / `DailyStats.builderFeesCNS` (scope by the follower's `teamRun`, like `copiesExecuted`) and
`CopyQualityStats.builderFeesCNS` (per scope / leader / period, team-run follower or leader excluded from
`global`, match-now copies included).

**"What if I had followed".** No new entities are needed: `PositionEvent` already holds every
leader's ordered trades per market with execution price, lots before/after/traded, side, leverage,
realized PnL, funding, fees, block and timestamp. The replay queries and the replay rules are in
[`indexer/queries/simulation.graphql`](../indexer/queries/simulation.graphql); a leader's measured
`medianDeviationBps` from `CopyQualityStats` is the natural slippage assumption.

## Engine queries

Endpoint: `<host>/v1/graphql` (Hasura). The operations below are in
[`indexer/queries/engine.graphql`](../indexer/queries/engine.graphql) and were run against a live sync
([`samples/`](../indexer/samples)). `node scripts/export-samples.mjs` re-runs all of them.

### Leaderboard by window and score inputs (`GET /v1/leaders`)

```graphql
query Leaderboard($window: statswindow!, $minTrades: Int! = 5, $limit: Int! = 200) {
  LeaderWindowStats(
    where: {
      window: { _eq: $window }
      teamRun: { _eq: false }
      isMirrorAccount: { _eq: false }
      trades: { _gte: $minTrades }
    }
    order_by: [{ netPnlCNS: desc }, { volumeCNS: desc }]
    limit: $limit
  ) {
    accountId window asOfDay
    netPnlCNS realizedPnlCNS fundingCNS feesCNS pnlBps volumeCNS
    trades closingTrades wins losses winRateBps avgLeverageHdths
    maxDrawdownCNS maxDrawdownBps activeDays lastTradeAt
    leaderStats {
      address teamRun followers marketsTraded openPositions capitalBaseCNS
      netPnlCNS maxDrawdownBps winRateBps trades firstTradeAt copiesExecuted followerPnlCNS
    }
  }
}
```

Variables: `{"window": "D7"}` (`D7`, `D30`, `D90` map to `7d`, `30d`, `90d`). `sort=pnl` →
`netPnlCNS`, `sort=drawdown` → `maxDrawdownBps` asc. `market=BTC`: filter `leaderStats.marketsTraded`
client-side (Hasura has no array-contains on `integer[]`), or query
`Position(where:{perpId:{_eq:1}, isOpen:{_eq:true}})` for current exposure.

Score inputs, all on the row: `pnlBps` (return on capital), `netPnlCNS`, `maxDrawdownBps` /
`maxDrawdownCNS`, `winRateBps` with `closingTrades` (sample size), `trades`, `activeDays`,
`avgLeverageHdths`, `volumeCNS`, `lastTradeAt` (recency), `leaderStats.firstTradeAt` (track record),
`leaderStats.followers`. A reasonable start:
`score = clamp(pnlBps / (1 + maxDrawdownBps/1000)) · min(1, closingTrades/20) · min(1, activeDays/(days/3))`
with a penalty above 20x average leverage. Use `netPnlCNS` instead of `pnlBps` where `capitalBaseCNS = 0`.

### Leader profile (`GET /v1/leaders/:accountId`)

```graphql
query LeaderProfile($id: String!, $sinceDay: Int!, $trades: Int! = 50) {
  PerplAccount_by_pk(id: $id) {
    id accountId address teamRun isMirrorAccount balanceCNS netDepositedCNS createdAt
    stats {
      trades openingTrades closingTrades wins losses winRateBps liquidations
      realizedPnlCNS fundingCNS feesCNS netPnlCNS pnlBps volumeCNS avgLeverageHdths
      peakNetPnlCNS maxDrawdownCNS maxDrawdownBps capitalBaseCNS marketsTraded openPositions
      firstTradeAt lastTradeAt followers copiesExecuted copiesBlocked copiedNotionalCNS builderFeesCNS followerPnlCNS
    }
    windows(order_by: { days: asc }) {
      window asOfDay netPnlCNS pnlBps volumeCNS trades winRateBps avgLeverageHdths
      maxDrawdownCNS maxDrawdownBps activeDays
    }
    equityCurve(where: { day: { _gte: $sinceDay } }, order_by: { day: asc }) {
      day date cumulativeNetPnlCNS peakNetPnlCNS drawdownCNS equityCNS trades
    }
    positions(where: { isOpen: { _eq: true } }, order_by: { updatedAt: desc }) {
      perpId side lotsLNS entryPricePNS depositCNS leverageHdths openedAt realizedPnlCNS
      market { symbol lotDecimals priceDecimals lastPricePNS }
    }
    events(order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: $trades) {
      kind perpId side lotsBeforeLNS lotsAfterLNS lotsTradedLNS pricePNS priceSource
      notionalCNS realizedPnlCNS fundingCNS feeCNS leverageHdths blockNumber timestamp txHash
    }
  }
}
```

Variables: `{"id": "5201", "sinceDay": <today − 90>}`. The equity curve has one point per day with
activity; carry the last value forward for flat days. Unrealized PnL of open positions = mark (engine,
from Perpl WS) vs `entryPricePNS`. Followers of a leader: `LeaderFollowers(leaderAccountId)` in the file.

### Follower accounts with per-leader PnL (`GET /v1/owners/:owner/accounts`)

```graphql
query OwnerAccounts($owner: String!) {
  MirrorAccount(where: { owner: { _ilike: $owner } }, order_by: { createdAt: asc }) {
    id owner teamRun createdAt paused expiry
    maxLeverageHdths maxSlippageBps dailyLossBps drawdownBps maxBuilderFeePer100K
    leaderAccountIds leaderRatiosBps marketIds marketMaxNotionalsCNS policyVersion
    netDepositsCNS totalDepositedCNS totalWithdrawnCNS funded
    copiesExecuted copiesBlocked matchNowCopies builderFeesCNS lastCopyAt
    perplAccount {
      accountId balanceCNS
      stats { netPnlCNS realizedPnlCNS fundingCNS feesCNS openPositions maxDrawdownCNS }
      positions(where: { isOpen: { _eq: true } }) { perpId side lotsLNS entryPricePNS depositCNS leverageHdths }
    }
    leaderPnl(order_by: { netPnlCNS: desc }) {
      leaderAccountId leader { address }
      realizedPnlCNS fundingCNS feesCNS netPnlCNS wins losses
      copiedOpens copiedCloses copiedNotionalCNS
    }
  }
}
```

`_ilike` makes the owner match case-insensitive. Predicted (not yet deployed) accounts come from the
factory's `predictAccount`, not the indexer.

### Account feed (`GET /v1/accounts/:account/feed`)

```graphql
query AccountFeed($account: String!, $beforeBlock: Int! = 2147483647, $limit: Int! = 50) {
  MirrorActivity(
    where: { mirrorAccount_id: { _eq: $account }, blockNumber: { _lt: $beforeBlock } }
    order_by: [{ blockNumber: desc }, { logIndex: desc }]
    limit: $limit
  ) {
    kind amountCNS detail txHash blockNumber timestamp
    copy { leaderAccountId perpId orderType filledLotsLNS fillPricePNS notionalCNS leaderRef isMatchNow }
    blocked { leaderAccountId perpId reason orderType lotLNS limit actual }
  }
}
```

`$account` is the checksummed clone address. Cursor = `blockNumber` of the last row. `commitState` and
`latencyMs` stay engine-side; the indexer's own chain-derived latency is on `CopyEvent`
(`latencyBlocks`, `latencySeconds`).

### Stats (`GET /v1/stats`)

```graphql
query Stats($sinceDay: Int!, $activeSince: Int!, $copiesOffset: Int! = 0) {
  GlobalStats_by_pk(id: "global") {
    mirrorAccounts fundedAccounts pausedAccounts netDepositsCNS totalDepositedCNS totalWithdrawnCNS
    copiesExecuted copiesBlocked matchNowCopies copiedNotionalCNS builderFeesCNS followerRealizedPnlCNS
    closeAllCount policyUpdates perplAccounts perplTrades perplVolumeCNS lastUpdatedAt lastBlock
  }
  TeamRunStats_by_pk(id: "teamRun") { mirrorAccounts copiesExecuted copiesBlocked netDepositsCNS builderFeesCNS }
  BlockReasonCount(where: { scope: { _eq: "global" } }, order_by: { count: desc }) { reason count }
  DailyStats(where: { scope: { _eq: "global" }, day: { _gte: $sinceDay } }, order_by: { day: asc }) {
    day date newMirrorAccounts copiesExecuted copiesBlocked matchNowCopies copiedNotionalCNS builderFeesCNS
    depositsCNS withdrawalsCNS perplTrades perplVolumeCNS
  }
  activeFollowers: MirrorAccount(where: { teamRun: { _eq: false }, lastCopyAt: { _gte: $activeSince } }) { id }
  copies: CopyEvent(
    where: { teamRun: { _eq: false } }
    order_by: [{ blockNumber: desc }, { logIndex: desc }]
    limit: 50
    offset: $copiesOffset
  ) {
    mirrorAccount_id leaderAccountId perpId orderType filledLotsLNS fillPricePNS notionalCNS builderFeeCNS builderFeePerplCNS isMatchNow txHash timestamp
  }
}
```

Variables: `{"sinceDay": <today − 30>, "activeSince": <now − 7d>}`. Active followers 7d = length of
`activeFollowers`. Median latency and deviation from chain data: `CopyQuality` in
`indexer/queries/copy-quality.graphql`. Indexer lag for `/v1/health`:
`_meta { progressBlock sourceBlock isReady }` (`IndexerStatus` in the file).

## Hosting

| | Envio Cloud (hosted service) | Self-host on Railway |
|---|---|---|
| Needs | the user's envio.dev account (GitHub login) and the Envio Deployments GitHub app on the repo | `ENVIO_API_TOKEN` from envio.dev (free token for HyperSync), a Railway project |
| Setup | Add indexer → root directory `indexer`, config `config.yaml`, deployment branch (e.g. `envio`), env vars below; push to deploy | 3 services: Railway Postgres; `hasura/graphql-engine:v2.43.0`; the indexer from `indexer/Dockerfile` |
| Data source | HyperSync included | HyperSync with the token; RPC fallback is configured |
| GraphQL | hosted endpoint, rate-limited per plan | Hasura URL (public role is read-only) |
| Cost and limits | the free Development plan stops at 100k events / 5 GB / 30 days. A full Perpl history is millions of position events (about 0.2 per block now), so production needs a paid plan, or a recent start block for a demo | Railway usage: a small Postgres plus two containers |
| Redeploys | every push re-indexes from the start block while the old version keeps serving (no downtime) | `envio start` resumes from the database. A schema or handler change needs a fresh database (re-sync) |

Recommendation: self-host on Railway next to the engine (EU region, same private network, no event
cap) using a HyperSync token. Keep Envio Cloud as the alternative once the account exists. A
Development-plan deployment with a recent start block is a quick public demo, but its numbers only
cover that window.

Indexer environment (both options, all `ENVIO_`-prefixed so Envio Cloud forwards them):

| Variable | Value |
|---|---|
| `ENVIO_API_TOKEN` | HyperSync token (self-host; not needed with `ENVIO_RPC_MODE=sync`) |
| `ENVIO_START_BLOCK` | `54773010` (default) |
| `ENVIO_MIRROR_FACTORY_ADDRESS` | factory address after deploy (default: zero address, Mirror disabled) |
| `ENVIO_MIRROR_START_BLOCK` | factory deploy block |
| `ENVIO_TEAM_RUN_ADDRESSES` | comma-separated demo leader EOA, demo follower clone(s) and owner(s) |
| `ENVIO_TEAM_RUN_ACCOUNT_IDS` | comma-separated Perpl ids of team-run accounts (e.g. the demo leader) |
| `ENVIO_RPC_URL` | `https://rpc.monad.xyz` (fallback / RPC mode) |
| `ENVIO_RPC_MODE` | `fallback` (default) or `sync` |
| `ENVIO_RESOLVE_PERPL_ADDRESSES` | `true`: look up address and balance by `eth_call` for accounts first seen without `AccountCreated` (only on syncs that start after the deploy block) |

Railway specifics: indexer service env also needs `ENVIO_PG_HOST`, `ENVIO_PG_PORT`, `ENVIO_PG_USER`,
`ENVIO_PG_PASSWORD`, `ENVIO_PG_DATABASE` (from the Railway Postgres), `ENVIO_PG_SSL_MODE=require` if
the connection is over the public proxy, `HASURA_GRAPHQL_ENDPOINT=http://<hasura>.railway.internal:8080/v1/metadata`,
`HASURA_GRAPHQL_ADMIN_SECRET`. The Hasura service needs `HASURA_GRAPHQL_DATABASE_URL`,
`HASURA_GRAPHQL_ADMIN_SECRET`, `HASURA_GRAPHQL_UNAUTHORIZED_ROLE=public`,
`HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES=true`, `HASURA_GRAPHQL_ENABLE_CONSOLE=false`. The engine reads
`<hasura>/v1/graphql` over the private network.

## Verification

- `pnpm test`: 39 tests. Fixed-point math checked against mainnet events; FIFO queue; window drawdown
  property test (200 random paths against brute force); copy-quality math (leader fill weighting,
  deviation sign for buys and sells, mismatch tolerance, nearest-rank percentiles checked against a
  sort-based reference); handler integration tests with `createTestIndexer` simulate for
  open/increase/decrease/close, invert, partial and full liquidation, pre-range positions, win rate and
  drawdown, 7d/30d/90d windows (recompute and incremental), the Mirror lifecycle (factory registration,
  policy, deposits, copies, match-now flag, blocked decoding, FIFO attribution, feed), copy-quality
  proofs (actual vs reported leader fill, close prices derived from the follower's own decrease/close,
  latency in blocks and seconds, unknown `leaderRef`, match-now) and their all-time / daily / per-leader
  aggregates and blocked-by-reason rows, budgets, leader stops, levels, stop triggers, market closes,
  policy re-arm, team-run exclusion on the Perpl, Mirror and copy-quality paths, and builder fees (policy
  cap, `BuilderFeeTooHigh`, proof fee, Perpl fee linkage incl. several copies per tx and the fallback order,
  global vs team-run aggregates).
- Live: RPC-only sync (no token) of mainnet blocks 110970847 to 110977119 with `envio start`, Postgres
  and Hasura: 1,700 Perpl position events from 51 accounts across all 11 markets. Every engine query
  was then run against Hasura. Outputs are in `indexer/samples/` (`sync-info.json`,
  `position-events.json`, `leaderboard.json`, `leader-profile.json`, `markets.json`, `stats.json`,
  `derived-price-check.json`). The Mirror queries return empty sets until the factory is deployed.

## Known limitations

- Closing fees are not in Perpl's position events (only in fill events, and taker fills carry no
  account id), so `feesCNS` covers opening legs. Net PnL is slightly optimistic by the closing fee.
  Builder fees are tracked separately (`builderFeesCNS`) and are not deducted from `netPnlCNS`.
- On a sync that starts after the deploy block, positions opened earlier have unknown size until their
  next sized event. The first `CLOSE` then counts PnL but no volume (`lotsKnown = false`).
  `PositionUnwound*` (contract wind-down) events are not indexed.
- Windows of idle accounts are rolled forward hourly at the head. Between rollovers, compare `asOfDay`
  with today.
- Copy quality relies on the keeper putting the leader's transaction hash in `leaderRef`. If it does not,
  or the transaction is outside the indexed range, the actual leader fill and latency are null and the
  deviation falls back to the keeper-reported fill (`leaderFillBasis = REPORTED`). `RiskUpdated`,
  `ExchangeCalled`, `Swept` and `ActionExecuted` are not indexed.

## History load with the free HyperSync token (15 requests/min)

Mirror has one free HyperSync token, limited to 15 requests per minute. Envio has no request-rate setting, so:

- `indexer/scripts/hypersync-proxy.mjs` forwards HyperSync requests at 14 per minute, queues the rest in order, and waits a minute and retries on a 429. Run it next to the indexer and set `ENVIO_HYPERSYNC_URL=http://127.0.0.1:8930` (`config.yaml` reads it). The token comes from the environment (`ENVIO_API_TOKEN` or `ENVIO_TOKEN`) and is never logged or committed.
- Measured on 7 Oct 2026 against Monad mainnet, filtering to the Perpl position events the indexer uses, one request returns about 1,000 to 1,250 events:
  - Near Perpl's launch one request covers about 16,000 blocks; recently about 2,200 blocks (about 0.5 position events per block).
- **Full history since Perpl's launch:** roughly 25,000 requests, about 30 hours at 14/min. Too slow for the hackathon.
- **Plan: start about 30 days back** (`ENVIO_START_BLOCK` = head − 6,500,000 blocks): roughly 3,000 requests, about 3½ hours. That covers the 7, 30 and 90-day leader windows except the oldest part of 90 days. Positions opened before the start block are priced from the last trade (`PriceSource.LAST_TRADE`), as already handled.
- **Testnet:** Perpl's testnet activity is far lower, so a sync from the testnet deploy block takes minutes.
- **Live sync** after the backfill is a few requests per minute, well under the limit.
