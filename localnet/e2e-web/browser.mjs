// Playwright helpers: a Chrome page with a CDP virtual authenticator (ctap2, internal, resident keys, UV, PRF),
// a WebAuthn call log injected before the app loads, and testID selectors (data-testid on web).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PW = process.env.PLAYWRIGHT ?? "/Users/jagadeesh/.npm/_npx/6bcb61ec6d5aea22/node_modules/playwright";
export const { chromium } = require(PW);

export const PHONE = { width: 390, height: 844 };
export const LAPTOP = { width: 1440, height: 900 };
export const tid = (id) => `[data-testid="${id}"]`;

export const AUTHENTICATOR = {
  protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
  hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true,
};

// Counts navigator.credentials ceremonies and records which PRF outputs came back (never the values).
const WEBAUTHN_LOG = () => {
  const C = globalThis.CredentialsContainer?.prototype;
  if (!C || C.__mirrorLogged) return;
  C.__mirrorLogged = true;
  globalThis.__webauthn = [];
  for (const op of ["create", "get"]) {
    const orig = C[op];
    C[op] = async function (options) {
      const ev = options?.publicKey?.extensions?.prf?.eval;
      const rec = { op, t: Date.now(), askedFirst: !!ev?.first, askedSecond: !!ev?.second, rpId: options?.publicKey?.rp?.id ?? options?.publicKey?.rpId ?? null };
      globalThis.__webauthn.push(rec);
      try {
        const cred = await orig.call(this, options);
        const r = cred?.getClientExtensionResults?.()?.prf;
        rec.gotFirst = !!r?.results?.first;
        rec.gotSecond = !!r?.results?.second;
        rec.ok = true;
        return cred;
      } catch (e) {
        rec.ok = false;
        rec.error = String(e?.name ?? e);
        throw e;
      }
    };
  }
};

/** A new context + page at `viewport` with its own virtual authenticator. */
export async function openDevice(browser, viewport, { credential, serviceWorkers = "block" } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "light", serviceWorkers });
  await context.addInitScript(WEBAUTHN_LOG);
  const page = await context.newPage();
  const consoleLog = [];
  const seen = new Set();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleLog.push(`${m.type()}: ${m.text()}`.slice(0, 400)); });
  page.on("pageerror", (e) => { consoleLog.push(`pageerror: ${String(e.message).slice(0, 400)}`); const m = String(e.message).split("\n")[0].slice(0, 300); if (!seen.has(m)) { seen.add(m); console.log(`  [page error, first time] ${m}`); } });
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTHENTICATOR });
  if (credential) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  const credentials = async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
  const webauthnLog = () => page.evaluate(() => globalThis.__webauthn ?? []);
  return { context, page, cdp, authenticatorId, credentials, webauthnLog, consoleLog };
}

export async function text(page, id, timeout = 15_000) {
  const el = page.locator(tid(id)).first();
  await el.waitFor({ state: "visible", timeout });
  return (await el.innerText()).trim();
}

export async function click(page, id, timeout = 15_000) {
  const el = page.locator(tid(id)).first();
  await el.waitFor({ state: "visible", timeout });
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ timeout });
}

export async function visible(page, id, timeout = 15_000) {
  await page.locator(tid(id)).first().waitFor({ state: "visible", timeout });
  return true;
}

export const isVisible = (page, id) => page.locator(tid(id)).first().isVisible().catch(() => false);

/** Polls until fn() is truthy (fn may throw); returns its value. */
export async function until(label, fn, timeoutMs = 45_000, every = 500) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`timed out: ${label}${last instanceof Error ? ` (${last.message.split("\n")[0]})` : ""}`);
}

/** The first `${prefix}<n>` card whose `.type` text matches `type` (Copy / Close / Blocked), scanning n = 0..max. */
export async function findCard(page, prefix, type, { max = 12, contains } = {}) {
  for (let i = 0; i < max; i++) {
    const card = page.locator(tid(`${prefix}${i}`)).first();
    if (!(await card.count())) continue;
    const body = await card.innerText().catch(() => "");
    // Team-run cards show the Team-run badge instead of the type label; classify those by their content.
    let t = (await page.locator(tid(`${prefix}${i}.type`)).first().innerText({ timeout: 500 }).catch(() => "")).trim();
    if (!t) t = /Not copied/.test(body) ? "Blocked" : /\bClose\b/.test(body) ? "Close" : /\bOpen\b/.test(body) ? "Copy" : "";
    if (t.toLowerCase() !== type.toLowerCase()) continue;
    if (contains && !body.includes(contains)) continue;
    return { index: i, id: `${prefix}${i}`, card };
  }
  return null;
}

/** Disables CSS animations so screenshots are stable. */
export const calm = (page) => page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" }).catch(() => {});
