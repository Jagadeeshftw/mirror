---
title: Policy reference
description: Every field of the follow policy, its unit and its allowed range.
---

Your policy is stored in your MirrorAccount and checked onchain on every opening copy. It is set with `setPolicy(policy)` or, together with match now, `follow(policy, matches)`; both can be signed and relayed. Setting a policy replaces the previous one completely.

```solidity
struct Policy {
    uint16 maxLeverageHdths;
    uint16 maxSlippageBps;
    uint16 dailyLossBps;
    uint16 drawdownBps;
    uint40 expiry;
    LeaderRule[] leaders;   // { uint32 accountId; uint32 ratioBps; }
    MarketRule[] markets;   // { uint32 perpId;    uint64 maxNotionalCNS; }
}
```

## Fields

| Field | Unit | Allowed range | Meaning |
|---|---|---|---|
| `leaders` | list | 1 to 4 entries | Perpl accounts you follow. |
| `leaders[].accountId` | Perpl account id | non-zero, not your own, no duplicates | The leader. |
| `leaders[].ratioBps` | basis points | 1 to 10,000 (0.01% to 100%) | Your size as a share of the leader's position. 5,000 = 50%. You can never hold more than the leader. |
| `maxLeverageHdths` | hundredths | 100 to 10,000 (1x to 100x) | Highest leverage a copy may open at. 500 = 5x. |
| `maxSlippageBps` | basis points | 1 to 1,000 (0.01% to 10%) | Furthest a copy's limit price may sit from Perpl's mark price. Applies to opens and closes. |
| `markets` | list | 1 to 16 entries | Markets you allow. A copy in any other market is blocked. |
| `markets[].perpId` | Perpl market id | must exist on Perpl, no duplicates | See the market table below. |
| `markets[].maxNotionalCNS` | AUSD, 6 decimals | greater than 0 | Largest position notional at mark in that market. 10,000,000 = 10 AUSD. |
| `dailyLossBps` | basis points | 0 to 9,999 (0 = off) | Stop opening once equity is this far below the day's starting equity (UTC day). |
| `drawdownBps` | basis points | 0 to 9,999 (0 = off) | Stop opening once equity is this far below its high-water mark. |
| `expiry` | unix seconds | in the future | After this time the account only reduces exposure. |

A policy outside these ranges reverts with `InvalidPolicy(field)`, naming the field.

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
| Max match orders per follow or match now | 16 |
| Close-all slippage | 1 to 2,000 bps (0.01% to 20%) |
| Max matches per order (`maxMatches`) | up to 1,000 |
| Deposit cap per account (beta) | 25 AUSD net |
| Minimum first deposit | Perpl's account minimum, currently 10 AUSD |

## Example

Follow one leader at 50%, max 5x, BTC/ETH/SOL with 10 AUSD per market, 1% slippage, 5% daily loss stop, 15% drawdown stop, until 31 Dec 2026:

```json
{
  "maxLeverageHdths": 500,
  "maxSlippageBps": 100,
  "dailyLossBps": 500,
  "drawdownBps": 1500,
  "expiry": 1798675200,
  "leaders": [{ "accountId": 4127, "ratioBps": 5000 }],
  "markets": [
    { "perpId": 1,  "maxNotionalCNS": "10000000" },
    { "perpId": 20, "maxNotionalCNS": "10000000" },
    { "perpId": 31, "maxNotionalCNS": "10000000" }
  ]
}
```

The leader account id in the example is illustrative.
