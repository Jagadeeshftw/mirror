---
title: Fees
description: What Mirror charges, when, and how your own contract caps it.
---

## What Mirror charges

**0.02% of the size a copy opens or adds.**
- Mirror is registered with Perpl as builder 26.
- The fee is 20 per 100,000 of opening notional.
- Perpl confirmed the builder code and onchain attribution on 7 Oct 2026.
- It is live once Mirror's contracts are deployed.

| | Builder fee |
|---|---|
| A copy that opens or adds to a position | 0.02% of the size it adds |
| Match now on follow (opens) | 0.02% of the size it adds |
| A copy that reduces or closes | none |
| A stop-loss, take-profit or loss stop, whoever executes it | none |
| Close a market, close all, withdraw | none |

**Example:** a copy that opens 0.0001 BTC at 85,000 is 8.50 AUSD of notional. The builder fee is 0.0017 AUSD.

Perpl's own trading fees apply to every order, as on any Perpl trade. They are Perpl's, not Mirror's.

## How it is charged

The fee is charged by Perpl's exchange when the copy fills, in the same way as Perpl's trading fee.
- Your MirrorAccount attaches "builder 26, 20 per 100,000" to the opening order it sends to Perpl.
- Perpl takes the fee from that fill and pays it out to Mirror's builder account, Perpl account 5416.
- **Mirror's contracts never transfer it.** "No code path sends collateral to anyone but the owner" stays true of every Mirror contract: withdrawals and sweeps only ever go to you.

On Perpl, a fee attached to an order applies to everything that order fills, closes included. So your contract attaches the builder fee only to opening orders. Every closing path goes to Perpl without it:
- keeper closes;
- stops;
- close a market;
- close all.

A test runs this against Perpl's live exchange on a mainnet fork:
- A copied open was charged 0.000168 AUSD for builder 26, and the proof in Mirror's event recorded the same 0.000168.
- The copied close was charged nothing.

## Your contract caps it

Your policy includes a **maximum builder fee that you sign** with your passkey. The app sets it to 0.02%.
- The builder id and the fee are fixed in the contract when it is deployed. Neither the keeper nor Mirror can raise the fee or send it to another builder.
- If the fee were ever above the maximum you signed, your contract would refuse the copy. It records `Blocked` with the rule `BuilderFeeTooHigh` and both numbers.
- Reducing and closing paths are never blocked by this rule, because they never carry a fee.

**Worst case:** you pay at most your signed maximum times the notional of each opening fill. With the default, that is 0.02% of what each copy opens, and nothing on closes.

## Where you see it

- **Before you follow:** the follow sheet shows the fee as a percentage and as an amount for the planned size, before the passkey prompt.
- **On every copy:** the feed and the copy's proof view show the fee charged. The `Mirrored` event carries it as `builderFeeCNS`, and Perpl's own fill event carries the exact figure. So anyone can add up the fees per follower from chain data.

## What this means for Mirror

The fee is Mirror's business model: a small share of the size copies open, paid only when a copy actually trades.

**Illustration only:** $10M of copied opening notional in a month at 0.02% would be $2,000 that month. No revenue yet: Mirror's contracts are not deployed on mainnet, and on testnet the fee has only been charged in test AUSD, which is test funds.
