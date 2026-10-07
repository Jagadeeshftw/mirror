---
title: Policy reference
description: Every field of the follow policy and of stop-loss / take-profit levels, its unit and its allowed range.
---

Your policy is stored in your MirrorAccount and checked onchain on every copied order. It is set with `setPolicy(policy)` or, together with match now, `follow(policy, matches)`; both can be signed and relayed. Setting a policy replaces the previous one completely.

```solidity
struct Policy {
    uint16 maxLeverageHdths;
    uint16 maxSlippageBps;
    uint16 dailyLossBps;
    uint16 drawdownBps;
    uint40 expiry;
    uint16 maxEntryDeviationBps;
    uint16 stopSlippageBps;
    bool   flattenOnStop;
    LeaderRule[] leaders;   // { uint32 accountId; uint32 ratioBps; uint64 budgetCNS; uint16 lossStopBps; }
    MarketRule[] markets;   // { uint32 perpId;    uint64 maxNotionalCNS; }
}
```

## Fields

| Field | Unit | Allowed range | Meaning |
|---|---|---|---|
| `leaders` | list | 1 to 4 entries | Perpl accounts you follow, all in one account. |
| `leaders[].accountId` | Perpl account id | non-zero, not your own, no duplicates | The leader. |
| `leaders[].ratioBps` | basis points | 1 to 10,000 (0.01% to 100%) | Your size as a share of that leader's position. 5,000 = 50%. You can never hold more than the leader. |
| `leaders[].budgetCNS` | AUSD, 6 decimals | greater than 0 | Most margin this leader's positions may hold. An opening copy that would take the leader's margin above it is blocked (`LeaderBudgetExceeded`). |
| `leaders[].lossStopBps` | basis points of `budgetCNS` | 0 to 10,000 (0 = off) | Stop copying this leader once its PnL falls below minus this share of its budget. PnL is realised since the leader was added (net of fees) plus unrealised on its open positions. |
| `maxLeverageHdths` | hundredths | 100 to 10,000 (1x to 100x) | Highest leverage a copy may open at. 500 = 5x. |
| `maxSlippageBps` | basis points | 1 to 1,000 (0.01% to 10%) | Furthest a copy's limit price may sit from Perpl's mark price. Applies to opens and closes. |
| `maxEntryDeviationBps` | basis points | 0 to 5,000 (0 = off) | Entry guard. An opening copy is blocked (`EntryTooFar`) when its limit price or the current mark is worse than the leader's onchain average entry price by more than this. Applies to match now too. |
| `markets` | list | 1 to 16 entries | Markets you allow. A copy in any other market is blocked. |
| `markets[].perpId` | Perpl market id | must exist on Perpl, no duplicates | See the market table below. |
| `markets[].maxNotionalCNS` | AUSD, 6 decimals | greater than 0 | Largest position notional at mark in that market. 10,000,000 = 10 AUSD. |
| `dailyLossBps` | basis points | 0 to 9,999 (0 = off) | Stop opening once equity is this far below the day's starting equity (UTC day). |
| `drawdownBps` | basis points | 0 to 9,999 (0 = off) | Stop opening once equity is this far below its high-water mark. |
| `flattenOnStop` | bool | | When true, anyone may close positions once the daily loss, drawdown or a leader's loss stop is true onchain. See [Stops anyone can trigger](/docs/safety-model#stops-anyone-can-trigger). |
| `stopSlippageBps` | basis points | 1 to 2,000 (0.01% to 20%) | Price bound, from mark, of the closes sent by a triggered account or leader stop. |
| `expiry` | unix seconds | in the future | After this time the account only reduces exposure. |

A policy outside these ranges reverts with `InvalidPolicy(field)`, naming the field.

Setting a policy again also:

- clears the halt on any market where a stop-loss or take-profit fired,
- re-arms a leader whose loss stop was hit, with a clean loss record,
- keeps the loss record of a leader that stays in the policy and was not stopped.

A leader added for the first time starts with a clean loss record.

## Leaders and markets

Perpl nets each market into one position per account, so with several leaders a market belongs to one leader at a time: the leader whose copy opened it. It stays theirs until the position is flat again. Another leader's copy into that market is blocked (`MarketHeldByOtherLeader`). This is what makes every position, budget and loss stop attributable to exactly one leader.

Removing a leader from the policy leaves its positions open and untouched. They are no longer mirrored: the keeper cannot copy that leader's exits (`LeaderNotAllowed`). This is "stop following, keep my positions". You close them yourself with `closeMarket` or `closeAll`, or with a stop-loss / take-profit level.

