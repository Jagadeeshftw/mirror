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
    flows/mirror-full.flow-> full app flow (placeholder until testIDs land)
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

## 6. What an emulator cannot prove (do a short check on a physical phone)

- **Real biometric hardware and the class-3 (strong) biometric path.** `emu finger touch` is a simulated HAL. Also check face unlock, under-display sensors and lockout behaviour.
- **Google Password Manager passkey sync between real devices.** Covers sync latency, the first-time "set up screen lock / GPM PIN" on a new device, and restore on a phone that has never seen the account.
- **OEM and third-party passkey providers.** Samsung Pass, 1Password, Bitwarden, Dashlane and others: whether they support PRF at all, and whether they evaluate it at create time (otherwise Mera needs a second prompt).
- **Hybrid / cross-device QR flow** with a real second phone over Bluetooth.
- **Real network conditions.** Mobile data, captive portals, high latency and packet loss during a passkey ceremony or a transaction send, and the real Monad RPC from a carrier IP.
- **Play Protect and "install unknown apps" warnings** for the sideloaded APK, which judges are likely to install.
- **Battery and background behaviour.** Doze and App Standby, OEM task killers (Xiaomi, Oppo, Samsung), push delivery while backgrounded, and notification permission prompts on Android 13+.
- **Real display and performance.** Low-end CPUs and Hermes start-up time, 16 KB page-size devices, small screens and font scaling.
- **The Play-signed build**, if distributed through Play: the Play App Signing certificate fingerprint must be in `assetlinks.json`.
