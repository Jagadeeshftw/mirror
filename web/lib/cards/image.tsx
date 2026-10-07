/** Renders a CardModel to PNG with next/og. Fonts: Inter (UI) and Geist Mono (numbers), from web/assets/fonts. */
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { renderCard } from "./render";
import { SIZES, type CardFormat, type CardModel, type CardTheme } from "./types";

type FontDef = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };
let fonts: Promise<FontDef[]> | null = null;

function loadFonts(): Promise<FontDef[]> {
  const dir = join(process.cwd(), "assets", "fonts");
  const f = async (file: string, name: string, weight: 400 | 500 | 600): Promise<FontDef> => {
    const b = await readFile(join(dir, file));
    return { name, weight, style: "normal", data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
  };
  fonts ??= Promise.all([
    f("Inter_400Regular.ttf", "Inter", 400),
    f("Inter_500Medium.ttf", "Inter", 500),
    f("Inter_600SemiBold.ttf", "Inter", 600),
    f("GeistMono_400Regular.ttf", "Mono", 400),
    f("GeistMono_500Medium.ttf", "Mono", 500),
  ]).catch((e) => {
    fonts = null;
    throw e;
  });
  return fonts;
}

export async function cardImage(m: CardModel, format: CardFormat, theme: CardTheme): Promise<ImageResponse> {
  const { width, height } = SIZES[format];
  return new ImageResponse(renderCard(m, format, theme), {
    width,
    height,
    fonts: await loadFonts(),
    headers: {
      // A card that could not be read is not cached, so the next view tries the engine again.
      "Cache-Control": m.ok ? "public, max-age=60, s-maxage=300, stale-while-revalidate=600" : "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
