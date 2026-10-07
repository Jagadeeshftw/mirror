# Static analysis: Slither on the Mirror contracts

- Tool: Slither 0.11.6, 102 detectors, run on `contracts/src` (dependencies, tests and scripts excluded).
- Command: `cd contracts && slither . --filter-paths "lib/|test/|script/" --exclude-dependencies`
- Raw output: [slither-output.txt](slither-output.txt)
- Result (after builder attribution, 7 Oct 2026): 135 findings in the same 11 detector classes as before. One High was a real issue and is fixed. Everything else is explained below, finding by finding.

## Fixed

### High: `arbitrary-send-erc20-permit` in `depositWithPermit`
The detector flags any `transferFrom` with a `from` other than `msg.sender` next to a `permit` call.

In Mirror, `from` is always the account's fixed owner and the destination is the account itself. So the finding as worded can't send anyone else's funds anywhere.

It did point at a real weakness, though. The function tolerated a failed `permit`, so that a front-run permit still lets the deposit go through. That tolerance had a side effect: if the owner had ever approved the account directly (for the owner-only `deposit()`), **anyone** could call `depositWithPermit` with a junk signature and move the owner's AUSD into the account. Nothing could be stolen, but money the owner hadn't chosen to commit would start being copy-traded.

**Fix:** when `permit` fails, the deposit now goes ahead only if the signature is the owner's permit for exactly this account, amount and deadline, at the nonce that was just used. Each such permit is honoured once (`frontRunPermitUsed`). Three tests cover it:
- `test_depositWithPermit_junkSignatureCannotUseStandingAllowance`
- `test_depositWithPermit_frontRunPermitHonouredOnlyOnce`
- `test_depositWithPermit_frontRunPermitForAnotherAmountRejected`

The detector still matches the pattern after the fix. It is now a false positive.

## Explained (no change)

| Detector (count) | Where | Why it is safe |
|---|---|---|
| `reentrancy-no-eth` (4) | `_deposit`, `_copy`, `_closeOne`, `triggerLevel`: state written after a call to the Perpl Exchange | The only external contracts called are the Perpl Exchange and AUSD. Both are fixed in the implementation's immutables at deployment, and neither can be swapped by anyone. Every external entry point that changes state is `nonReentrant` (OpenZeppelin's transient-storage guard), so no cross-function re-entry is possible. Post-trade state such as `marketLeader` and realised PnL has to be written after the order, because it depends on the fill. |
| `reentrancy-benign` (5), `reentrancy-events` (9) | Same pattern: events or bookkeeping after the Exchange or token call | As above. Events come after the call because they report its result (lots after, fill price). |
| `unused-return` (16) | `getPositionV2` tuple members not needed at that call site; `execOrder`'s and `execOrderV2`'s order signature; `tryRecover`'s third value | Deliberate. IOC orders are read back from the position after execution, never from the return value. Every place that needs the mark checks its validity flag. |
| `uninitialized-local` (6) | `kept`, `levelPNS`, `kind`, `leaderEntry`, `p`, `n` | Solidity zero-initialises locals, and each one is meant to start at zero, false or the first enum value before it is set on the path that uses it. |
| `calls-loop` (76) | `_equity`, `_leaderExposure`, `_closePositions`, `_requireTrustedMarks`, `_setPolicy`, `_targetLots`, `_bookValue` | The loops are bounded: at most 4 leaders, 16 policy markets, and the account's own open positions from Perpl's 1,024-bit position map. The only callee is the trusted Exchange. A call that reverts reverts the whole action, which is the safe outcome for both copies and stops. |
| `timestamp` (5) | Policy expiry, signed-action deadlines, permit deadline, oracle freshness, setPolicy expiry check | All windows are seconds to days. Validator influence on `block.timestamp` is far below that, and oracle freshness uses Perpl's own maximum age. |
| `low-level-calls` (1) | `_exchangeCall` | This is the owner-only escape hatch, and the result is checked (`ExchangeCallFailed`). Keepers and stop triggers cannot reach it. |
| `cyclomatic-complexity` (3) | `_setPolicy`, `_copy`, `execute` | These are validation and dispatch functions. Every branch is covered by unit tests, and `_copy` additionally by fuzz and invariant tests. |
| `naming-convention` (9) | Upper-case immutables (including `BUILDER_ID`, `BUILDER_FEE_PER_100K`); `DOMAIN_SEPARATOR` | Style only. Immutables follow the constant style, and `DOMAIN_SEPARATOR` is the ERC-2612 name. |

## What the tests add beyond static analysis

- **144 Foundry tests:** unit tests; fuzz tests at 1,000 runs each; 11 invariant properties plus a call summary; and 5 mainnet-fork tests against the live Perpl Exchange and AUSD.
- **Invariants checked under random two-leader sequences:**
  - No non-owner ever receives collateral.
  - Hostile calls and forged signatures never succeed.
  - Every executed copy is within policy: per-leader target, notional cap, market ownership, leader budget, entry guard, close floor.
  - Stop triggers called by a stranger only reduce positions.
  - Only the owner changes the policy.
  - Collateral is conserved.
  - Every open position has a followed holder.
  - No reducing order is ever attributed to a builder, and every attributed order names builder 26 at the fixed fee, within the owner's signed maximum.
