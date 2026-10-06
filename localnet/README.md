# localnet

A local chain for stage-A tests: Perpl's real exchange implementation, deployed the way Perpl's own test kit
(`perpl_sdk::testing::TestExchange` in [PerplFoundation/dex-sdk](https://github.com/PerplFoundation/dex-sdk),
MIT) deploys it, with Mirror on top.

```bash
cd contracts && forge build && cd ..
cd scripts && npm install && cd ..
cd localnet && npm install && npm run fetch && npm start      # keeps running; Ctrl-C stops anvil
node smoke.mjs                                                  # in another shell
```

- Same anvil settings as the kit: 0.4 s blocks, 128 KiB code size limit, 200M block gas limit, 100 gwei base
  fee, FIFO ordering, chain id 1337. RPC on port 8546, faucet and test controls on 8547.
- Perpl's exchange and proxy artifacts are fetched from dex-sdk commit `01b9910` and checked by SHA-256.
- One difference from the kit: the collateral is an AUSD-like token with ERC-2612 permit and ERC-3009, because
  Mirror's gasless deposits use them (the kit's TestToken has neither).
- Markets BTC (id 1) and ETH (id 20) with mainnet decimals; oracle ignored, as in the kit; marks refreshed every
  4 s by the price administrator; two market makers quote around the mark so IOC copies can fill.
- Mirror is deployed with `scripts/deploy-contracts.mjs --network local` (gas from the chain's estimator).
- `out/env.json` lists every address, the team-run demo leader's Perpl account, and anvil's public test keys.
- Faucet: `POST :8547/fund {"address":"0x…","ausd":200}`. Move a mark (to trip a stop):
  `POST :8547/mark {"perpId":1,"price":80000}`.
