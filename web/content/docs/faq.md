---
title: FAQ
description: Short answers to the questions people ask first.
---

## Can Mirror withdraw my money?

No. Your AUSD sits in your own MirrorAccount. The keeper can only submit copies that pass your rules. Withdrawing, changing rules, pausing and closing all need your passkey, and `withdraw` always pays the owner. A withdrawal attempted by the keeper reverts. See [Safety model](/docs/safety-model).

## What happens if Mirror's servers go down?

Copies stop, but your money is not stuck. Every owner action is an EIP-712 signature that anyone can submit, and `withdraw`, `closeAll` and `setPaused` can also be called directly by the owner address. Your funds and positions are in your contract and on Perpl, not on a Mirror server.

## What happens when a leader's trade breaks one of my rules?

The contract does not trade. It emits a `Blocked` event naming the rule and the numbers, in its own transaction, and the app shows it, for example: "Leader opened 12x BTC long. Your max leverage is 5x. Not copied."

## Can a copy be bigger than the leader's position?

No. Your size is capped at your ratio times the leader's **current** position on the same side, read from Perpl onchain. The sizing ratio itself is capped at 100%.

## What happens when the leader closes?

The keeper copies the close. Closing copies are allowed even when you are paused or your policy has expired, so you can always follow a leader out.

## Do I need MON, a seed phrase or a wallet extension?

No. Your account is a passkey. Deposits use AUSD permits and owner actions are signed and relayed, so the relayer pays the gas.

## What if I lose my phone?

Install the app on a new phone signed in to the same Google account and tap **Restore**. Your passkey syncs through Google Password Manager and controls the same MirrorAccount.

## How much can I deposit?

Between 10 AUSD (Perpl's account minimum) and 25 AUSD (the beta cap) per account, while the contracts are unaudited.

## How are leaders ranked?

From onchain Perpl data indexed by Envio: PnL, maximum drawdown, win rate and consistency over 7, 30 and 90 days. Nansen wallet intelligence (labels such as Smart Trader or Fund, and cross-venue history) will feed the score; that integration is coming.

## Does Mirror charge fees?

Yes: 0.02% of the size a copy opens or adds, and nothing on closes or stops. Mirror is Perpl builder 26; Perpl charges the fee on the opening fill and pays it to Mirror. Your own contract caps it at the maximum you sign, and Mirror's contracts never transfer it: they only ever send collateral to you. Perpl's trading fees apply to every order as usual. Details: [Fees](/docs/fees).
## Is it audited?

Not yet. That is why deposits are capped. Copy trading leveraged perpetuals is risky and you can lose what you deposit.

## Why Android only?

Passkey restore through Google Password Manager and a sideloaded APK let us ship and iterate quickly during the beta. Other platforms may follow.

## Is Mirror affiliated with Perpl, Monad, Agora, Mera, Envio or Nansen?

No. Those names describe the integrations. No affiliation or endorsement is implied.
