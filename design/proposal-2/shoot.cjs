// Renders PNGs of index.html into shots/. Run: PW=<path to playwright package> node shoot.cjs
const path = require('path');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const out = path.join(__dirname, 'shots');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  await page.goto('file://' + path.join(__dirname, 'index.html'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const only = process.env.ONLY || 'all';
  if (only === 'all' || only === 'page') {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log('page height', h);
    try { await page.screenshot({ path: path.join(out, 'page-full-1440.png'), fullPage: true }); console.log('full ok'); }
    catch (e) { console.log('full failed', e.message); }
    const step = 8000;
    for (let y = 0, i = 1; y < h; y += step, i++) {
      await page.screenshot({ path: path.join(out, `page-1440-part${String(i).padStart(2, '0')}.png`), fullPage: true, clip: { x: 0, y, width: 1440, height: Math.min(step, h - y) } });
    }
    console.log('parts ok');
  }
  if (only === 'all' || only === 'frames') {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate(() => document.body.classList.add('shoot'));
    await page.waitForTimeout(500);
    const els = await page.$$('[data-shot]');
    for (const el of els) {
      const name = await el.getAttribute('data-shot');
      await el.scrollIntoViewIfNeeded();
      const target = name.startsWith('phone-') ? el : (await el.$(':scope > *')) || el;
      if (name.startsWith('phone-')) { await target.screenshot({ path: path.join(out, name + '.png') }); continue; }
      const size = name.startsWith('laptop-') ? { width: 1440, height: 900 } : (await target.evaluate((t) => ({ width: t.offsetWidth, height: t.offsetHeight })));
      await page.evaluate((n) => { const t = document.querySelector(`[data-shot="${n}"]`); const c = t.cloneNode(true); c.id = '__shot'; c.removeAttribute('data-shot'); c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;line-height:1.4'; document.body.appendChild(c); }, name);
      await page.setViewportSize(size);
      await page.screenshot({ path: path.join(out, name + '.png') });
      await page.evaluate(() => document.getElementById('__shot').remove());
      await page.setViewportSize({ width: 1600, height: 1000 });
    }
    console.log('frames', els.length);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
