/**
 * Single source of truth for the product name, links and onchain facts used by the site.
 * "Mirror" is a working name: change BRAND here and it updates everywhere.
 */
export const BRAND = "Mirror";
export const DOMAIN = "mirror.0xo.in";
export const SITE_URL = `https://${DOMAIN}`;
export const TAGLINE = "Copy the best onchain traders. Keep your limits.";
export const DESCRIPTION = `${BRAND} copies the best traders on Perpl from your Android phone. Your own contract on Monad checks your limits on every copied order. It can trade for you, never withdraw.`;

/** Internal routes. */
export const DOWNLOAD_URL = "/download";
export const DOCS_URL = "/docs";
export const CONTRACTS_URL = "/docs/contracts";
export const STATS_URL = "/stats";
export const PERPL_URL = "/perpl";

/** Static facts about the Android app. Version, size, SHA-256 and URL come from public/release.json (lib/release.ts). */
export const APK = {
  minAndroid: "Android 9 (API 28)",
  packageName: "com.zeroxo.mirror",
};

/** The Expo web build, exported into public/app by scripts/build-app.sh and served as a SPA under /app. */
export const WEB_APP_URL = "/app";

export const GITHUB_URL = "https://github.com/Jagadeeshftw/mirror";
export const X_HANDLE = "@MirrorOnMonad";
export const X_URL = "https://x.com/MirrorOnMonad";

/** Backend API (engine + relayer). Set NEXT_PUBLIC_API_BASE in Vercel. */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
/** True when API_BASE looks like a real URL rather than the placeholder. */
export const API_CONFIGURED = /^https?:\/\//.test(API_BASE) && !API_BASE.includes("placeholder");

export const BETA_DEPOSIT_CAP = "25 AUSD";
export const MIN_DEPOSIT = "10 AUSD";

export const EXPLORER_TX = "https://monadvision.com/tx/";
export const EXPLORER_ADDRESS = "https://monadvision.com/address/";

/** Mirror contracts on Monad mainnet (chain 143). null until deployed and verified. */
export const CONTRACTS: { name: string; address: string | null; note: string }[] = [
  { name: "MirrorAccountFactory", address: null, note: "Deploys one EIP-1167 clone per (owner, salt)" },
  { name: "MirrorAccount (implementation)", address: null, note: "Shared code of every follower account" },
  { name: "KeeperRegistry", address: null, note: "Addresses allowed to call mirror()" },
  { name: "Perpl Exchange", address: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F", note: "Third party, live" },
  { name: "AUSD (collateral)", address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", note: "Third party, live, 6 decimals" },
];

/** Measured on Monad mainnet on 6 Oct 2026 (node scripts/measure-monad.mjs; fork gas profile). See docs/why-monad. */
export const MEASURED = {
  blockMs: 300,
  finalityAfterProposedMs: 550,
  gasPerCopiedOpen: "278k",
  usdPerCopiedOpen: "$0.001",
  tests: 91,
};
