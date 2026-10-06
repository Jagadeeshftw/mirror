---
title: Contracts
description: Addresses, events, owner action kinds and the EIP-712 domain.
---

Mirror is three contracts, written from scratch in Solidity 0.8.30 with OpenZeppelin against Perpl's published Exchange ABI. No Perpl code is reused. Source: [github.com/Jagadeeshftw/mirror](https://github.com/Jagadeeshftw/mirror) (`contracts/src`), MIT licence.

## Addresses (Monad mainnet, chain id 143)

<!-- addresses-table -->

Mirror's own contracts are **not deployed on mainnet yet**; their rows say "pending" until they are deployed and verified on MonadVision. The demo leader and demo follower accounts are listed on [Team-run accounts](/docs/team-run-accounts) once live.

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
}
```

### Deposits (anyone may relay; funds come from and belong to the owner)

| Function | Notes |
|---|---|
| `depositWithPermit(amount, deadline, v, r, s)` | ERC-2612 permit signed by the owner. |
| `depositWithAuthorization(amount, validAfter, validBefore, nonce, v, r, s)` | ERC-3009 receive authorization signed by the owner. |
| `deposit(amount)` | Owner only, from a standing allowance. |

### Owner (direct, or relayed through `execute`)

| Function | Notes |
|---|---|
| `setPolicy(Policy)` | See [Policy reference](/docs/policy-reference). |
| `follow(Policy, MirrorOrder[] matches)` | Set policy, unpause, match now. |
| `matchNow(MirrorOrder[] matches)` | Opening orders only, up to 16. |
| `setPaused(bool)` | Pause or resume opening copies. |
| `closeAll(uint16 slippageBps)` | Pause and close every position. |
| `withdraw(uint256 amount)` | Always pays the owner. |
| `exchangeCall(bytes data)` | Escape hatch: any Perpl Exchange call as the account. |
| `sweep(address token)` | Send a stray token balance to the owner. |
| `execute(Action, bytes signature)` | Run a signed owner action. Anyone may call. |

### Views

`owner()`, `perplAccountId()`, `paused()`, `netDeposits()`, `actionNonce()`, `leaders()`, `marketIds()`, `markets(perpId)`, `equity()`, `targetLots(perpId, side)`, `actionDigest(Action)`, `DEPOSIT_CAP()`.

## Events

| Event | Emitted when |
|---|---|
| `Initialized(address indexed owner)` | The clone is initialised. |
| `PerplAccountCreated(uint256 indexed perplAccountId)` | The first deposit opens the Perpl account. |
| `Deposited(address indexed from, uint256 amount, uint256 netDeposits)` | A deposit lands. |
| `Withdrawn(address indexed to, uint256 amount, uint256 netDeposits)` | A withdrawal is paid to the owner. |
| `PolicyUpdated(maxLeverageHdths, maxSlippageBps, dailyLossBps, drawdownBps, expiry, leaders, markets)` | The policy is set. |
| `PausedSet(bool paused)` | Paused or resumed. |
| `Mirrored(keeper, leaderAccountId, perpId, orderType, lotLNS, pricePNS, leverageHdths, lotsBefore, lotsAfter, leaderRef)` | A copy (or match-now order) executed. |
| `Blocked(keeper, leaderAccountId, perpId, reason, orderType, lotLNS, limit, actual, leaderRef)` | A rule blocked a copy. |
| `Followed(uint256 matchOrders, uint256 matchesExecuted)` | A follow with match now completed. |
| `ClosedAll(uint16 slippageBps, uint256 positionsClosed)` | Close all completed. |
| `ExchangeCalled(bytes data, bytes result)` | The owner used the escape hatch. |
| `Swept(address indexed token, uint256 amount)` | A token was swept to the owner. |
| `ActionExecuted(uint8 indexed kind, uint256 nonce)` | A signed action ran. |
| `RiskUpdated(uint32 day, uint128 dayStartEquity, uint128 highWaterEquity, uint256 equity)` | Loss-stop baselines were refreshed during a check. |

### Block reasons

`BlockReason` values, as emitted in `Blocked.reason`:

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
