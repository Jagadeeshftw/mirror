// Links the web app manifest and registers the service worker under the base path, so the app is
// installable with scope /app/ on mirror.0xo.in (and / in local dev).
import Constants from "expo-constants";

export function basePath(): string {
  const b = String((Constants.expoConfig as any)?.experiments?.baseUrl ?? "").replace(/\/+$/, "");
  return b;
}

export function installPwa(): void {
  if (typeof document === "undefined") return;
  const base = basePath();
  const link = (rel: string, href: string, extra: Record<string, string> = {}) => {
    if (document.querySelector(`link[rel="${rel}"]`)) return;
    const l = document.createElement("link");
    l.rel = rel;
    l.href = href;
    for (const [k, v] of Object.entries(extra)) l.setAttribute(k, v);
    document.head.appendChild(l);
  };
  link("manifest", `${base}/manifest.webmanifest`);
  link("apple-touch-icon", `${base}/apple-touch-icon.png`);
  link("icon", `${base}/favicon.svg`, { type: "image/svg+xml" });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {});
  }
}
