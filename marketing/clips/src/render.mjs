#!/usr/bin/env node
// Render the board clips: 1080x1350 (4:5), 30 fps, H.264, no audio, loop-friendly (each clip starts and
// ends on the same frame). Terminal clips replay real captured output (captures/*.txt) verbatim; the
// intro uses real app and site screenshots. Usage (from repo root):
//   node marketing/clips/src/render.mjs [day-07|day-08|day-09|day-10 ...]
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const require = createRequire(path.join(repo, "web/package.json"));
const { chromium } = require("playwright");

const W = 1080, H = 1350, FPS = 30;
const cap = (f) => readFileSync(path.join(here, "captures", f), "utf8");
const after = (txt, start) => txt.slice(txt.indexOf(start)).split("\n");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b64 = (p) => "data:image/png;base64," + readFileSync(p).toString("base64");

const SAIL = `<svg width="56" height="56" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#4B3BFF"/><path d="M15 7.5 6.5 24.5H15z" fill="#fff"/><path d="M17 7.5l8.5 17H17z" fill="#fff" fill-opacity=".45"/></svg>`;
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=block" rel="stylesheet">`;

// ------------------------------------------------------------------ terminal clips
function terminalPage({ title, tag, segments, footer, fontSize = 35 }) {
  // segments: [{ cmd, lines: [{ text, kind }] }]; kind: "", "dim", "ok", "bad", "hl"
  const items = [];
  let t = 0.5;
  for (const seg of segments) {
    for (const cmd of seg.cmds ?? [seg.cmd]) {
      const typeDur = Math.min(1.2, 0.3 + cmd.length * 0.012);
      items.push({ type: "cmd", text: cmd, start: t, dur: typeDur });
      t += typeDur + 0.3;
    }
    t += 0.15;
    for (const l of seg.lines) {
      items.push({ type: "line", text: l.text, kind: l.kind ?? "", start: t });
      t += l.kind === "bad" || l.kind === "ok" || l.kind === "hl" ? 0.55 : 0.1;
    }
    t += 0.5;
  }
  const hold = 3.2;
  const total = t + hold + 0.5;
  const rows = items
    .map((it, i) =>
      it.type === "cmd"
        ? `<div class="row cmd" id="r${i}"><span class="ps">$</span> <span class="tx" data-full="${esc(it.text)}"></span><span class="cur"></span></div>`
        : `<div class="row ${it.kind}" id="r${i}">${esc(it.text) || "&nbsp;"}</div>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  html,body{margin:0;width:${W}px;height:${H}px;background:#0A0B0E;overflow:hidden}
  .wrap{position:absolute;inset:0;padding:64px 56px 56px;box-sizing:border-box;display:flex;flex-direction:column;gap:28px}
  .top{display:flex;align-items:center;gap:18px;font-family:Inter,Arial,sans-serif;color:#F2F3F5}
  .top b{font-size:44px;font-weight:600;letter-spacing:-1px}
  .tag{margin-left:auto;font-size:24px;color:#C9C3FF;border:1px solid rgba(139,125,255,.45);background:rgba(139,125,255,.12);padding:8px 18px;border-radius:999px}
  .title{font-family:Inter,Arial,sans-serif;color:#F2F3F5;font-size:46px;font-weight:600;letter-spacing:-1px;line-height:1.15}
  .term{flex:1;background:#14161B;border:1px solid #262A31;border-radius:22px;padding:30px 30px;overflow:hidden;
    font-family:'JetBrains Mono',Menlo,monospace;font-size:${fontSize}px;line-height:1.38;color:#D3D6DC}
  .row{white-space:pre-wrap;word-break:break-word;visibility:hidden;border-radius:8px;padding:0 6px 0 calc(6px + 2ch);text-indent:-2ch;margin:0 -6px}
  .cmd{color:#F2F3F5}.ps{color:#8B7DFF}.dim{color:#7A808C}
  .ok{color:#3DD68C;background:rgba(61,214,140,.10)}.bad{color:#FF8A8E;background:rgba(255,99,105,.12)}.hl{color:#F2F3F5;background:rgba(139,125,255,.18)}
  .cur{display:inline-block;width:19px;height:36px;background:#8B7DFF;vertical-align:-4px;margin-left:2px}
  .foot{font-family:'JetBrains Mono',Menlo,monospace;font-size:27px;color:#8D93A0}
  #fade{position:absolute;inset:0;background:#0A0B0E;opacity:0;pointer-events:none}
  </style></head><body><div class="wrap">
  <div class="top">${SAIL}<b>Mirror</b><span class="tag">${esc(tag)}</span></div>
  <div class="title">${esc(title)}</div>
  <div class="term" id="term"><div id="rows">${rows}</div></div>
  <div class="foot">${esc(footer)}</div></div><div id="fade"></div>
  <script>
  const items=${JSON.stringify(items)}; const total=${total};
  window.render=(t)=>{
    items.forEach((it,i)=>{const el=document.getElementById('r'+i); const on=t>=it.start; el.style.visibility=on?'visible':'hidden';
      if(it.type==='cmd'){const tx=el.querySelector('.tx'); const n=on?Math.min(it.text.length,Math.floor((t-it.start)/it.dur*it.text.length)):0; tx.textContent=it.text.slice(0,n);
        el.querySelector('.cur').style.visibility=(on && n<it.text.length)?'visible':'hidden';}});
    const term=document.getElementById('term'); // keep the newest line in view
    term.scrollTop=term.scrollHeight;
    // Loop seam: only the terminal text fades out; the frame matches t=0 (empty terminal) exactly.
    const end=total-1/${FPS}; document.getElementById('rows').style.opacity=t>end-0.5?String(Math.max(0,1-(t-(end-0.5))/0.5)):'1';
  };
  </script></body></html>`;
  return { html, duration: total };
}

function forkLines() {
  const L = after(cap("day08-fork.txt"), "Ran 1 test");
  const keep = /^\[PASS\]|BLOCKED|FILLED|REVERTED|Suite result/;
  return L.filter((l) => keep.test(l.trim())).map((l) => l.replace(/^  /, "")).map((text) => ({
    text,
    kind: /BLOCKED/.test(text) ? "bad" : /FILLED|^\[PASS\]|Suite result: ok/.test(text) ? "ok" : /REVERTED/.test(text) ? "hl" : /^Ran |Logs:/.test(text) ? "dim" : "",
  }));
}

function invariantLines() {
  const txt = cap("day09-invariants.txt");
  const L = txt.split("\n").filter((l) => /^\[PASS\]|^Suite result/.test(l));
  return L.map((text) => ({
    text,
    kind: /keeperNeverReceivesCollateral|hostileCallsAlwaysFail|onlyOwnerChangesPolicy/.test(text) ? "ok" : /^Ran/.test(text) ? "dim" : /Suite result/.test(text) ? "hl" : "",
  }));
}

function measureLines() {
  return cap("day10-measure.txt").split("\n").filter((l) => l && !l.startsWith("sampling")).map((text) => ({
    text,
    kind: /block time|finalized after/.test(text) ? "ok" : /sampling/.test(text) ? "dim" : "",
  }));
}

function gasLines() {
  const L = after(cap("day10-gas.txt"), "Ran 1 test");
  return L.filter((l) => /\[PASS\]|gas used by one copied open/.test(l)).map((text) => ({ text, kind: /gas used/.test(text) ? "ok" : "" }));
}

const FOOT = "github.com/Jagadeeshftw/mirror";
const CLIPS = {
  "day-08": () =>
    terminalPage({
      title: "Blocked by your rule, then a real fill on Perpl. Mainnet fork.",
      tag: "forge test",
      footer: FOOT,
      segments: [
        {
          cmds: ["export MONAD_RPC_URL=https://rpc.monad.xyz", "forge test --mc PerplMainnetFork --mt test_fork_fullLifecycleAgainstLivePerpl -vv"],
          lines: forkLines(),
        },
      ],
    }),
  "day-09": () =>
    terminalPage({
      title: "The keeper can trade. It can never withdraw. 8 invariants.",
      tag: "forge test",
      footer: FOOT,
      fontSize: 31,
      segments: [{ cmd: "forge test --mc MirrorInvariantTest -vv", lines: invariantLines() }],
    }),
  "day-10": () =>
    terminalPage({
      title: "Measured on Monad mainnet.",
      tag: "6 Oct 2026",
      footer: FOOT,
      segments: [
        { cmd: "node scripts/measure-monad.mjs", lines: measureLines() },
        {
          cmds: ["export MONAD_RPC_URL=https://rpc.monad.xyz", "forge test --mc PerplMainnetFork --mt test_fork_keeperCopyGasProfile -vv"],
          lines: gasLines(),
        },
      ],
    }),
  "day-07": () => introPage(),
};

// ------------------------------------------------------------------ intro (real screens)
function introPage() {
  const shot = (p) => b64(path.join(repo, p));
  const slides = [
    { img: "app/screenshots/light/05-leaderboard.png", cap: "Copy the best traders on Perpl." },
    { img: "app/screenshots/light/07-follow-match-now.png", cap: "Set your limits once. Match the leader now." },
    { img: "app/screenshots/dark/09-blocked-detail.png", cap: "Break a rule and the copy is blocked onchain." },
    { img: "app/screenshots/dark/11-account-controls.png", cap: "It can trade for you. It can never withdraw." },
  ].filter((s) => existsSync(path.join(repo, s.img)));
  const per = 2.6, fade = 0.35;
  const total = slides.length * per;
  const html = `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  html,body{margin:0;width:${W}px;height:${H}px;background:#0A0B0E;overflow:hidden;font-family:Inter,Arial,sans-serif}
  .top{position:absolute;left:56px;right:56px;top:56px;display:flex;align-items:center;gap:18px;color:#F2F3F5}
  .top b{font-size:44px;font-weight:600;letter-spacing:-1px}
  .tag{margin-left:auto;font-size:22px;color:#C9C3FF;border:1px solid rgba(139,125,255,.45);background:rgba(139,125,255,.12);padding:8px 16px;border-radius:999px}
  .slide{position:absolute;inset:0;opacity:0}
  .cap{position:absolute;left:56px;right:56px;top:150px;color:#F2F3F5;font-size:50px;font-weight:600;letter-spacing:-1.2px;line-height:1.12}
  .phone{position:absolute;left:50%;top:290px;transform:translateX(-50%);width:410px;border-radius:44px;border:10px solid #23262D;overflow:hidden;background:#000;box-shadow:0 30px 80px rgba(75,59,255,.25)}
  .phone img{display:block;width:100%}
  .note{position:absolute;left:0;right:0;bottom:30px;text-align:center;color:#7A808C;font-size:22px}
  </style></head><body>
  <div class="top">${SAIL}<b>Mirror</b><span class="tag">Built on Monad</span></div>
  ${slides.map((s, i) => `<div class="slide" id="s${i}"><div class="cap">${esc(s.cap)}</div><div class="phone"><img src="${shot(s.img)}"></div></div>`).join("")}
  <div class="note">Android app preview with test data · github.com/Jagadeeshftw/mirror</div>
  <script>
  const n=${slides.length}, per=${per}, fade=${fade}, total=${total};
  window.render=(t)=>{ for(let i=0;i<n;i++){ const el=document.getElementById('s'+i); const s=i*per; let o=0;
      const local=((t-s)%total+total)%total;
      if(local<per) o = local<fade ? local/fade : (local>per-fade ? (per-local)/fade : 1);
      if(i===0 && t<fade) o=1;                               // loop start: first slide already showing
      const end=total-1/${FPS};
      if(i===n-1 && t>end-fade) o=Math.max(0,(end-t)/fade);  // loop end: last slide fully out on the final frame
      if(i===0 && t>end-fade) o=Math.min(1,(t-(end-fade))/fade); // and the first slide fully in
      el.style.opacity=String(Math.max(0,Math.min(1,o))); } };
  </script></body></html>`;
  return { html, duration: total };
}

// ------------------------------------------------------------------ encode
async function renderClip(browser, name) {
  const { html, duration } = CLIPS[name]();
  const out = path.join(repo, "marketing/clips", `${name}-${{ "day-07": "intro", "day-08": "blocked-by-your-rule", "day-09": "keeper-cannot-withdraw", "day-10": "why-monad" }[name]}.mp4`);
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const frames = Math.round(duration * FPS);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-an",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  await page.close();
  console.log(name, out, duration.toFixed(2) + "s");
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS);
const browser = await chromium.launch();
for (const n of wanted) await renderClip(browser, n);
await browser.close();
