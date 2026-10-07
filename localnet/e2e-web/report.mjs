// Evidence for the web e2e: a screenshot per step, a JSON report with pass/fail per named check, and an
// index.html contact sheet.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const J = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

export function createReport(outDir, meta) {
  mkdirSync(outDir, { recursive: true });
  const report = { ...meta, startedAt: new Date().toISOString(), checks: [], shots: [] };
  let n = 0;

  async function shot(page, label) {
    const file = `${String(++n).padStart(3, "0")}-${label.replace(/[^a-z0-9.-]+/gi, "-").slice(0, 70)}.png`;
    try {
      await page.screenshot({ path: join(outDir, file), timeout: 15_000 });
      report.shots.push({ file, label, viewport: page.viewportSize() });
    } catch (e) {
      report.shots.push({ file: null, label, error: String(e.message).slice(0, 200) });
      return null;
    }
    return file;
  }

  /** Runs one named check: fn returns info (object) or throws. A screenshot is always taken at the end. */
  async function check(name, page, fn, { optional = false, needs = [] } = {}) {
    const missing = needs.filter((k) => api.state[k] === undefined || api.state[k] === null);
    if (missing.length) {
      report.checks.push({ name, ok: false, optional, blocked: true, error: `not run: needs ${missing.join(", ")} from an earlier step` });
      console.log(`${optional ? "SKIP" : "FAIL"}  ${name}  (not run: needs ${missing.join(", ")})`);
      return false;
    }
    const t0 = Date.now();
    const errs0 = api.pageErrors().length;
    let ok = true;
    let info = {};
    try {
      info = (await fn()) ?? {};
      if (info.ok === false) ok = false;
    } catch (e) {
      ok = false;
      info = { error: String(e.message ?? e).split("\n").slice(0, 3).join(" | ").slice(0, 500) };
    }
    const newErrs = api.pageErrors().slice(errs0);
    if (newErrs.length) info.pageErrors = [...new Set(newErrs)].slice(0, 5);
    const file = page ? await shot(page, name) : null;
    const c = { name, ok, optional, ms: Date.now() - t0, screenshot: file, ...info };
    report.checks.push(c);
    console.log(`${ok ? "PASS" : optional ? "SKIP" : "FAIL"}  ${name}${Object.keys(info).length ? "  " + JSON.stringify(info, (_, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 240) : ""}`);
    if (!ok && !optional && process.env.E2E_BAIL === "1") throw Object.assign(new Error(`bail after: ${name}`), { bail: true });
    return ok;
  }

  function note(name, info) {
    report.checks.push({ name, ok: true, ...info, isNote: true });
    console.log(`NOTE  ${name}  ${JSON.stringify(info).slice(0, 200)}`);
  }

  function finish(extra = {}) {
    Object.assign(report, extra, { finishedAt: new Date().toISOString() });
    // Informational notes carry isNote: true; a check's own data may contain any other key (even `note`).
    const real = report.checks.filter((c) => c.isNote !== true);
    report.passed = real.filter((c) => c.ok).length;
    report.failed = real.filter((c) => !c.ok && !c.optional).length;
    writeFileSync(join(outDir, "report.json"), J(report));
    const rows = report.checks
      .map((c) => `<tr class="${c.isNote ? "note" : c.ok ? "ok" : "bad"}"><td>${c.isNote ? "NOTE" : c.ok ? "PASS" : "FAIL"}</td><td>${esc(c.name)}</td><td><code>${esc(JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => !["name", "ok", "screenshot", "optional", "isNote"].includes(k))), (_, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 400))}</code></td><td>${c.screenshot ? `<a href="${c.screenshot}">shot</a>` : ""}</td></tr>`)
      .join("\n");
    const tiles = report.shots
      .filter((s) => s.file)
      .map((s) => `<figure><a href="${s.file}"><img loading="lazy" src="${s.file}"></a><figcaption>${esc(s.file)}<br>${esc(s.label)} · ${s.viewport?.width}x${s.viewport?.height}</figcaption></figure>`)
      .join("\n");
    writeFileSync(
      join(outDir, "index.html"),
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stage A web e2e</title>
<style>:root{color-scheme:light dark}body{font:14px system-ui,sans-serif;margin:16px;background:Canvas;color:CanvasText}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #8884;padding:4px 6px;vertical-align:top}
tr.ok td:first-child{color:#1a7f37;font-weight:600}tr.bad td:first-child{color:#cf222e;font-weight:700}tr.note td:first-child{color:#8888}code{font-size:11px;word-break:break-all}
.grid{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;width:220px}img{width:220px;border:1px solid #8884;border-radius:6px}figcaption{font-size:11px;color:#888}</style>
<h1>Stage A web e2e · ${esc(report.run)}</h1><p>${report.passed} passed, ${report.failed} failed · web ${esc(report.web ?? "")} · engine ${esc(report.engine ?? "")} · ${esc(report.perpl ?? "")}</p>
<table>${rows}</table><h2>Screenshots</h2><div class="grid">${tiles}</div>`,
    );
    return report;
  }

  const api = { report, shot, check, note, finish, pageErrors: () => [], state: {} };
  return api;
}
