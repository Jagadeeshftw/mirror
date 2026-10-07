// Share cards in the Stage A web run: the website (web/, `next dev` against the localnet engine) renders the card
// images, and the app's share sheet points at it (EXPO_PUBLIC_SHARE_BASE). After the demo blocked trade, the check
// opens the share sheet on the Blocked detail and fetches the card image URL the sheet previews: it must be a PNG,
// and the card's landing page must describe this blocked copy, labelled team-run.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./chain.mjs";
import { click, findCard, tid, until, visible } from "./browser.mjs";

const PNG_SIGNATURE = "89504e470d0a1a0a";

/** Starts `next dev` for web/ on `port` with NEXT_PUBLIC_API_BASE=api; resolves when the site answers. */
export async function startSite({ port, api, logFile }) {
  const log = createWriteStream(logFile);
  const env = { ...process.env, NEXT_PUBLIC_API_BASE: api, NEXT_TELEMETRY_DISABLED: "1", PORT: String(port) };
  const p = spawn("npx", ["next", "dev", "-p", String(port)], { cwd: join(ROOT, "web"), env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.pipe(log);
  p.stderr.pipe(log);
  const stop = () => { try { process.kill(-p.pid, "SIGKILL"); } catch {} };
  try {
    await until("website (next dev) up", async () => (await fetch(`http://localhost:${port}/robots.txt`, { signal: AbortSignal.timeout(5000) })).ok, 120_000, 1000);
  } catch (e) {
    stop();
    throw e;
  }
  return { url: `http://localhost:${port}`, stop };
}

/** The image URL the share sheet previews (react-native-web renders an <img> inside the Image view). */
async function previewSrc(page) {
  const el = page.locator(tid("share.preview.image")).first();
  await el.waitFor({ state: "attached", timeout: 15_000 });
  const src = await el.locator("img").first().getAttribute("src").catch(() => null);
  if (src) return src;
  const bg = await el.evaluate((n) => [n, ...n.querySelectorAll("*")].map((x) => getComputedStyle(x).backgroundImage).find((b) => b && b !== "none") ?? "");
  return (bg.match(/url\("?([^")]+)"?\)/) ?? [])[1] ?? null;
}

export async function shareCardCheck(ctx, { demoFeed, shortHash }) {
  const { R, page, state, site } = ctx;
  await R.check("share card: Blocked detail → share sheet; the card image URL returns a PNG from the site (next dev) on the localnet engine", page, async () => {
    if (!site) throw new Error("website not started");
    const item = (await demoFeed()).filter((i) => i.kind === "Blocked").sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (!item) throw new Error("no Blocked item on the demo follower");
    const card = await until("blocked card", () => findCard(page, "watch.feed.", "Blocked", { contains: shortHash(item.txHash) }), 30_000, 700);
    await card.card.click();
    await visible(page, "blocked.detail", 15_000);
    await click(page, "blocked.share");
    await visible(page, "share.sheet", 15_000);
    const title = await page.locator(tid("share.title")).innerText();
    const src = await until("preview image src", () => previewSrc(page), 20_000, 500);
    const expected = `${site.url}/c/blocked/${item.txHash}/image?a=${item.account}`;
    const res = await fetch(src, { signal: AbortSignal.timeout(90_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const png = buf.subarray(0, 8).toString("hex") === PNG_SIGNATURE;
    const landing = src.replace("/image?", "?").replace(/[?&]t=(light|dark)/, "");
    const html = await (await fetch(landing, { signal: AbortSignal.timeout(90_000) })).text();
    const ogTitle = (html.match(/<meta property="og:title" content="([^"]*)"/) ?? [])[1] ?? null;
    const ogImage = (html.match(/<meta property="og:image" content="([^"]*)"/) ?? [])[1] ?? null;
    const previewFailed = await page.locator(tid("share.preview.unavailable")).count();
    await R.shot(page, "share-sheet-blocked");
    await click(page, "share.close").catch(() => {});
    await click(page, "blocked.done").catch(() => {});
    const ok = res.status === 200 && /image\/png/.test(res.headers.get("content-type") ?? "") && png && buf.length > 10_000 && src.toLowerCase().startsWith(expected.toLowerCase()) && /team-run/i.test(title) && /Team-run demo/.test(ogTitle ?? "") && /Blocked by its rule/.test(ogTitle ?? "") && !!ogImage && previewFailed === 0;
    state.shareCard = ok || null;
    return { ok, title, src, status: res.status, contentType: res.headers.get("content-type"), bytes: buf.length, png, ogTitle, ogImage, previewFailed };
  });
}
