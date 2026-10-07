import React from "react";
import { IconBrandAndroid, IconDownload, IconWorld } from "@tabler/icons-react";
import { APK, BRAND, WEB_APP_URL } from "@/lib/site";
import { RELEASE, apkFileName, dateLabel, shaGroups, sizeLong, sizeShort, versionLabel } from "@/lib/release";
import { CopyHash } from "./copy-hash";

const PENDING = "published with the release";

/** Primary actions: Download APK (or the "not yet published" state) and Open web app. */
export const DownloadActions = () => (
  <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
    {RELEASE.available && RELEASE.url && RELEASE.size ? (
      <a
        href={RELEASE.url}
        download={apkFileName()}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-[15px] font-medium text-primary-foreground shadow-brand hover:bg-primary/90"
      >
        <IconDownload className="size-5" aria-hidden /> Download APK · {sizeShort(RELEASE.size)}
      </a>
    ) : (
      <span
        aria-disabled="true"
        className="inline-flex h-12 cursor-not-allowed items-center justify-center gap-2 rounded-full border border-border bg-muted px-6 text-[15px] font-medium text-muted-foreground"
      >
        <IconBrandAndroid className="size-5" aria-hidden /> APK not yet published
      </span>
    )}
    <a
      href={WEB_APP_URL}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border bg-card px-6 text-[15px] font-medium hover:bg-muted"
    >
      <IconWorld className="size-5" aria-hidden /> Open web app
    </a>
  </div>
);

export const NotPublished = () =>
  RELEASE.available ? null : (
    <p className="mt-4 max-w-xl rounded-2xl border border-warning/40 bg-warning/[0.06] px-4 py-3 text-sm text-foreground">
      {BRAND} {RELEASE.version} ({RELEASE.channel}) is not published yet. The download, its size and its SHA-256 appear here
      as soon as the signed build is released. You can open the web app in your browser meanwhile.
    </p>
  );

/** Version, date, size, package, requirements and SHA-256 of the APK, from public/release.json. */
export const ReleaseCard = () => (
  <div className="flex flex-col gap-4">
    <dl className="rounded-3xl border border-border bg-card p-5 text-sm md:p-6">
      <Row k="Version" v={versionLabel()} mono />
      <Row k="Published" v={RELEASE.date ? dateLabel(RELEASE.date) : "not yet"} mono />
      <Row k="Size" v={RELEASE.size ? sizeLong(RELEASE.size) : PENDING} mono={!!RELEASE.size} />
      <Row k="Package" v={APK.packageName} mono />
      <Row k="Requires" v={`${APK.minAndroid}+`} mono />
      <div className="pt-3">
        <dt className="text-muted-foreground">SHA-256</dt>
        <dd className="mt-1">
          {RELEASE.sha256 ? (
            <>
              <code className="block break-words font-mono text-xs leading-relaxed text-foreground">{shaGroups(RELEASE.sha256)}</code>
              <CopyHash value={RELEASE.sha256} />
            </>
          ) : (
            <span className="text-foreground">{PENDING}</span>
          )}
        </dd>
      </div>
    </dl>
    <div className="rounded-3xl border border-border bg-card p-5 text-sm md:p-6">
      <p className="font-semibold text-foreground">Check the file</p>
      <pre className="mt-3 overflow-x-auto rounded-xl bg-muted px-3 py-2 font-mono text-xs">
        <code>sha256sum {apkFileName()}</code>
      </pre>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        The output must match the hash above. The signing certificate fingerprint is in{" "}
        <a href="/.well-known/assetlinks.json" className="font-mono text-brand underline underline-offset-2">
          assetlinks.json
        </a>
        .
      </p>
    </div>
  </div>
);

const Row = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-border py-3 first:pt-0">
    <dt className="shrink-0 text-muted-foreground">{k}</dt>
    <dd className={mono ? "text-right font-mono text-xs text-foreground" : "text-right text-foreground"}>{v}</dd>
  </div>
);
