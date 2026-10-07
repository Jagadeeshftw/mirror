/**
 * Indexer operations of the Perpl analytics view, the same text as indexer/queries/analytics.graphql
 * (queries.test.ts fails when they drift). Kept as strings so the server bundle does not read files outside web/.
 */

export const QUERIES = {
  AnalyticsCoverage: `query AnalyticsCoverage {
  chain_metadata {
    start_block
    latest_processed_block
    block_height
  }
  first: PositionEvent(order_by: { blockNumber: asc }, limit: 1) {
    blockNumber
    timestamp
  }
  last: PositionEvent(order_by: { blockNumber: desc }, limit: 1) {
    blockNumber
    timestamp
  }
}`,
  ActiveTraders: `query ActiveTraders($since: Int!, $limit: Int! = 20000) {
  PositionEvent(distinct_on: accountId, where: { timestamp: { _gte: $since } }, limit: $limit) {
    accountId
  }
}`,
  Liquidations: `query Liquidations($since: Int!, $limit: Int! = 1000) {
  PositionEvent(
    where: { kind: { _in: [LIQUIDATION, DELEVERAGE] }, timestamp: { _gte: $since } }
    order_by: { timestamp: desc }
    limit: $limit
  ) {
    accountId
    perpId
    kind
    side
    lotsClosedLNS
    pricePNS
    notionalCNS
    realizedPnlCNS
    depositBeforeCNS
    timestamp
    txHash
  }
}`,
  WalletHistory: `query WalletHistory($id: String!, $accountId: numeric!, $sinceDay: Int!, $events: Int! = 200) {
  PerplAccount_by_pk(id: $id) {
    accountId
    address
    isMirrorAccount
    teamRun
    createdAt
    netDepositedCNS
    stats {
      trades
      closingTrades
      wins
      losses
      winRateBps
      liquidations
      realizedPnlCNS
      fundingCNS
      feesCNS
      netPnlCNS
      volumeCNS
      avgLeverageHdths
      maxDrawdownCNS
      firstTradeAt
      lastTradeAt
      followers
    }
  }
  DailyAccountStats(where: { accountId: { _eq: $accountId }, day: { _gte: $sinceDay } }, order_by: { day: asc }) {
    day
    date
    trades
    realizedPnlCNS
    fundingCNS
    feesCNS
    netPnlCNS
    volumeCNS
    endCumPnlCNS
  }
  PositionEvent(
    where: { accountId: { _eq: $accountId } }
    order_by: [{ timestamp: desc }, { logIndex: desc }]
    limit: $events
  ) {
    perpId
    kind
    side
    lotsTradedLNS
    lotsAfterLNS
    lotsKnown
    pricePNS
    priceSource
    notionalCNS
    realizedPnlCNS
    netPnlCNS
    leverageHdths
    depositAfterCNS
    timestamp
    txHash
  }
}`,
} as const;

export type QueryName = keyof typeof QUERIES;
