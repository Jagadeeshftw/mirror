#!/usr/bin/env python3
"""Render the Mirror brand kit from one source of truth (the approved sail mark).

Mark geometry is the one in the approved app design (design/app-proposal/build.mjs, brandMark) and the
app icon (app/assets/icon.png): a solid triangle and its reflection at 45% across a vertical axis, on the
brand accent. Colours and type come from design/brief.md (accent #4B3BFF / #8B7DFF, Inter).

Writes SVG sources to brand/svg/, renders PNGs with headless Chrome, builds favicon.ico with Pillow.
Usage: python3 brand/src/render.py
"""
from __future__ import annotations

import pathlib
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
REPO = ROOT.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

ACCENT = "#4B3BFF"
ACCENT_DARK = "#8B7DFF"
INK = "#0E0F12"
PAPER = "#F6F6F3"
NIGHT = "#0A0B0E"
NIGHT_TEXT = "#F2F3F5"
MUTED_DARK = "#9097A3"

ONE_LINER = (
    "Copy the best traders on Perpl with your limits enforced onchain: your own contract checks every "
    "copied order and can trade for you but never withdraw."
)

# Glyph in a 32-unit box: left triangle solid, right triangle is its reflection at 45%.
LEFT = "M15 7.5 6.5 24.5H15z"
RIGHT = "M17 7.5l8.5 17H17z"


def glyph(fill: str, reflect_opacity: float = 0.45, reflect_fill: str | None = None) -> str:
    """Solid triangle plus its reflection. On dark backgrounds the reflection uses the dark-theme accent
    instead of a translucent white, so it keeps the brand colour rather than turning grey."""
    if reflect_fill:
        return f'<path d="{LEFT}" fill="{fill}"/><path d="{RIGHT}" fill="{reflect_fill}"/>'
    return f'<path d="{LEFT}" fill="{fill}"/><path d="{RIGHT}" fill="{fill}" fill-opacity="{reflect_opacity}"/>'


def mark_svg(rounded: bool = True, bg: str = ACCENT, fg: str = "#FFFFFF") -> str:
    rx = ' rx="9"' if rounded else ""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        f'<rect width="32" height="32"{rx} fill="{bg}"/>{glyph(fg)}</svg>'
    )


def glyph_svg(fill: str, reflect_fill: str | None = None) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 7 20 18">{glyph(fill, reflect_fill=reflect_fill)}</svg>'


def scaled_glyph_svg(size: int, scale: float, bg: str | None, fill: str = "#FFFFFF", reflect_fill: str | None = None) -> str:
    """Square canvas with the glyph centred at `scale` of the canvas width (glyph is 19 of 32 units wide)."""
    k = size * scale / 19.0
    tx = size / 2 - 16 * k
    ty = size / 2 - 16 * k
    rect = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'{rect}<g transform="translate({tx:.3f} {ty:.3f}) scale({k:.5f})">{glyph(fill, reflect_fill=reflect_fill)}</g></svg>'
    )


def logo_svg(text_color: str) -> str:
    """Horizontal logo: rounded mark + "Mirror" in Inter SemiBold, outlined to paths (renders the same on
    any machine; no font needed)."""
    from wordmark import outline

    word = outline("Mirror", 44, 29, 26, -0.56)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 168 40">'
        '<g transform="translate(0 4)">'
        f'<rect width="32" height="32" rx="9" fill="{ACCENT}"/>{glyph("#FFFFFF")}</g>'
        f'<path d="{word}" fill="{text_color}"/></svg>'
    )


FONT_LINK = (
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" '
    'href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?'
    'family=Inter:wght@400;500;600;700&display=block" rel="stylesheet">'
)


def page(body: str, w: int, h: int, bg: str = "transparent", extra_css: str = "") -> str:
    return (
        f"<!doctype html><html><head><meta charset='utf-8'>{FONT_LINK}<style>"
        f"html,body{{margin:0;padding:0;width:{w}px;height:{h}px;background:{bg};overflow:hidden}}"
        "body{font-family:Inter,Arial,sans-serif;-webkit-font-smoothing:antialiased}"
        f"{extra_css}</style></head><body>{body}</body></html>"
    )


def chrome_png(html: str, w: int, h: int, out: pathlib.Path) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(html)
        src = f.name
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--window-size={w},{h}",
            "--virtual-time-budget=8000",
            f"--screenshot={out}",
            f"file://{src}",
        ],
        check=True,
        capture_output=True,
    )
    im = Image.open(out)
    if im.size != (w, h):  # Chrome can add a few px of chrome on some versions; crop exactly
        im.crop((0, 0, w, h)).save(out)


