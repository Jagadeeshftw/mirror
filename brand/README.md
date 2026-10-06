# Mirror brand kit

All files are rendered from one mark by `python3 brand/src/render.py` (plus `... render.py preview` for the
X preview). The mark is the approved **sail**: a solid triangle and its reflection across a vertical axis,
on the accent. It is the one used in the approved app design (`design/app-proposal`) and in the shipped
app icon (`app/assets/`).

- Colours (from `design/brief.md`): accent `#4B3BFF`, dark-theme accent `#8B7DFF`, ink `#0E0F12`, paper `#F6F6F3`, night `#0A0B0E`.
- Type: Inter (SemiBold for the wordmark).

| File | Use | Size |
|---|---|---|
| `png/logo-1024.png` | Hackathon portal logo (square, full-bleed accent) | 1024×1024 PNG |
| `x/profile-400.png` | X profile picture (mark centred inside the circle crop) | 400×400 PNG |
| `x/banner-1500x500.png` | X header: logo, one-line description, "Built on Monad" in the centre-right safe area | 1500×500 PNG |
| `x/preview-x-profile.png` | Preview of the profile picture and banner on X (desktop dark, phone light, 48/32 px avatars) | 1120×600 PNG |
| `png/logo-light-1024.png`, `png/logo-dark-1024.png` | Mark for light and dark backgrounds | 1024×1024 PNG |
| `png/logo-horizontal-light.png`, `png/logo-horizontal-dark.png` | Mark + wordmark | 840×200 PNG |
| `png/mark-rounded-1024.png` | Rounded-square mark with transparent corners | 1024×1024 PNG |
| `svg/*.svg` | Sources: `mark.svg`, `mark-square.svg`, `glyph-light.svg`, `glyph-dark.svg`, `logo-light.svg`, `logo-dark.svg` (wordmark kept as Inter text), `x-profile-400.svg`, `maskable-512.svg`, Android adaptive foreground and monochrome | vector |
| `icons/favicon.ico` (16/32/48), `icons/favicon-{16,32,48}.png`, `icons/favicon.svg` | Favicon | |
| `icons/icon-192.png`, `icons/icon-512.png`, `icons/maskable-512.png`, `icons/apple-touch-icon-180.png` | PWA and Apple touch icons | |
| `icons/android-adaptive-foreground.png`, `icons/android-adaptive-monochrome.png` | Android adaptive icon layers (background `#4B3BFF`) | 1024×1024 |
| `app/*` | The app's shipped icon assets, exported as-is (`icon-1024`, adaptive foreground/monochrome, notification icon, splash mark) | |

The website currently uses a different mark from the landing proposal (a half-disc and its outlined
reflection, `web/components/logo.tsx`, `web/app/icon.svg`). Aligning the website's logo, favicon and
OG image to the sail mark is pending confirmation.
