import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { unoptimized: true },
  turbopack: {
    root: import.meta.dirname,
  },
  async headers() {
    return [
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
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
