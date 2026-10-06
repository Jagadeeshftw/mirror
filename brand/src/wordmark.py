"""Outline the "Mirror" wordmark from Inter SemiBold at optical size 26 (OFL; instanced from InterVariable) into SVG path data, with GPOS pair kerning.

Matches what Chrome draws for <text font-family="Inter" font-weight="600" font-size=SIZE letter-spacing=LS>.
"""
from __future__ import annotations

import pathlib

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT = pathlib.Path(__file__).resolve().parent / "fonts" / "Inter-SemiBold.ttf"


def _pair_kern(font: TTFont, left: str, right: str) -> int:
    if "GPOS" not in font:
        return 0
    gpos = font["GPOS"].table
    total = 0
    for li in gpos.FeatureList.FeatureRecord:
        if li.FeatureTag != "kern":
            continue
        for idx in li.Feature.LookupListIndex:
            lookup = gpos.LookupList.Lookup[idx]
            for st in lookup.SubTable:
                if st.LookupType == 9:  # extension
                    st = st.ExtSubTable
                if getattr(st, "LookupType", 2) != 2:
                    continue
                cov = st.Coverage.glyphs
                if left not in cov:
                    continue
                if st.Format == 1:
                    ps = st.PairSet[cov.index(left)]
                    for pvr in ps.PairValueRecord:
                        if pvr.SecondGlyph == right and pvr.Value1 is not None:
                            total += getattr(pvr.Value1, "XAdvance", 0) or 0
                            break
                elif st.Format == 2:
                    c1 = st.ClassDef1.classDefs.get(left, 0)
                    c2 = st.ClassDef2.classDefs.get(right, 0)
                    rec = st.Class1Record[c1].Class2Record[c2]
                    if rec.Value1 is not None:
                        total += getattr(rec.Value1, "XAdvance", 0) or 0
            break  # first kern feature record covers the default script
        break
    return total


def outline(text: str, x: float, baseline: float, size: float, letter_spacing: float = 0.0) -> str:
    font = TTFont(FONT)
    upem = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    hmtx = font["hmtx"]
    k = size / upem
    names = [cmap[ord(c)] for c in text]
    pen_x = x
    parts = []
    for i, name in enumerate(names):
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        gs[name].draw(TransformPen(pen, (k, 0, 0, -k, pen_x, baseline)))
        parts.append(pen.getCommands())
        adv = hmtx[name][0]
        if i + 1 < len(names):
            adv += _pair_kern(font, name, names[i + 1])
        pen_x += adv * k + letter_spacing
    return "".join(parts)


if __name__ == "__main__":
    print(outline("Mirror", 44, 29, 26, -0.5)[:200])
