# Mirror

Copy the best traders on Perpl with your limits enforced onchain. Your own contract checks every copied order and can trade for you but never withdraw. Built on Monad.

- Site and docs: https://mirror.0xo.in · Public stats: https://mirror.0xo.in/stats
- X: [@MirrorOnMonad](https://x.com/MirrorOnMonad)
- Monad Metropolis, Track 01 Onchain Finance & Trading

## How it works

Each follower gets a **MirrorAccount**: a non-upgradeable contract that owns its own Perpl account and holds the follower's AUSD. The follower's policy lives in that contract and is checked on every copied order:

- which leaders to follow and the sizing ratio of each leader's position
- max leverage, allowed markets, max notional per market, max slippage against the mark price
- a daily loss stop, a high-water-mark drawdown stop, and an expiry

A keeper watches leader fills on Perpl and submits the copies. It can trade through the account but can never withdraw: no code path sends collateral to anyone but the owner. A copy can never exceed the sizing ratio times the leader's current position on the same side. When a copy would break a rule the contract does not trade and emits a `Blocked` event, so "blocked by your rule" has its own transaction. **Match now** lets the follower's own signed follow open the leader's current position at once, under the same checks.

The owner is the follower's passkey (Mera, WebAuthn PRF): one prompt, no seed phrase, no extension. Owner actions are EIP-712 signatures relayed by anyone, and deposits use AUSD permit or ERC-3009, so the follower never needs MON.

## Status (7 Oct 2026)

| Part | State |
|---|---|
| Contracts (`contracts/`) | Built. 91 tests: 73 unit, 6 fuzz, 8 invariant properties plus a call summary, 3 mainnet-fork tests against the live Perpl Exchange and AUSD. **Not deployed yet** (testnet first, then mainnet). |
| Copy engine and relayer (`engine/`) | Built. 48 unit tests and a 20-check end-to-end run on a local mainnet fork. Not hosted yet. |
| Indexer (`indexer/`) | Built (Envio HyperIndex). 24 tests; decoded real Perpl events from a live mainnet sync. Not hosted yet. |
| Android app (`app/`) | Built (Expo, Mera passkeys). 38 tests. Passkey create, two PRF namespaces in one prompt, and restore on a second device verified on signed-in emulators for rpId `mirror.0xo.in`. APK not public yet. |
| Site, docs, stats (`web/`) | Live at https://mirror.0xo.in. |

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

# Site
cd web && npm ci && npm run dev
```

One command per public claim, with expected output: https://mirror.0xo.in/docs/run-the-tests

## Why Monad

Measured on Monad mainnet on 6 Oct 2026 (`node scripts/measure-monad.mjs`, and the fork gas test):

- **Blocks about 300 ms** (302–311 ms averages), **Finalized about 550 ms after Proposed** (548–563 ms). Copy slippage grows with the delay between the leader's fill and the copy; Monad's `monadLogs` delivers a leader's fill at the Proposed stage.
- **A fully checked copied open uses about 278k gas** (277,559–279,014 across runs), roughly $0.001, so every rule is enforced onchain on every order instead of trusted offchain.
- **Parallel execution**: each follower's copy touches only that follower's account state.
- **The venue**: Perpl's order book and positions are fully onchain, which lets a contract read the leader's current position and enforce the sizing rule.

## Mainnet addresses

Pending deployment. Third-party contracts used: Perpl Exchange `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`, AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`.

## For judges

https://mirror.0xo.in/docs/judges-guide

## Pre-existing code and third-party material

No pre-existing product code: everything here was written during the hackathon build window. Third-party material used: OpenZeppelin Contracts and forge-std (MIT, git submodules); the Perpl Exchange ABI from Perpl's MIT-licensed dex-sdk (`shared/abi/PerplExchange.json`), with the contract interface declared from scratch (Perpl's BUSL-licensed DelegatedAccount was not used); the Inter typeface (SIL Open Font License, `brand/src/fonts/OFL.txt`); the site is based on a licensed Aceternity UI Pro template and components.

AI coding tools were used to build this project (Claude Code by Anthropic).

## License

MIT, see [LICENSE](LICENSE).
