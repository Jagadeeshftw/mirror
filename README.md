# Mirror

Copy the best traders on Perpl with your limits enforced onchain. Your own contract checks every copied order and can trade for you but never withdraw. Built on Monad.

- Site and docs: https://mirror.0xo.in · Judges guide: https://mirror.0xo.in/docs/judges-guide
- Web app: https://mirror.0xo.in/app · Android APK: https://mirror.0xo.in/download (both being published; until then the pages say so) · Public stats: https://mirror.0xo.in/stats
- X: [@MirrorOnMonad](https://x.com/MirrorOnMonad)
- Monad Metropolis, Track 01 Onchain Finance & Trading

## How it works

Each follower gets a **MirrorAccount**: a non-upgradeable contract that owns its own Perpl account and holds the follower's AUSD. The follower's policy lives in that contract and is checked on every copied order:

- which leaders to follow and the sizing ratio of each leader's position
- max leverage, allowed markets, max notional per market, max slippage against the mark price
- an entry filter against the leader's onchain average entry
- a daily loss stop, a high-water-mark drawdown stop, and an expiry
- up to four leaders per account, each with its own margin budget and loss stop
- a maximum builder fee

A keeper watches leader fills on Perpl and submits the copies. It can trade through the account but can never withdraw: no code path sends collateral to anyone but the owner. A copy can never exceed the sizing ratio times the leader's current position on the same side. When a copy would break a rule the contract does not trade and emits a `Blocked` event, so "blocked by your rule" has its own transaction. **Match now** lets the follower's own signed follow open the leader's current position at once, under the same checks. Stop-loss, take-profit and loss stops can be executed by anyone once they are true onchain (reduce-only), so they work even if Mirror is down. **Stop following, keep my positions** is enforced per leader by the contract (`setLeaderDetached`): every further copy from that leader is refused with Blocked reason 22, while the follower's own stops and closes keep working.

Mirror's fee: Mirror is Perpl builder 26 and charges 0.02% (20 per 100,000) of the size a copy opens or adds, nothing on closes or stops (confirmed by Perpl on 7 Oct 2026; live once deployed, and set in the testnet deployment). No fee has accrued yet. Perpl's exchange charges it on the fill; Mirror's contracts never transfer it, and each follower's contract refuses any copy whose fee is above the maximum they signed. See https://mirror.0xo.in/docs/fees.

The owner is the follower's passkey (Mera, WebAuthn PRF): one prompt, no seed phrase, no extension. Owner actions are EIP-712 signatures relayed by anyone, and deposits use AUSD permit or ERC-3009, so the follower never needs MON.

## Status (8 Oct 2026)

| Part | State |
|---|---|
| Contracts (`contracts/`) | **Deployed on Monad testnet** and verified on Sourcify (7 Oct 2026, 21:56 UTC; addresses below). Not deployed on mainnet. 158 Foundry tests: unit, fuzz (1,000 runs), 12 invariant properties plus a call summary, and 6 mainnet-fork tests against the live Perpl Exchange and AUSD. Slither: 137 findings, each fixed or explained (`docs/security/static-analysis.md`). |
| Local network (`localnet/`) | Perpl's real exchange code deployed as in Perpl's dex-sdk test kit, with Mirror on top. Stage A: API 29/29, web app 64/64 (one optional check skipped: second-browser passkey restore, unsupported by Chrome's virtual authenticator), Android app 34/34 on two Android emulators (`mirror-a`, `mirror-b`). |
| Copy engine and relayer (`engine/`) | Built, 218 tests. Hosting prepared on Railway (project `mirror-testnet`), **not live yet**. |
| Indexer (`indexer/`) | Built (Envio HyperIndex; mainnet and testnet configs), with per-copy quality proof. 44 tests. Hosting prepared, **not live yet**. |
| App (`app/`) | Android app and web app 1.0.0 (Expo, Mera passkeys), 205 tests. Tested on Android emulators and in Chrome only. Testnet APK and web app being published. |
| Site, docs, stats (`web/`) | Live at https://mirror.0xo.in. 25 tests. |
| Team-run demo leader | Mainnet: Perpl account 5416, 10.00 AUSD, no trades (`docs/funding-ledger.md`). Testnet: not opened yet. |
| Users | None yet. Testnet tester round: 25 outside testers at 100 test AUSD each, from 2,500 test AUSD Perpl provided (`docs/tester-kit.md`). |

## Repository layout

```
contracts/   Foundry: MirrorAccount, MirrorAccountFactory, KeeperRegistry, tests, scripts
engine/      TypeScript copy engine and relayer (Fastify, viem)
indexer/     Envio HyperIndex over Perpl and Mirror events
app/         Expo / React Native Android app
web/         Next.js landing page, docs and public stats
shared/      ABIs and network config shared by every package
brand/       Logo, icons and renders (python3 brand/src/render.py)
devices/     Android emulator setup, passkey/PRF probe, end-to-end harness, evidence
docs/        API spec, submission text, bounty checklists, runbooks
scripts/     measure-monad.mjs (block time and finality from public RPC)
```

## Run it

```bash
git clone --recursive https://github.com/Jagadeeshftw/mirror && cd mirror

# Contracts: all tests; the fork tests touch mainnet state only with MONAD_RPC_URL set
cd contracts && forge test
MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc PerplMainnetFork -vv
cd ..

# Engine: unit tests and the end-to-end run on a local mainnet fork (needs anvil and forge)
cd engine && pnpm install && pnpm test && pnpm e2e:fork && cd ..

# Indexer tests
cd indexer && pnpm install && pnpm test && cd ..

# App tests and builds (see app/scripts/build-apk.sh)
cd app && npm ci && npx jest && cd ..

# Site tests, then the dev server
cd web && npm ci && npm test && npm run dev

# Local network: Perpl's exchange plus Mirror, then the smoke test (needs anvil; contracts built, scripts installed)
cd localnet && npm install && npm run fetch && npm start      # another shell: node smoke.mjs

# Stage A on a fresh local network: API run, then the web app with Playwright (--all); Android: devices/run-stage-a-android.sh
cd localnet && ./run-stage-a.sh --all

# Deployment plan with gas from Monad's own estimator (sends nothing without --send)
cd scripts && npm install && node deploy-contracts.mjs --network testnet --cap 200
```

One command per public claim, with expected output: https://mirror.0xo.in/docs/run-the-tests

## Why Monad

Measured on Monad mainnet on 6 Oct 2026 (`node scripts/measure-monad.mjs`, and the fork gas test):

- **Blocks about 300 ms** (302–311 ms averages), **Finalized about 550 ms after Proposed** (548–563 ms). Copy slippage grows with the delay between the leader's fill and the copy; Monad's `monadLogs` delivers a leader's fill at the Proposed stage.
- **A fully checked copied open uses about 278k gas** (277,559–279,014 across runs), roughly $0.001, so every rule is enforced onchain on every order instead of trusted offchain.
- **Parallel execution**: each follower's copy touches only that follower's account state.
- **The venue**: Perpl's order book and positions are fully onchain, which lets a contract read the leader's current position and enforce the sizing rule.

## Addresses

Monad testnet (chain 10143), verified on Sourcify (`contracts/deployments/10143.json`):

| Contract | Address |
|---|---|
| KeeperRegistry | `0x394B12D4355bE5B54DBCaa989cf44F8966195E41` |
| MirrorAccountFactory | `0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39` |
| MirrorAccount implementation | `0x648e35cdfD4Aca744Ed33c69A0089A5621A76316` |

Testnet runs against Perpl's testnet Exchange `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` and test AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, with a deposit cap of 200 test AUSD per account.

Monad mainnet: Mirror's contracts are not deployed. Third-party contracts used: Perpl Exchange `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`, AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`.

## For judges

https://mirror.0xo.in/docs/judges-guide

## Pre-existing code and third-party material

No pre-existing product code: everything here was written during the hackathon build window. Third-party material used: OpenZeppelin Contracts and forge-std (MIT, git submodules); the Perpl Exchange ABI from Perpl's MIT-licensed dex-sdk (`shared/abi/PerplExchange.json`), with the contract interface declared from scratch (Perpl's BUSL-licensed DelegatedAccount was not used); the Inter typeface (SIL Open Font License, `brand/src/fonts/OFL.txt`); the site is based on a licensed Aceternity UI Pro template and components.

AI coding tools were used to build this project (Claude Code by Anthropic).

## License

MIT, see [LICENSE](LICENSE).