## Stop-loss and take-profit levels

Levels are set separately from the policy, per market, with `setLevels(levels)` (signed action 9). Setting a new policy does not change them.

```solidity
struct Level {
    uint32 perpId;
    uint8  side;          // side of the position it protects: 0 Long, 1 Short
    uint64 stopLossPNS;   // 0 = none
    uint64 takeProfitPNS; // 0 = none
    uint16 slippageBps;
}
```

| Field | Allowed range | Meaning |
|---|---|---|
| `side` | 0 or 1 | The level only fires while you hold a position on this side. |
| `stopLossPNS` | price in Perpl's units | Long: fires at or below. Short: fires at or above. |
| `takeProfitPNS` | price in Perpl's units | Long: fires at or above. Short: fires at or below. |
| `slippageBps` | 1 to 2,000 | Price bound, from mark, of the closing order. |

- Both prices zero clears the level for that market.
- With both set, a long's stop-loss must sit below its take-profit, and a short's above. Otherwise `InvalidLevel("order")`.
- Up to 16 levels per call.
- A level that closes the position fully is cleared. After a partial fill it stays, so it can be triggered again.

## How the app presents them

| Follow sheet control | Policy field |
|---|---|
| Allocation | Not a policy field: it is what you deposit (10 to 25 AUSD in beta). |
| Sizing | `leaders[].ratioBps` |
| Max leverage | `maxLeverageHdths` |
| Max notional per market | `markets[].maxNotionalCNS` |
| Allowed markets | `markets[].perpId` |
| Max slippage | `maxSlippageBps` |
| Daily loss stop | `dailyLossBps` |
| High-water-mark stop | `drawdownBps` |
| Expiry | `expiry` |

The app is being updated for the new fields: leader budget and loss stop, the entry guard, stop slippage, flatten on stop, and levels.

## Markets

| perpId | Market | Lot decimals | Price decimals |
|---|---|---|---|
| 1 | BTC | 5 | 1 |
| 10 | MON | 0 | 6 |
| 20 | ETH | 3 | 2 |
| 31 | SOL | 3 | 3 |
| 40 | HYPE | 2 | 4 |
| 50 | ZEC | 4 | 2 |
| 60 | LIT | 1 | 5 |
| 70 | VVV | 2 | 4 |
| 90 | PUMP | 0 | 6 |
| 100 | NEAR | 2 | 4 |
| 110 | UNI | 2 | 4 |

Decimals are read from Perpl when the policy is set, so the contract always uses Perpl's own values.

## Other limits

| Limit | Value |
|---|---|
| Leaders per account | 4 |
| Max match orders per follow or match now | 16 |
| Close-all and close-market slippage | 1 to 2,000 bps (0.01% to 20%) |
| Mark vs fresh Chainlink price for stop triggers | must agree within 200 bps (`MAX_MARK_ORACLE_GAP_BPS`) |
| Max matches per order (`maxMatches`) | up to 1,000 |
| Deposit cap per account (beta) | 25 AUSD net |
| Minimum first deposit | Perpl's account minimum, currently 10 AUSD |

## Example

Follow two leaders: the first at 50% with a 15 AUSD budget and a 30% loss stop, the second at 25% with a 10 AUSD budget and no loss stop. Max 5x, BTC/ETH/SOL with 10 AUSD per market, 1% slippage, a 2% entry guard, 5% daily loss stop, 15% drawdown stop, flatten on stop with 3% stop slippage, until 31 Dec 2026:

```json
{
  "maxLeverageHdths": 500,
  "maxSlippageBps": 100,
  "dailyLossBps": 500,
  "drawdownBps": 1500,
  "expiry": 1798675200,
  "maxEntryDeviationBps": 200,
  "stopSlippageBps": 300,
  "flattenOnStop": true,
  "leaders": [
    { "accountId": 4127, "ratioBps": 5000, "budgetCNS": "15000000", "lossStopBps": 3000 },
    { "accountId": 3310, "ratioBps": 2500, "budgetCNS": "10000000", "lossStopBps": 0 }
  ],
  "markets": [
    { "perpId": 1,  "maxNotionalCNS": "10000000" },
    { "perpId": 20, "maxNotionalCNS": "10000000" },
    { "perpId": 31, "maxNotionalCNS": "10000000" }
  ]
}
```

The leader account ids in the example are illustrative.
