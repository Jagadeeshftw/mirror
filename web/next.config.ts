import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * The Expo web app is exported into public/app by scripts/build-app.sh (base path /app). Real files under
 * /app (JS bundles, assets) are served as-is; /app and every deep link under /app that is not a file get
 * public/app/index.html (SPA fallback). Paths with a file extension never fall back, so a missing bundle
 * is a 404, not HTML. Without an export, /app shows a "not published yet" page instead of a 404.
 */
const WEB_APP_BUILT = existsSync(join(import.meta.dirname, "public", "app", "index.html"));
const APP_TARGET = WEB_APP_BUILT ? "/app/index.html" : "/web-app-pending";
/** Any path under /app whose last segment has no file extension. */
const APP_DEEP_LINK = "/app/:path((?!.*\\.[A-Za-z0-9]+$).*)";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { unoptimized: true },
  turbopack: {
    root: import.meta.dirname,
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [{ source: "/app", destination: APP_TARGET }],
      // Fallback runs after public files and pages, so existing files under public/app always win.
      fallback: [{ source: APP_DEEP_LINK, destination: APP_TARGET }],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // Android Digital Asset Links for passkeys (rpId mirror.0xo.in). Served as-is, no redirect.
        source: "/.well-known/assetlinks.json",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=300" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        // iOS associated domains, if the file is ever added to public/.well-known (it has no extension).
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        // The web app shell and deep links: always revalidate so a new export is picked up at once.
        source: "/app",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        source: "/app/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        // Metro bundles have a content hash in their file name.
        source: "/app/_expo/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/app/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/app.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
