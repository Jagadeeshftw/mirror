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
| 2026-10-07 | In | MON | 20 | Testnet faucet, to the ops wallet | — |
| 2026-10-07 | In (test funds) | test AUSD | 200.000000 | From Perpl (Arich), to the ops wallet `0x299E…e82C`, as tokens in the wallet. For the testnet demo leader. The 2,000 tester pool we asked for was **not** included. | [0xed2d2361…a65cc0](https://testnet.monadvision.com/tx/0xed2d2361ced9e1b7abbcca0872f300d2b82e8bc43bd0802640250ca5a0a65cc0) |
| 2026-10-07 | In (test funds) | test AUSD | 150.000000 | From Perpl, to the demo follower's owner `0x3aBF…6C78`, as tokens in the wallet | [0x54c511fe…df180a3](https://testnet.monadvision.com/tx/0x54c511fef9d5bfe4e522ce483cd4fa7cd3af6e882ff6adf77208588c3df180a3) |
| 2026-10-07 | In (test funds) | test AUSD | 150.000000 | From Perpl, to the test user's owner `0x1bbD…040D`, as tokens in the wallet | [0x86024d47…d5eb617f9](https://testnet.monadvision.com/tx/0x86024d4757f17c365b20dfcd0a9eb6c399bde44e130e66194900d79d5eb617f9) |
| 2026-10-07 21:28 | In (test funds) | test AUSD | 2,500.000000 | The tester pool, from Perpl, to the ops wallet `0x299E…e82C` (block 69,077,336). We asked for 2,000; 2,500 arrived, sent from `0x8588…d109` (not the address of the first three transfers). Ops wallet balance after it: 2,700 test AUSD. | [0x743e8690…ca4b02](https://testnet.monadvision.com/tx/0x743e86900d73d5e3fb4c13b6a316887a4bb85f135b344f8d38f8b9fd55ca4b02) |
| 2026-10-07 21:56 | Out (gas) | test MON | 1.103232 | Mirror contracts deployed by the ops wallet: its first three testnet transactions (nonces 0-2), gas limits from Monad's eth_estimateGas x 1.15. KeeperRegistry `0x394B…5E41`, MirrorAccountFactory `0xaD81…bD39`, MirrorAccount implementation `0x648e…6316`, all verified on Sourcify. Balance before 60 MON (the faucet 20 plus a 40 MON top-up), after 58.896768. | [registry](https://testnet.monadvision.com/tx/0xc64563e53bc7baa2c0b22e996743f47d5c8ed985f749c12d3815dfd69df59321) · [factory](https://testnet.monadvision.com/tx/0xf3fd5d67e7c6a33e431eebbbe5911c654788a8a10fb474aa5ba706e626579bdf) · [keepers](https://testnet.monadvision.com/tx/0xec3f8874daf820e0e4786859b1086c8803c1d2047b6fde0d41f6d364b9da9979) |
| 2026-10-08 | Out (test funds) | test AUSD | 200.000000 | Team-run demo leader: the ops wallet opened Perpl testnet account **1000** with the original 200 (exact approve, then createAccount; scripts/demo-setup.mjs, which refuses to leave less than the 2,500 tester pool). Gas 0.0314 test MON. Ops wallet after: 2,500 test AUSD (the untouched tester pool), 63.86 test MON (it received about 5 MON more from outside after the deploy). | [approve](https://testnet.monadvision.com/tx/0x962d18c07a46ebffccd0f3a1acfe5c6448c81594cf210257525c952a8bf91325) · [createAccount](https://testnet.monadvision.com/tx/0x0af345a35258ee44f3d15b48df3efb1999c3a1578636f79a0aa090b7021b4b87) |
| 2026-10-09 09:35 | Out (test funds) | test AUSD | 100.000000 | Team funds for the hosted web end-to-end run (`localnet/e2e-live-web.mjs`): withdrawn from the demo leader's Perpl account 1000 to the ops wallet, then sent to the web test account's owner `0x513A…533e`. The tester pool was not touched (ops wallet 2,500 test AUSD before and after). The run followed with it (follow account `0x7289…32CD`) but its withdraw step failed (a script timing bug, since fixed), and the test passkey lived only in that browser session, so the 100 test AUSD (less copy fees) **cannot be recovered**. Account 1000 holds 99.742177 test AUSD after it. Test funds, no value. | [withdraw](https://testnet.monadvision.com/tx/0xa1c918282253bec7f86f36221d6547a2bc924a0c6141e10b2eae21c15d3b797c) · [transfer](https://testnet.monadvision.com/tx/0xf858e80be37f29f167766506a718e3ff48fa65eb98c672bb3b250c25f770de5a) |

The first three Perpl transfers were sent from `0x9253…292A`, the tester pool from `0x8588…d109`. Test funds have no value. Receiving tokens sends nothing: the contract deployment on 7 Oct (21:56 UTC) was the ops wallet's first testnet transaction (nonce 0), and no test AUSD left it before that, so the computed MirrorAccount addresses held.
