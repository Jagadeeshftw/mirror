# Mirror: Android device testing

Everything here runs on this Mac with the Android SDK at `/opt/homebrew/share/android-commandlinetools` and JDK 17 at `/opt/homebrew/opt/openjdk@17`. Nothing in this folder signs in to accounts or sends transactions.

```
devices/
  assetlinks.json         -> serve at https://mirror.0xo.in/.well-known/assetlinks.json
  run-e2e.sh              -> E2E runner (boot/clean, install APK, run flow, collect evidence)
  e2e/
    lib/device.py         -> adb + uiautomator driver, passkey-approval helper
    provision.py          -> set screen-lock PIN + enroll a fingerprint (idempotent)
    passkey_approve.py    -> standalone: wait for passkey sheet, tap Continue, emu finger touch 1
    prf_probe.py          -> scripted PRF probe (create / 2-namespace create / encrypt key / restore)
    flow.py               -> line-based flow runner used by run-e2e.sh
    flows/stage-a.flow    -> full Group 1 flow on the localnet (run-stage-a-android.sh)
    flows/mirror-full.flow-> outdated placeholder (pre-1.0 testIDs)
    contact_sheet.py      -> index.html contact sheet from report.json
    flows/prf-probe.flow  -> harness smoke test against the probe app
    TESTIDS.md            -> testIDs the app must expose
  prf-probe/              -> Expo app (Mera 0.2.0) rpId mirror.0xo.in, package com.zeroxo.mirror
    PRF-NAMESPACES.md     -> multi-namespace PRF findings + X25519 code
  evidence/<run-id>/      -> screenshots, run.log, report.json, logcat
  logs/                   -> emulator / gradle / sdkmanager logs (gitignored)
```

## 1. Signing and assetlinks

- Release keystore: `keys/mirror-release.keystore` (PKCS12, RSA 2048, 10000 days, alias `mirror`). Its passwords are in `keys/mirror-release.env` (`KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`). Both files are chmod 600, and `keys/` and `*.keystore` are gitignored. **Back up both files.** If the key is lost, the assetlinks association breaks, and so do users' passkey logins in the app.
- Release SHA-256: `F3:18:96:73:17:D0:23:48:A2:F5:21:C6:8E:84:88:71:B0:7A:1E:07:6E:8A:25:FC:9D:9A:38:9E:6C:46:87:BA`
- Debug SHA-256: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`. This is the stock React Native / Expo template `debug.keystore`, and it is public.
- **Before release, delete the debug fingerprint from `assetlinks.json`.** It is only there so `expo run:android` debug builds work against the real rpId. Anyone holding the public debug key could otherwise sign an app that `mirror.0xo.in` vouches for.
- How to serve it:
  - Path: `https://mirror.0xo.in/.well-known/assetlinks.json`
  - Status 200, `Content-Type: application/json`, no redirects, valid TLS
  - Check it with `curl -sI https://mirror.0xo.in/.well-known/assetlinks.json` and with Google's checker: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://mirror.0xo.in&relation=delegate_permission/common.get_login_creds`
- To sign the real app, copy the `signingConfigs.release` block from `prf-probe/android/app/build.gradle`. It reads the env vars and is used only when `KEYSTORE_PASSWORD` is set. Alternatively, upload the keystore to EAS credentials.
- If you ship through Google Play with Play App Signing, Play re-signs the app with its own key. In that case add Play's "App signing key certificate" SHA-256 to `assetlinks.json` as well.

## 2. Emulators (already created)

| AVD | serial | image | state left by setup |
|---|---|---|---|
| `mirror-a` | `emulator-5554` | android-35 Google Play arm64 (Pixel 7). Play services self-updated to 26.36.35. | booted with a window, PIN `1234`, 1 fingerprint (finger id 1), **no Google account** |
| `mirror-b` | `emulator-5556` | same image. Play services is still the image's 24.23.35 and should self-update after sign-in. | same |

The newest Play image (android-37.2 ps16k, 2.3 GB) was **not** installed. The disk was 98–100% full (it dropped to 3.5 GB free while other installs were running), so the download was cancelled. To switch later:

