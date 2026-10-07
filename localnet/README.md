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

Stage-A runs on a fresh localnet (each starts and stops its own chain): `./run-stage-a.sh` (engine API,
`e2e-api.mjs`), `./run-stage-a.sh --web` (the web app with Playwright and a Chrome virtual authenticator with PRF,
`e2e-web.mjs`: builds the export with `MERA_RP_ID=localhost`, engine on 8807, web on 8818), `--all` for both.
Evidence goes to `devices/evidence/stage-a/<run>/` (`web/index.html` is the contact sheet, `web/report.json` the checks).
The web run also checks encrypted alerts (`e2e-web/flows-alerts.mjs`): the engine gets fresh VAPID keys and
`PUSH_WEBPUSH_ENDPOINT_OVERRIDE` pointing at a local push sink on 8817 (`e2e-web/push-sink.mjs`, `E2E_PUSH_PORT`)
that stands in for FCM/Mozilla. Headless Chrome has no push service, so `PushManager.subscribe` is replaced by a
subscription whose keys the sink holds; the sink removes the Web Push layer and checks that the Mirror envelope
inside is still sealed, then the payload is delivered to the app's real service worker with CDP
`ServiceWorker.deliverPushMessage` and the Alerts screen must show it decrypted. The browser is full Chromium in new
headless mode (`E2E_CHROMIUM_CHANNEL`), since the old headless shell always reports notifications as denied.

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
