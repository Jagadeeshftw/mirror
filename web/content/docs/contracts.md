---
title: Contracts
description: Addresses, deployment, functions, events, owner action kinds and the EIP-712 domain.
---

Mirror is three contracts, written from scratch in Solidity 0.8.30 with OpenZeppelin against Perpl's published Exchange ABI. No Perpl code is reused. Source: [github.com/Jagadeeshftw/mirror](https://github.com/Jagadeeshftw/mirror) (`contracts/src`), MIT licence.

## Addresses (Monad mainnet, chain id 143)

<!-- addresses-table -->

Mirror's own contracts are **not deployed yet**, on testnet or mainnet; their rows say "pending" until they are deployed and verified on MonadVision. Testnet comes first, then mainnet. The team-run demo leader already exists on mainnet as Perpl account 5416 (opened 7 Oct 2026 with 10.00 AUSD); the demo follower is created after deployment. See [Team-run accounts](/docs/team-run-accounts).

## Deployment

`scripts/deploy-contracts.mjs` deploys KeeperRegistry and MirrorAccountFactory (which deploys the MirrorAccount implementation) and registers keepers. Every gas limit comes from the target chain's own `eth_estimateGas`, plus 15% headroom. Forge's Ethereum-priced simulation is not used for Monad deployments: Monad charges the full gas limit and prices cold state access differently, so an estimate from anything but Monad itself can be far off.

- Without `--send` it only prints the plan: predicted addresses, each estimate and the expected fee. Mainnet also needs `--confirm-mainnet`, and `--send` needs `--expect-nonce` so the predicted addresses stay valid.
- MirrorAccount is about 36 KB of runtime code (36,321 bytes), above EIP-170's 24 KB limit. Monad accepts contracts above that limit; this was checked with `eth_estimateGas` on mainnet and testnet.
- A mainnet plan on 7 Oct 2026 estimated about 1.03 MON for the registry and factory at 100 gwei base fee plus 2 gwei tip (about 1.04 MON with a keeper registration).

## MirrorAccountFactory

Deploys one MirrorAccount per `(owner, salt)` as a non-upgradeable EIP-1167 clone. Anyone may deploy an account for an owner; the owner is fixed at creation. The address is deterministic, so the app shows it before deployment.

| Function | Notes |
|---|---|
| `createAccount(address owner, bytes32 salt) → MirrorAccount` | Deploys and initialises the clone. |
| `predictAccount(address owner, bytes32 salt) → address` | Counterfactual address. |
| `isAccount(address) → bool` | True for clones deployed by this factory. |

```solidity
event AccountCreated(address indexed owner, address indexed account, bytes32 salt);
```

## KeeperRegistry

The set of addresses allowed to call `MirrorAccount.mirror`. `Ownable2Step`; the owner can add or remove keepers and has no access to any account.

```solidity
event KeeperSet(address indexed keeper, bool allowed);
```

## MirrorAccount

### Keeper

| Function | Notes |
|---|---|
| `mirror(MirrorOrder order) → bool executed` | Copy one leader fill. Returns false (and emits `Blocked`) when a rule blocks it. |

```solidity
struct MirrorOrder {
    uint32  leaderAccountId; // leader whose fill this copies
    uint32  perpId;
    uint8   orderType;       // 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort
    uint64  lotLNS;
    uint64  pricePNS;        // IOC limit price, within maxSlippageBps of mark
    uint16  leverageHdths;   // opening orders only
    uint16  maxMatches;      // capped at 1,000
    bytes32 leaderRef;       // leader fill reference, for attribution and latency
    uint64  leaderFillPNS;   // leader fill price reported by the keeper; statistics only, no rule trusts it
}
```

### Stop triggers (anyone may call)