```
sdkmanager "system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a"
avdmanager create avd -n mirror-a -k "system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a" -d pixel_7 --force
python3 devices/e2e/provision.py emulator-5554
```

On the current image, Play services has already self-updated to 26.36.35, and its Fido module handles passkeys and PRF. The PRF extension reached Play services in the earlier probe.

To boot them again later (same flags the setup used):

```
E=/opt/homebrew/share/android-commandlinetools/emulator/emulator
$E -avd mirror-a -port 5554 -no-snapshot -no-boot-anim -gpu host &
$E -avd mirror-b -port 5556 -no-snapshot -no-boot-anim -gpu host &
python3 devices/e2e/provision.py emulator-5554   # no-op if already provisioned
```

The Google sign-in, the PIN and the fingerprint are stored in each AVD's data partition. They survive cold boots and are lost only with `-wipe-data` (`run-e2e.sh --wipe`).

## 3. What the user must do (one time, about 2 minutes per emulator)

In **each** emulator window (`mirror-a`, then `mirror-b`), sign in with the **same** Google test account. The restore-on-b step depends on the passkey syncing through Google Password Manager.

1. If the lock screen is showing, swipe up and enter PIN `1234`. Or click the fingerprint icon in the emulator's Extended controls.
2. Open **Settings → Passwords, passkeys & accounts → Add account → Google**. The setup left each emulator on the "Add an account" screen.
3. Sign in in the emulator window. If Google asks for 2-step verification, approve it on your phone.
4. If the device asks to "verify it's you" or to set up the screen lock for Google Password Manager, enter `1234`.
5. Optional: Play Store → profile → Manage apps → update Google Play services.

Use a throwaway test Google account, not your personal one. Nobody else types credentials: the scripts never touch the sign-in screens.

After that, check the account is present with `adb -s emulator-5554 shell dumpsys account | grep 'Accounts:'` (it should say `Accounts: 1` or more).

## 4. PRF probe

```
# rebuild (release-signed so assetlinks can match); APK lands in prf-probe/dist/
cd devices/prf-probe/android
set -a; . ../../../keys/mirror-release.env; set +a
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
cp app/build/outputs/apk/release/app-release.apk ../dist/mirror-prf-probe-release.apk

# run (installs, taps each button, auto-approves the sheet with emu finger touch, records results)
python3 devices/e2e/prf_probe.py emulator-5554 devices/prf-probe/dist/mirror-prf-probe-release.apk \
  --steps create,create2ns,enc,restore
# then on b, with the same account, the synced passkey should restore to the SAME address:
python3 devices/e2e/prf_probe.py emulator-5556 devices/prf-probe/dist/mirror-prf-probe-release.apk --steps restore,enc
```

When it works you should see:
- `CREATE OK address=0x…`
- `CREATE2NS OK … x25519=<hex>`. If it says `second-not-returned`, Google Password Manager ignores `eval.second`, so use the 2-prompt path.
- `NSENC OK x25519=<hex>`
- A `RESTORE OK` address on b that matches a. The `NSENC` X25519 key on b should also match a's.

**Result on 2026-10-06 (no Google account, domain not live):** creation fails at Play services' rpId check, before any biometric prompt. Evidence is in `evidence/prf-probe-noaccount*/`.
- The sheet showed "Create passkey on another device?". With no Google account there is no local provider, only hybrid (QR).
- After tapping Continue, logcat shows `Fido: [Fido2RequestController] RpId validation failed` and then `The incoming request cannot be validated`.
- Mera's error: `MeraError PASSKEY_OPERATION_FAILED: Passkey creation failed | cause.error=RequestFailed | cause.message=The incoming request cannot be validated`. On the first attempt after install it was `cause.error=NoCreateOption | cause.message=No create options available.`
- The get/restore attempts showed the "Sign in another way / View options" sheet (no credentials for the rpId). The harness pressed back and got `cause.error=UserCancelled | cause.message=User cancelled the selector`.
- The self-test (PRF to BIP-39 to secp256k1, EIP-712 sign and recover on Hermes) passes.

