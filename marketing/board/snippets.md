# Board snippets, 11-14 Oct

Generated from `posts.json`; `node marketing/board/check.mjs` checks each is under 280 as X counts (links 23) and that the clip exists. Real output only: each clip replays captured terminal output or Stage A emulator screenshots. Not claimed anywhere: a physical phone, revenue (no builder fee has accrued onchain yet).

## 2026-10-11 · @MirrorOnMonad

Clip: `marketing/clips/day-11-stop-following-keep-positions.mp4`

```
Your own contract has the last word on Mirror. Now that includes leaving.

"Stop following, keep my positions" is enforced onchain: your contract refuses the leader's exits too, while your own stops still fire.

Tested on a fork of live Perpl.

github.com/Jagadeeshftw/mirror
```

Facts behind it:
- MirrorAccount.setLeaderDetached: copies naming a detached leader are Blocked (reason 22), opens and closes (contracts/src/MirrorAccount.sol, commit e52d407)
- Fork test on live Perpl: keeper exit refused, follower keeps 2 lots, a stranger's take-profit closes them (marketing/clips/src/captures/day11-detach-fork.txt)
- 11 unit tests incl. stops, account stop, closeAll still working (captures/day11-detach-unit.txt)

## 2026-10-12 · @MirrorOnMonad

Clip: `marketing/clips/day-12-builder-fee.mp4`

```
Every copy shows what it costs. Mirror is Perpl builder 26, confirmed by @perplxyz: 0.02% of the size a copy opens, nothing on closes, capped by a maximum the follower signs.

On a fork of live Perpl: 0.000165 AUSD on a 1-lot BTC open, 0 on the close.

mirror.0xo.in/docs/fees
```

Facts behind it:
- Builder id 26 at 20 per 100,000 confirmed by Perpl on 7 Oct (docs/funding-ledger.md, docs/submission)
- Fork test: TakerOrderFilledV2 builderId 26 builderFeeCNS 165 on the open, builderId 0 fee 0 on the close (captures/day12-builder-fork.txt)
- Policy.maxBuilderFeePer100K signed by the owner; BuilderFeeTooHigh blocks above it
- No revenue claimed: no fee has accrued onchain yet

## 2026-10-13 · @MirrorOnMonad

Clip: `marketing/clips/day-13-encrypted-alerts.mp4`

```
Alerts only you can read. A second key from the same passkey seals every Mirror alert, so our server and the push service only relay ciphertext.

Your lock screen says "New activity". The app decrypts the rest.

Tested on Android emulators and in the web app. #Monad
```

Facts behind it:
- PRF namespace mirror.prf.ns.notify.v1, X25519 + ChaCha20-Poly1305 envelope (app/src/lib/pushEnvelope.ts, engine/src/services/pushcrypto.ts, shared test vector)
- Android emulator Stage A, 8 Oct: FCM notification shows only 'Mirror · New activity'; Alerts screen shows the decrypted copy (devices/evidence/stage-a-android-20261008-030408, shots 162 and 166)
- Web Push path covered by the Stage A web suite (64/64)
- Not claimed: a physical phone (none tested yet)

## 2026-10-14 · @MirrorOnMonad

Clip: `marketing/clips/day-14-live-on-testnet.mp4`

```
Mirror's contracts are live on Monad testnet and verified on Sourcify.

Every gas limit came from Monad's own estimator: planned 1.103232 MON, spent 1.103232 MON. Builder 26 at 0.02% is built into every account.

testnet.monadvision.com/address/0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39 #Monad
```

Facts behind it:
- Deploy output (captures/day14-testnet-deploy.txt), Sourcify full match for all three (captures/day14-sourcify.txt)
- Ledger: 1.103232 test MON, balance 60 -> 58.896768 (docs/funding-ledger.md)
- Factory constructor builderId 26, fee 20 per 100,000 (contracts/deployments/10143.json)