def svg_png(svg: str, w: int, h: int, out: pathlib.Path, bg: str = "transparent") -> None:
    chrome_png(page(f'<div style="width:{w}px;height:{h}px">{svg.replace("<svg ", f"<svg width={w} height={h} ", 1)}</div>', w, h, bg), w, h, out)


def banner_html(w: int = 1500, h: int = 500) -> str:
    css = f"""
    .wrap{{position:relative;width:{w}px;height:{h}px;background:{NIGHT};overflow:hidden}}
    .glow{{position:absolute;right:-180px;top:-260px;width:900px;height:900px;border-radius:50%;
      background:radial-gradient(closest-side, rgba(75,59,255,.35), rgba(75,59,255,0) 70%)}}
    .grid{{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
      linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:50px 50px}}
    .ghost{{position:absolute;left:70px;top:70px;width:330px;height:330px;opacity:.07}}
    .content{{position:absolute;left:530px;right:90px;top:0;bottom:0;display:flex;flex-direction:column;
      justify-content:center;gap:22px}}
    .row{{display:flex;align-items:center;gap:18px}}
    .word{{color:{NIGHT_TEXT};font-weight:600;font-size:68px;letter-spacing:-1.8px;line-height:1}}
    .line{{color:#D3D6DC;font-size:32px;line-height:1.34;font-weight:400;max-width:880px;letter-spacing:-.3px}}
    .pill{{align-self:flex-start;display:inline-flex;align-items:center;gap:10px;padding:9px 18px 9px 14px;border-radius:999px;
      border:1px solid rgba(139,125,255,.45);background:rgba(139,125,255,.12);color:{NIGHT_TEXT};font-size:23px;font-weight:500}}
    .dot{{width:9px;height:9px;border-radius:50%;background:{ACCENT_DARK}}}
    """
    mark = mark_svg().replace("<svg ", '<svg width="76" height="76" ', 1)
    ghost = glyph_svg("#FFFFFF").replace("<svg ", '<svg width="330" height="300" ', 1)
    body = (
        f'<div class="wrap"><div class="grid"></div><div class="glow"></div><div class="ghost">{ghost}</div>'
        f'<div class="content"><div class="row">{mark}<span class="word">Mirror</span></div>'
        f'<div class="line">{ONE_LINER}</div>'
        '<span class="pill"><span class="dot"></span>Built on Monad</span></div></div>'
    )
    return page(body, w, h, NIGHT, css)