Both blockers are fixed outside the code: (1) serve `assetlinks.json`, (2) sign in to Google.

**Result on 2026-10-06, signed in, `https://mirror.0xo.in/.well-known/assetlinks.json` live:** everything works.
Google's Digital Asset Links API confirms `mirror.0xo.in` → `com.zeroxo.mirror` with the release fingerprint.
Evidence is in `evidence/prf-signedin-a/`, `evidence/prf-signedin-b/` and `evidence/prf-signedin-b2/`; only result screens
are committed, because the Google sheet screenshots show the account email.
- mirror-a (Android 15, Play services 26.36.35), one simulated fingerprint touch per action:
  - `CREATE OK address=0x1bbD7e3333B99E7618C921B267ee246D1425040D`
  - `CREATE2NS OK address=0x3aBF625Be454F8F78e5aDA1B4AB627Ede6C26C78 x25519=f9b75f20…2362235d`: Google Password
    Manager returns **both** PRF outputs (account salt and a second namespace salt) in **one** prompt.
  - `NSENC OK x25519=f9b75f20…2362235d`: evaluating the second namespace on its own gives the same key.
- mirror-b, same Google account: the passkey synced. The first use on a new device asks once, on a Google page, for
  the original device's screen lock ("Enter your screen lock for the selected device"); the account owner enters it.
  After that:
  - `RESTORE OK address=0x3aBF625Be454F8F78e5aDA1B4AB627Ede6C26C78`, the same account as on mirror-a.
  - `NSENC OK x25519=f9b75f20…2362235d`, the same encryption key as on mirror-a.

## 5. E2E runs

```
devices/run-e2e.sh <path/to/mirror.apk>                         # full flow (flows/mirror-full.flow)
devices/run-e2e.sh <apk> devices/e2e/flows/prf-probe.flow       # harness smoke test (passes today)
devices/run-e2e.sh <apk> <flow> --wipe                          # factory-wipe a, re-provision PIN+finger (drops Google account!)
devices/run-e2e.sh <apk> <flow> --headless --run-id ci-001
```

What a run does:
1. Boots any emulator that is not running.
2. Uninstalls the app on both devices and installs the APK on `a`. The flow's `device b` + `install` installs it on b.
3. Runs the flow.
4. Writes `evidence/<run-id>/NN-<serial>-<step>.png` for every tap, assert and passkey step, plus `run.log`, `report.json` and full `logcat-<serial>.txt`.

The `passkey` step handles the system side. It waits for the Credential Manager / Google Password Manager sheet, taps `Continue` / `Create` / `Use passkey` / `Sign in`, and runs `adb emu finger touch 1` when the biometric prompt appears. It falls back to typing PIN `1234` if a PIN prompt shows instead. Standalone: `python3 devices/e2e/passkey_approve.py emulator-5554`.

Why not Maestro: Maestro was evaluated and not installed. Its flows cannot run `adb emu finger touch` in the middle of a flow, a sidecar would fight it for the single UiAutomation connection, and the CLI is about 330 MB on a nearly full disk. The adb + uiautomator harness needs only stdlib Python 3.9 and the SDK. Flow syntax is documented at the top of `e2e/flow.py`.

The full flow is a placeholder until the app ships the testIDs in `e2e/TESTIDS.md`. Its signing steps (follow, close all, withdraw) send **testnet** transactions when someone runs it. The harness never does that by itself.

## 5b. Stage A on the localnet (native app, real passkeys)

```
devices/run-stage-a-android.sh            # builds app/dist/mirror-1.0.0-stagea.apk if missing, then runs
devices/run-stage-a-android.sh --build    # force a rebuild first
```

- APK: `app/scripts/build-apk.sh --stage-a` is a release build (real Mera passkeys, rpId `mirror.0xo.in`, release
  keystore so assetlinks matches, no dev tools / simulator) with API base `http://10.0.2.2:8828`. `MIRROR_LOCAL_CLEARTEXT=1`
  adds `withLocalCleartext` (cleartext only to 10.0.2.2 / localhost / 127.0.0.1); normal release builds never set it.
