# Funding ledger

Every transaction that moves real funds into, out of or from a team wallet. Mainnet is chain 143, testnet is chain 10143.

Ops wallet: `0x299E77E58DD37607e4890C761924D829F8ACe82C`

## Monad mainnet

| Date (UTC) | Direction | Asset | Amount | What | Transaction |
|---|---|---|---|---|---|
| 2026-10-07 | In | MON | 559.847940868770289150 | Bridged from Solana via deBridge ([bundle](https://app.debridge.com/bundle/0x6dd5babd66c212ddb5f7d0384b7401ec714618d40d4db7fb83ab023d9e2fa086)); delivered by the deBridge fulfil transaction in block 111134965 as an internal transfer | [0xd680b969…d4ba4d550](https://monadvision.com/tx/0xd680b969e3a76ced2c2e57f70488794414762d10fb002b1b9a1d79617ba4d550) |
| 2026-10-07 | Gas (failed swap) | MON | 0.0816 (800,000 gas × 102 gwei) | KyberSwap MON→AUSD swap reverted "Call failed": out of gas in the second hop (Uniswap v4 "fairflow" hook that routes through Balancer v3 and an Aave ERC-4626 wrapper). Monad's own estimate for that route was 3.44M gas, the aggregator's 680k. No tokens moved. | [0x86983b21…dc1686d6](https://monadvision.com/tx/0x86983b2188a21ca3f53af08d62c6e220b41a91e159f9760a87ad5de9dc1686d6) |
| 2026-10-07 | Swap | MON → AUSD | 362 MON → 10.385718 AUSD | KyberSwap with the fairflow source excluded, 1% max slippage. Gas limit 700,000 from Monad's estimator plus margin; fee 0.0714 MON (Monad charges the limit) | [0x687b9b5e…8c848f4fca](https://monadvision.com/tx/0x687b9b5eabc972dda539e4768c8a81d2e4931df9a1ade80fff3e2b8c848f4fca) |
| 2026-10-07 | Approval | AUSD | exactly 10.000000 | Exact approval for the Perpl Exchange. Gas limit 100,000; fee 0.0102 MON | [0xbbe27f3c…f83043c](https://monadvision.com/tx/0xbbe27f3cf3423fc4f75d5e390ef9b7c7df05e49c7a10b23b3ac59a943f83043c) |
| 2026-10-07 | Out to Perpl | AUSD | 10.000000 | `createAccount(10000000)`: team-run demo leader, **Perpl account 5416**, balance 10.000000 AUSD. Gas limit 280,000; fee 0.02856 MON. No trade placed. | [0x7e8ebc03…d0736b989](https://monadvision.com/tx/0x7e8ebc035a305a79a0a8aff7b464ea5a66c4e058bf7f8b78fd24e92d0736b989) |

Balances after the bridge, before anything is sent: 559.85 MON, 0 USDC, 0 AUSD. Nonce 0.
Balances after the failed swap: 559.766340868770289150 MON, 0 USDC, 0 AUSD. Nonce 1.
Balances after opening the Perpl account: 197.656180868770289150 MON, 0 USDC, 0.385718 AUSD in the wallet; 10.000000 AUSD in Perpl account 5416. Nonce 4.

All four transactions were sent by the wallet owner. Every gas limit after the failed attempt came from Monad's own `eth_estimateGas` plus a margin.

## Monad testnet

| Date (UTC) | Direction | Asset | Amount | What | Transaction |
|---|---|---|---|---|---|
| 2026-10-07 | In | MON | 20 | Testnet faucet | — |

The first testnet transaction from the ops wallet must be the contract deployment, so the computed MirrorAccount addresses stay valid.