def main() -> None:
    svg = ROOT / "svg"
    svg.mkdir(exist_ok=True)
    sources = {
        "mark.svg": mark_svg(),
        "mark-square.svg": mark_svg(rounded=False),
        "glyph-light.svg": glyph_svg(ACCENT),
        "glyph-dark.svg": glyph_svg("#FFFFFF", ACCENT_DARK),
        "logo-light.svg": logo_svg(INK),
        "logo-dark.svg": logo_svg(NIGHT_TEXT),
        "android-adaptive-foreground.svg": scaled_glyph_svg(1024, 0.36, None),
        "android-adaptive-monochrome.svg": scaled_glyph_svg(1024, 0.36, None, "#FFFFFF"),
        "maskable-512.svg": scaled_glyph_svg(512, 0.44, ACCENT),
        "x-profile-400.svg": scaled_glyph_svg(400, 0.46, ACCENT),
    }
    for name, s in sources.items():
        (svg / name).write_text(s + "\n")

    png = ROOT / "png"
    # 1. Portal logo: square, full-bleed accent (same as the app icon).
    svg_png(scaled_glyph_svg(1024, 0.6, ACCENT), 1024, 1024, png / "logo-1024.png")
    # 4. Light / dark variants.
    svg_png(scaled_glyph_svg(1024, 0.6, PAPER, ACCENT), 1024, 1024, png / "logo-light-1024.png")
    svg_png(scaled_glyph_svg(1024, 0.6, NIGHT, "#FFFFFF", ACCENT_DARK), 1024, 1024, png / "logo-dark-1024.png")
    svg_png(mark_svg(), 1024, 1024, png / "mark-rounded-1024.png")
    svg_png(logo_svg(INK), 840, 200, png / "logo-horizontal-light.png")
    svg_png(logo_svg(NIGHT_TEXT), 840, 200, png / "logo-horizontal-dark.png")

    # 2-3. X profile picture and banner.
    x = ROOT / "x"
    svg_png(sources["x-profile-400.svg"], 400, 400, x / "profile-400.png")
    chrome_png(banner_html(), 1500, 500, x / "banner-1500x500.png")

    # 5. Icons: favicon, PWA, Apple touch, Android adaptive (matching the shipped app assets).
    ic = ROOT / "icons"
    svg_png(mark_svg(), 512, 512, ic / "icon-512.png")
    svg_png(mark_svg(), 192, 192, ic / "icon-192.png")
    svg_png(sources["maskable-512.svg"], 512, 512, ic / "maskable-512.png")
    svg_png(scaled_glyph_svg(180, 0.6, ACCENT), 180, 180, ic / "apple-touch-icon-180.png")
    for s in (16, 32, 48):
        svg_png(mark_svg(), s * 8, s * 8, ic / f"_fav-{s}.png")
    fav = Image.open(ic / "_fav-48.png").convert("RGBA")
    fav.resize((48, 48), Image.LANCZOS).save(ic / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    for s in (16, 32, 48):
        Image.open(ic / f"_fav-{s}.png").convert("RGBA").resize((s, s), Image.LANCZOS).save(ic / f"favicon-{s}.png")
        (ic / f"_fav-{s}.png").unlink()
    (ic / "favicon.svg").write_text(mark_svg() + "\n")
    svg_png(sources["android-adaptive-foreground.svg"], 1024, 1024, ic / "android-adaptive-foreground.png")
    svg_png(sources["android-adaptive-monochrome.svg"], 1024, 1024, ic / "android-adaptive-monochrome.png")
    print("rendered brand kit into", ROOT)


def preview() -> None:
    """X profile mock: desktop column (600 px) and phone width (390 px), plus avatar at 48/32 px."""
    import base64

    def b64(p: pathlib.Path) -> str:
        return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()

    banner = b64(ROOT / "x" / "banner-1500x500.png")
    avatar = b64(ROOT / "x" / "profile-400.png")

    def profile(w: int, av: int, theme: str) -> str:
        bg, fg, mu, bd = ("#000", "#E7E9EA", "#71767B", "#2F3336") if theme == "dark" else ("#fff", "#0F1419", "#536471", "#EFF3F4")
        bh = round(w / 3)
        return f"""
        <div style="width:{w}px;background:{bg};border:1px solid {bd};border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Inter,Arial,sans-serif">
          <img src="{banner}" style="display:block;width:{w}px;height:{bh}px;object-fit:cover">
          <div style="position:relative;padding:0 16px 16px">
            <img src="{avatar}" style="position:absolute;left:16px;top:-{av//2}px;width:{av}px;height:{av}px;border-radius:50%;border:4px solid {bg}">
            <div style="height:{av//2+12}px"></div>
            <div style="display:flex;justify-content:flex-end;margin-top:-{av//2}px;height:{av//2}px;align-items:flex-start">
              <span style="border:1px solid {mu};color:{fg};border-radius:999px;padding:6px 16px;font-weight:700;font-size:15px">Follow</span></div>
            <div style="color:{fg};font-weight:800;font-size:20px;margin-top:10px">Mirror</div>
            <div style="color:{mu};font-size:15px">@your_handle</div>
            <div style="color:{fg};font-size:15px;line-height:1.35;margin-top:10px">{ONE_LINER} Built on Monad.</div>
          </div>
        </div>"""

    def small(theme: str) -> str:
        bg, fg = ("#000", "#E7E9EA") if theme == "dark" else ("#fff", "#0F1419")
        return f"""<div style="display:flex;gap:14px;align-items:center;background:{bg};padding:12px 16px;border-radius:12px;font-family:-apple-system,Inter,Arial,sans-serif">
          <img src="{avatar}" style="width:48px;height:48px;border-radius:50%">
          <img src="{avatar}" style="width:32px;height:32px;border-radius:50%">
          <span style="color:{fg};font-size:14px">48 px and 32 px (timeline / reply size)</span></div>"""

    label = "font:600 13px Inter,Arial,sans-serif;color:#5B606B;margin:0 0 8px;letter-spacing:.06em;text-transform:uppercase"
    body = f"""
    <div style="display:flex;gap:32px;padding:32px;background:#E8E8E3;align-items:flex-start">
      <div><div style="{label}">Desktop column · 600 px · dark</div>{profile(600, 134, 'dark')}
           <div style="height:16px"></div>{small('dark')}</div>
      <div><div style="{label}">Phone · 390 px · light</div>{profile(390, 80, 'light')}
           <div style="height:16px"></div>{small('light')}</div>
    </div>"""
    chrome_png(page(body, 1120, 600, "#E8E8E3"), 1120, 600, ROOT / "x" / "preview-x-profile.png")


def og_html(w: int = 1200, h: int = 630) -> str:
    """Social share image (same layout as the site's previous OG image, now with the sail mark)."""
    css = f"""
    .og{{width:{w}px;height:{h}px;box-sizing:border-box;background:{PAPER};padding:72px 80px;display:flex;flex-direction:column;
      justify-content:space-between;color:{INK}}}
    .top{{display:flex;align-items:center;gap:18px}}
    .name{{font-size:40px;font-weight:700;letter-spacing:-1px}}
    .tag{{margin-left:12px;font-size:22px;color:{ACCENT};background:#ECEAFF;padding:6px 16px;border-radius:999px}}
    .h{{font-size:76px;font-weight:700;letter-spacing:-3px;line-height:1.04}}
    .sub{{margin-top:28px;font-size:30px;color:#5B606B;max-width:940px;line-height:1.35}}
    .foot{{display:flex;gap:28px;font-size:24px;color:#5B606B}}
    """
    mark = mark_svg().replace("<svg ", '<svg width="56" height="56" ', 1)
    body = (
        f'<div class="og"><div class="top">{mark}<span class="name">Mirror</span><span class="tag">Beta · Android</span></div>'
        '<div style="display:flex;flex-direction:column"><span class="h">Copy the best onchain traders.</span>'
        f'<span class="h" style="color:{ACCENT}">Keep your limits.</span>'
        '<span class="sub">Your own contract on Monad checks your rules on every copied Perpl order. It can trade for you. '
        "It can never withdraw.</span></div>"
        "<div class=\"foot\"><span>Built on Monad</span><span>·</span><span>Trades on Perpl</span><span>·</span>"
        "<span>Balance in AUSD</span><span>·</span><span>Passkeys by Mera</span></div></div>"
    )
    return page(body, w, h, PAPER, css)


def app_and_web_assets() -> None:
    """Everything the app and the site ship, rendered here so brand/ is the single source."""
    app = ROOT / "app"
    svg_png(scaled_glyph_svg(1024, 0.6, ACCENT), 1024, 1024, app / "icon.png")
    svg_png(scaled_glyph_svg(1024, 0.36, None), 1024, 1024, app / "adaptive-foreground.png")
    svg_png(scaled_glyph_svg(1024, 0.36, None, "#FFFFFF"), 1024, 1024, app / "adaptive-monochrome.png")
    svg_png(scaled_glyph_svg(96, 0.78, None, "#FFFFFF"), 96, 96, app / "notification-icon.png")
    svg_png(mark_svg(), 288, 288, app / "splash-mark.png")
    old = app / "icon-1024.png"
    if old.exists():
        old.unlink()
    chrome_png(og_html(), 1200, 630, ROOT / "web" / "opengraph-image.png")


SYNC = {
    # brand file -> shipped location (relative to repo root)
    "app/icon.png": "app/assets/icon.png",
    "app/adaptive-foreground.png": "app/assets/adaptive-foreground.png",
    "app/adaptive-monochrome.png": "app/assets/adaptive-monochrome.png",
    "app/notification-icon.png": "app/assets/notification-icon.png",
    "app/splash-mark.png": "app/assets/splash-mark.png",
    "icons/favicon.ico": "web/app/favicon.ico",
    "icons/favicon.svg": "web/app/icon.svg",
    "icons/apple-touch-icon-180.png": "web/app/apple-icon.png",
    "web/opengraph-image.png": "web/app/opengraph-image.png",
    "icons/icon-192.png": "web/public/icons/icon-192.png",
    "icons/icon-512.png": "web/public/icons/icon-512.png",
    "icons/maskable-512.png": "web/public/icons/maskable-512.png",
}


def sync() -> None:
    import shutil

    for src, dst in SYNC.items():
        d = REPO / dst
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / src, d)
    print("synced", len(SYNC), "files into app/ and web/")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "preview":
        preview()
    elif cmd == "sync":
        sync()
    else:
        main()
        app_and_web_assets()
        preview()
        sync()
