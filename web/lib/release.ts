/**
 * APK release metadata from public/release.json (also served at /release.json).
 * Read at build time, so redeploy after publishing a release. The download button only appears when
 * `available` is true AND url, size and a 64-hex SHA-256 are all present; otherwise the page shows
 * the "not yet published" state. Shape:
 *   { available, version, channel, versionCode, size (bytes), sha256, url, date (YYYY-MM-DD) }
 */
import raw from "@/public/release.json";

type RawRelease = {
  available?: boolean;
  version?: string;
  channel?: string | null;
  versionCode?: number | null;
  size?: number | null;
  sha256?: string | null;
  url?: string | null;
  date?: string | null;
};

const r = raw as RawRelease;
const sha = typeof r.sha256 === "string" && /^[0-9a-f]{64}$/i.test(r.sha256) ? r.sha256.toLowerCase() : null;
const size = typeof r.size === "number" && r.size > 0 ? r.size : null;
const url = typeof r.url === "string" && r.url ? r.url : null;

export const RELEASE = {
  available: r.available === true && !!sha && !!size && !!url,
  version: r.version ?? "1.0.0",
  channel: r.channel ?? "beta",
  versionCode: typeof r.versionCode === "number" ? r.versionCode : null,
  size,
  sha256: sha,
  url,
  date: typeof r.date === "string" && r.date ? r.date : null,
};

/** "1.0.0 (beta)" plus " · build 100" when the version code is known. */
export const versionLabel = () =>
  `${RELEASE.version}${RELEASE.channel ? ` (${RELEASE.channel})` : ""}${RELEASE.versionCode !== null ? ` · build ${RELEASE.versionCode}` : ""}`;

/** Binary megabytes, labelled MB like Android's file manager: 61,132,288 bytes -> "58.3 MB". */
export const sizeShort = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
export const sizeLong = (b: number) => `${sizeShort(b)} (${b.toLocaleString("en-US")} bytes)`;

/** "9c1e 4f7a …" groups of four, as in the design. */
export const shaGroups = (h: string) => h.match(/.{1,4}/g)?.join(" ") ?? h;

export const dateLabel = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : d;
};

export const apkFileName = () => (RELEASE.url ? RELEASE.url.split("/").pop() || "mirror.apk" : `mirror-${RELEASE.version}.apk`);
