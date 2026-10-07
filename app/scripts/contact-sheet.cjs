#!/usr/bin/env node
// Builds screenshots/stage-a/index.html (contact sheet) from index.json written by shoot-web.cjs.
const fs = require("node:fs");
const path = require("node:path");
const DIR = path.join(__dirname, "..", "screenshots", "stage-a");
const list = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));
const DESIGN = {
  "watch-home": "phone-watchHome", "watch-running": "phone-watchRun", skeleton: "phone-skel", slow: "phone-slow", "mirror-down": "phone-mirrorDown", "watch-quiet": "phone-watchQuiet",
  "copy-detail": "phone-copyDetail / laptop-feed", "blocked-detail": "phone-blockedEntry", "follow-whatif": "phone-whatIf / laptop-follow", "home-funded": "laptop-home", leaders: "laptop-leaders",
  positions: "laptop-positions", "funded-mirror-down": "phone-errMirror", "monad-down": "phone-errMonad", "settings-network": "phone-settingsNet", welcome: "phone-welcomeFix", feed: "laptop-feed",
};
const states = [...new Set(list.map((x) => x.state))];
const cell = (f) => {
  const x = list.find((y) => y.file === f);
  if (!x) return "<td></td>";
  return `<td><a href="${f}"><img src="${f}" loading="lazy"></a><div>${f}${x.error ? ` <b class="err">${x.error.replace(/</g, "&lt;")}</b>` : ""}</div></td>`;
};
const rows = states.map((s) => `<h2>${s}${DESIGN[s] ? ` <small>design: ${DESIGN[s]}</small>` : ""}</h2><table><tr>${["mobile-light", "mobile-dark", "desktop-light", "desktop-dark"].map((k) => cell(`${s}-${k}.png`)).join("")}</tr></table>`).join("\n");
fs.writeFileSync(path.join(DIR, "index.html"), `<!doctype html><meta charset="utf-8"><title>Mirror stage A screenshots</title>
<style>body{font:14px system-ui;margin:24px;background:#f6f6f3;color:#0e0f12}h2{margin:28px 0 8px;font-size:16px}small{color:#5b606b;font-weight:400}table{border-spacing:12px 0}td{vertical-align:top;font-size:11px;color:#5b606b}img{border:1px solid #e3e3de;border-radius:8px;max-height:420px;display:block}.err{color:#d93a40}</style>
<h1>Mirror 1.0.0 beta · web build against dev-mock · 390 wide and 1440×900, light and dark</h1>
${rows}`);
console.log("wrote", path.join(DIR, "index.html"), states.length, "states");