Each succeeds only when its condition is true onchain and only sends reduce-only IOC closes. See [Safety model](/docs/safety-model#stops-anyone-can-trigger).

| Function | Notes |
|---|---|
| `triggerLevel(uint256 perpId) → lotsClosed` | Execute the owner's stop-loss or take-profit in one market. Halts the market for new copies until the next policy. |
| `triggerAccountStop() → positionsClosed` | Needs `flattenOnStop`. When the daily loss or drawdown stop is hit: pause and close everything. |
| `triggerLeaderStop(uint32 leader) → positionsClosed` | Needs `flattenOnStop`. When that leader's loss stop is hit: close only its positions. |

### Deposits (anyone may relay; funds come from and belong to the owner)

| Function | Notes |
|---|---|
| `depositWithPermit(amount, deadline, v, r, s)` | ERC-2612 permit signed by the owner. If the permit was front-run, the deposit goes ahead only for the owner's exact permit (this account, amount, deadline, the nonce just used), once. |
| `depositWithAuthorization(amount, validAfter, validBefore, nonce, v, r, s)` | ERC-3009 receive authorization signed by the owner. |
| `deposit(amount)` | Owner only, from a standing allowance. |

### Owner (direct, or relayed through `execute`)

| Function | Notes |
|---|---|
| `setPolicy(Policy)` | See [Policy reference](/docs/policy-reference). |
| `follow(Policy, MirrorOrder[] matches)` | Set policy, unpause, match now. |
| `matchNow(MirrorOrder[] matches)` | Opening orders only, up to 16. |
| `setLevels(Level[] levels)` | Set or clear stop-loss / take-profit levels per market. |
| `setPaused(bool)` | Pause or resume opening copies. |
| `closeMarket(uint32 perpId, uint16 slippageBps)` | Close the whole position in one market. |
| `closeAll(uint16 slippageBps)` | Pause and close every position. |
| `withdraw(uint256 amount)` | Always pays the owner. |
| `exchangeCall(bytes data)` | Escape hatch: any Perpl Exchange call as the account. |
| `sweep(address token)` | Send a stray token balance to the owner. |
| `execute(Action, bytes signature)` | Run a signed owner action. Anyone may call. |

### Views

`owner()`, `perplAccountId()`, `paused()`, `netDeposits()`, `actionNonce()`, `leaders()`, `marketIds()`, `markets(perpId)`, `level(perpId)`, `marketLeader(perpId)`, `leaderBook(leader) → (marginCNS, unrealizedCNS, realizedCNS, stopped)`, `leaderRealizedCNS(leader)`, `leaderStopped(leader)`, `equity()`, `targetLots(perpId, leader, side)`, `frontRunPermitUsed(digest)`, `actionDigest(Action)`, `DEPOSIT_CAP()`, `MAX_LEADERS()`, `MAX_MARK_ORACLE_GAP_BPS()`, and a getter for every policy scalar (`maxEntryDeviationBps()`, `stopSlippageBps()`, `flattenOnStop()` and so on).

## Events

| Event | Emitted when |
|---|---|
| `Initialized(address indexed owner)` | The clone is initialised. |
| `PerplAccountCreated(uint256 indexed perplAccountId)` | The first deposit opens the Perpl account. |
| `Deposited(address indexed from, uint256 amount, uint256 netDeposits)` | A deposit lands. |
| `Withdrawn(address indexed to, uint256 amount, uint256 netDeposits)` | A withdrawal is paid to the owner. |
| `PolicyUpdated(maxLeverageHdths, maxSlippageBps, dailyLossBps, drawdownBps, expiry, maxEntryDeviationBps, stopSlippageBps, flattenOnStop, leaders, markets)` | The policy is set. |
| `PausedSet(bool paused)` | Paused or resumed. |
| `Mirrored(keeper, leaderAccountId, perpId, orderType, lotLNS, pricePNS, leverageHdths, lotsBefore, lotsAfter, leaderRef, CopyProof proof)` | A copy (or match-now order) executed. |
| `Blocked(keeper, leaderAccountId, perpId, reason, orderType, lotLNS, limit, actual, leaderRef, leaderFillPNS, markPNS)` | A rule blocked a copy. |
| `Followed(uint256 matchOrders, uint256 matchesExecuted)` | A follow with match now completed. |
| `LevelSet(uint32 indexed perpId, uint8 side, uint64 stopLossPNS, uint64 takeProfitPNS, uint16 slippageBps)` | A level was set or cleared. |
| `StopTriggered(address indexed caller, StopKind indexed kind, uint32 indexed scope, uint256 limit, uint256 actual, uint256 oraclePNS, uint256 positionsClosed)` | A stop was executed. `scope` is the perpId (levels), the leader (leader stop) or 0 (account stop). For levels, `limit` is the level, `actual` the mark, `oraclePNS` the Chainlink price if fresh (else 0) and the last field the lots closed. |
| `LeaderStopped(uint32 indexed leaderAccountId, int256 pnlCNS, uint256 limitCNS)` | A leader's loss stop was hit. |
| `MarketClosed(uint32 indexed perpId, uint16 slippageBps, uint256 lotsBefore, uint256 lotsAfter)` | The owner closed one market. |
| `ClosedAll(uint16 slippageBps, uint256 positionsClosed)` | Close all completed. |
| `ExchangeCalled(bytes data, bytes result)` | The owner used the escape hatch. |
| `Swept(address indexed token, uint256 amount)` | A token was swept to the owner. |
| `ActionExecuted(uint8 indexed kind, uint256 nonce)` | A signed action ran. |
| `RiskUpdated(uint32 day, uint128 dayStartEquity, uint128 highWaterEquity, uint256 equity)` | Loss-stop baselines were refreshed during a check. |

### Copy proof

```solidity
struct CopyProof {
    uint64 leaderFillPNS;     // keeper-reported leader fill price, statistics only (0 if unknown)
    uint64 leaderEntryPNS;    // leader's onchain average entry on the copied side (0 for closes)
    uint64 markPNS;           // Perpl mark at copy time
    uint64 fillPNS;           // this account's average fill for an open, from Perpl's average entry (0 if none, and for closes)
    int32  entryDeviationBps; // fillPNS vs leaderEntryPNS, positive when the follower paid worse
}
```

`StopKind`: 0 `DailyLoss`, 1 `Drawdown`, 2 `LeaderLoss`, 3 `StopLoss`, 4 `TakeProfit`.

### Block reasons

`BlockReason` values, as emitted in `Blocked.reason`. New values are only ever appended.

| Value | Name | `limit` / `actual` |
|---|---|---|
| 1 | `Paused` | 0 / 0 |
| 2 | `Expired` | expiry / block time |
| 3 | `LeaderNotAllowed` | 0 / leader account id |
| 4 | `LeaderSideMismatch` | copy side / leader side (max uint if flat) |
| 5 | `MarketNotAllowed` | 0 / perpId |
| 6 | `LeverageTooHigh` | max / requested (hundredths) |
| 7 | `SlippageTooHigh` | price bound / limit price |
| 8 | `FlipNotAllowed` | 0 / current lots |
| 9 | `StaleMark` | 0 / 0 |
| 10 | `ExceedsLeaderTarget` | target lots / lots after |
| 11 | `ExceedsMaxNotional` | cap / notional (AUSD, 6 decimals) |
| 12 | `DailyLossStop` | equity floor / equity |
| 13 | `DrawdownStop` | equity floor / equity |
| 14 | `LeverageTooLow` | 100 / requested |
| 15 | `EntryTooFar` | entry bound / limit price or mark |
| 16 | `MarketHeldByOtherLeader` | copy's leader / leader holding the market |
| 17 | `LeaderBudgetExceeded` | budget / margin after the copy (AUSD, 6 decimals) |
| 18 | `LeaderLossStop` | loss limit / loss (AUSD, 6 decimals); 0 / 0 if the leader was already stopped |
| 19 | `MarketHalted` | 0 / perpId |
| 20 | `CloseBelowTarget` | target lots / lots after the close |
| 21 | `BuilderFeeTooHigh` | your signed `maxBuilderFeePer100K` / the account's fixed builder fee (20) |

## Action kinds

Signed owner actions run through `execute(Action, signature)`. `data` is the ABI encoding of the arguments.

| Kind | Name | `data` |
|---|---|---|
| 1 | `ACTION_SET_POLICY` | `abi.encode(Policy)` |
| 2 | `ACTION_SET_PAUSED` | `abi.encode(bool)` |
| 3 | `ACTION_CLOSE_ALL` | `abi.encode(uint16 slippageBps)` |
| 4 | `ACTION_WITHDRAW` | `abi.encode(uint256 amount)` |
| 5 | `ACTION_EXCHANGE_CALL` | `abi.encode(bytes callData)` |
| 6 | `ACTION_SWEEP` | `abi.encode(address token)` |
| 7 | `ACTION_FOLLOW` | `abi.encode(Policy, MirrorOrder[])` |
| 8 | `ACTION_MATCH_NOW` | `abi.encode(MirrorOrder[])` |
| 9 | `ACTION_SET_LEVELS` | `abi.encode(Level[])` |
| 10 | `ACTION_CLOSE_MARKET` | `abi.encode(uint32 perpId, uint16 slippageBps)` |

## EIP-712 domain

| Field | Value |
|---|---|
| `name` | `Mirror Account` |
| `version` | `1` |
| `chainId` | `143` |
| `verifyingContract` | the follower's MirrorAccount (clone) address |

```text
Action(uint8 kind,bytes data,uint256 nonce,uint256 deadline)
```

The struct hash is `keccak256(abi.encode(ACTION_TYPEHASH, kind, keccak256(data), nonce, deadline))`. `nonce` must equal the account's current `actionNonce()` and increments on use; `deadline` is a unix timestamp after which the signature is rejected (`ActionExpired`). `actionDigest(action)` returns the digest, so clients can show exactly what is being signed.

## Builder attribution

- `BUILDER_ID` (26) and `BUILDER_FEE_PER_100K` (20, i.e. 0.02%) are immutables, passed by `MirrorAccountFactory` at deployment and identical for every account.
- **Opening orders** (keeper copies and match now) go to Perpl's `execOrderV2` with the order extension `abi.encode(uint16 1, abi.encode(uint256 26, uint256 20))`, the format of Perpl's dex-sdk `BuilderAttribution::encode`.
- **Every reducing order** goes to `execOrder` with no extension: keeper closes, stops, close a market, close all.
- Perpl charges the builder fee on the fill and reports it in `TakerOrderFilledV2.builderFeeCNS`. Mirror's `Mirrored` proof repeats it as `builderFeeCNS`.
- An opening copy is refused with `BuilderFeeTooHigh` when the fixed fee is above the owner's signed `maxBuilderFeePer100K`.
- See [Fees](/docs/fees).