- The script starts the localnet (anvil :8546, faucet :8547), the engine on :8828 (`E2E_ENGINE_PORT`; must match the APK)
  with `PUBLIC_RPC_URL=http://10.0.2.2:8546`, the team-run demo follower and the website; runs `e2e/flows/stage-a.flow` and `stage-a-g2.flow`; then stops
  the engine, the localnet and mirror-a / mirror-b. It waits while the 1-minute load is above 20.
- Group 2 (`e2e/flows/stage-a-g2.flow`, run after `stage-a.flow` in the same session, `${addr}` carries over):
  alerts on in Settings (one prompt, owner-signed FCM registration), the share card of a Blocked detail (card PNG and
  landing page fetched from the website, the Android share target carries the link), a deposit and resume (Close all
  pauses the follow), FCM with the app in the background (only "Mirror · New activity" in the shade, read with
  `dumpsys notification --noredact`; the Alerts screen decrypts it), take-profit set / triggered by a stranger / halt
  lifted, Pause vs "Stop following, keep my positions" and Follow again, a second leader with a budget split, and a
  friend's take-profit suggestion (direct POST) accepted in the app. Hooks: `localnet/stage-a-hook-g2.mjs` (`${HOOK2}`).
- FCM: the engine reads the Firebase service account from `FCM_SERVICE_ACCOUNT_PATH` (default
  `keys/firebase-adminsdk.json`, a secret: never copied, printed or committed); the APK needs `app/google-services.json`
  at build time. The website (`web/`, `next dev`) runs on :8819 (`STAGEA_SITE_PORT`); the APK's share base is
  `http://10.0.2.2:8819`. The script stops only mirror-a / mirror-b and writes email addresses in text evidence as
  `<google-account>`.
- Chain actions inside the flow (faucet funding of the app's address, demo leader trades with anvil test keys, mark
  moves) go through `localnet/stage-a-hook.mjs` via the flow's `shell ${HOOK} ...` lines.
- Evidence: `evidence/stage-a-android-<timestamp>/` with `report.json` (pass/fail per step and values read),
  `index.html` (contact sheet), screenshots, `run.log`, logcat, engine and localnet logs. Passkey-sheet screenshots
  show the Google account email: do not publish them.
- Restore on mirror-b picks this run's passkey in the picker. The app names each passkey `Mirror account · <YYYY-MM-DD HH:MM>`
  (device local time at creation); the flow records the device time around the create prompt (`${HOOK} devtime`)
  and runs `passkey 120 "^Mirror account · (${t1}|${t2})$"`. Passkeys from builds before this change are all called
  `Mirror account`, and Google Password Manager collapses them into one picker entry.

## 6. What Android emulators cannot prove (not checked yet: Mirror has only run on Android emulators)

- **Real biometric hardware and the class-3 (strong) biometric path.** `emu finger touch` is a simulated HAL. Also check face unlock, under-display sensors and lockout behaviour.
- **Google Password Manager passkey sync outside emulators.** Covers sync latency, the first-time "set up screen lock / GPM PIN" on a new device, and restore on a phone that has never seen the account.
- **OEM and third-party passkey providers.** Samsung Pass, 1Password, Bitwarden, Dashlane and others: whether they support PRF at all, and whether they evaluate it at create time (otherwise Mera needs a second prompt).
- **Hybrid / cross-device QR flow** with a second device over Bluetooth.
- **Real network conditions.** Mobile data, captive portals, high latency and packet loss during a passkey ceremony or a transaction send, and the real Monad RPC from a carrier IP.
- **Play Protect and "install unknown apps" warnings** for the sideloaded APK, which judges are likely to install.
- **Battery and background behaviour.** Doze and App Standby, OEM task killers (Xiaomi, Oppo, Samsung), push delivery while backgrounded, and notification permission prompts on Android 13+.
- **Real display and performance.** Low-end CPUs and Hermes start-up time, 16 KB page-size devices, small screens and font scaling.
- **The Play-signed build**, if distributed through Play: the Play App Signing certificate fingerprint must be in `assetlinks.json`.
