import type { Metadata } from "next";
import Link from "next/link";
import { IconCheck } from "@tabler/icons-react";
import { SiteHeader } from "@/components/site-header";
import { DownloadActions, NotPublished, ReleaseCard } from "@/components/download/release-card";
import { APK, BETA_DEPOSIT_CAP, BRAND, DOWNLOAD_URL, MIN_DEPOSIT } from "@/lib/site";
import { RELEASE, apkFileName } from "@/lib/release";

export const metadata: Metadata = {
  title: "Download for Android",
  description: `Install the ${BRAND} ${RELEASE.version} beta APK on Android 14+: install steps, requirements and the SHA-256 checksum.`,
  alternates: { canonical: "/download" },
};

const REQUIREMENTS = [
  { title: `${APK.minAndroid} or newer`, text: "Mirror derives your account from your passkey (PRF), which Google Password Manager supports on Android 14 and newer. Tested on Android 15 emulators." },
  { title: "Signed in to a Google account", text: "Your passkey is stored in Google Password Manager, which is on by default, and restores on a new phone." },
  { title: "A screen lock", text: "PIN, pattern, fingerprint or face. Android requires one to create a passkey." },
  { title: `${MIN_DEPOSIT} to ${BETA_DEPOSIT_CAP} on Monad (to copy)`, text: "Only to fund your own account. Browsing leaders and the demo needs nothing. You never need MON for gas." },
];

const STEPS = [
  {
    title: "Download the APK",
    text: "On your Android phone, tap Download APK above. Your browser may warn that this type of file can harm your device; tap Download anyway.",
  },
  {
    title: "Open the file",
    text: `Open it from the download notification, or from Files → Downloads → ${apkFileName()}.`,
  },
  {
    title: "Allow installs from this source",
    text: "Android asks for permission the first time you install an app from your browser. Tap Settings, turn on “Allow from this source”, then press back.",
  },
  {
    title: "Install and open",
    text: "Tap Install, then Open. You can turn “Allow from this source” off again afterwards.",
  },
  {
    title: "Create your account",
    text: "Tap Create account and approve the single fingerprint, face or PIN prompt. That passkey is your account: no seed phrase, no password.",
  },
];

export default function DownloadPage() {
  return (
    <>
      <SiteHeader active={DOWNLOAD_URL} />
      <main id="content" className="flex-1">
        <div className="mx-auto max-w-5xl px-4 py-10 md:px-8 md:py-16">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.3fr_1fr] md:items-start">
            <div>
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.12em] text-brand">Download</p>
              <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-[2.75rem] md:leading-tight">
                {BRAND} for Android
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
                Copy the best traders on Perpl with your limits enforced onchain. The beta is an APK you install directly, outside the
                Play Store.
              </p>

              <DownloadActions />
              <NotPublished />
              <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                New here? Read the{" "}
                <Link href="/docs/quickstart" className="text-brand underline underline-offset-2">
                  quickstart
                </Link>
                . On a laptop, open the web app in your browser instead.
              </p>
            </div>

            <ReleaseCard />
          </div>

          <section aria-labelledby="req-h" className="mt-16">
            <h2 id="req-h" className="text-xl font-semibold tracking-tight">
              Requirements
            </h2>
            <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {REQUIREMENTS.map((r) => (
                <li key={r.title} className="flex gap-3 rounded-2xl border border-border bg-card p-4">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-positive/12 text-positive">
                    <IconCheck className="size-3" stroke={3} aria-hidden />
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{r.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="steps-h" className="mt-16">
            <h2 id="steps-h" className="text-xl font-semibold tracking-tight">
              Install on Android
            </h2>
            <ol className="mt-5 flex flex-col gap-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-4 rounded-2xl border border-border bg-card p-4 md:p-5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft font-mono text-sm font-semibold text-brand">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{s.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="verify-h" className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <h2 id="verify-h" className="text-xl font-semibold tracking-tight">
                Verify the file
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Compare the APK&apos;s SHA-256 with the one published above before installing. On a computer:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-2xl border border-border bg-card p-4 font-mono text-xs">
                <code>{`# macOS
shasum -a 256 ${apkFileName()}
# Linux
sha256sum ${apkFileName()}
# Windows (PowerShell)
Get-FileHash ${apkFileName()} -Algorithm SHA256`}</code>
              </pre>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                The app&apos;s signing certificate is also published in{" "}
                <a href="/.well-known/assetlinks.json" className="font-mono text-brand underline underline-offset-2">
                  /.well-known/assetlinks.json
                </a>
                , which Android checks before it lets the app use passkeys for {"mirror.0xo.in"}.
              </p>
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Before you fund it</h2>
              <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                <li>
                  {BRAND} is beta software. The contracts are unaudited, so deposits are capped at {BETA_DEPOSIT_CAP}{" "}
                  per account.
                </li>
                <li>The keeper can trade within your rules but can never withdraw. Withdrawals always go to you.</li>
                <li>Perpetual futures are leveraged. Copying a trader does not guarantee their results.</li>
                <li>
                  Read the{" "}
                  <Link href="/docs/safety-model" className="text-brand underline underline-offset-2">
                    safety model
                  </Link>{" "}
                  first.
                </li>
              </ul>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
