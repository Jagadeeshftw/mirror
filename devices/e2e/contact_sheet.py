#!/usr/bin/env python3
"""Writes <evidence>/index.html: a contact sheet of report.json (pass/fail per step, values read, screenshots).
usage: contact_sheet.py <evidence-dir>"""
import html
import json
import os
import sys


def write_index(evidence):
    rep = json.load(open(os.path.join(evidence, "report.json")))
    out = [f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mirror Android Stage A</title><style>
body{{font:14px system-ui,sans-serif;margin:16px;background:#f6f6f3;color:#111}}
h1{{font-size:20px}} .ok{{color:#0a7a3b}} .bad{{color:#c0262d}}
section{{background:#fff;border-radius:10px;padding:12px 14px;margin:12px 0}}
h2{{font-size:15px;margin:0 0 6px}} code{{font-size:12px;color:#555}}
.shots{{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}}
.shots a{{display:block;width:150px;font-size:10px;color:#666;word-break:break-all;text-decoration:none}}
.shots img{{width:150px;border:1px solid #ddd;border-radius:6px}}
@media (prefers-color-scheme:dark){{body{{background:#0a0b0e;color:#eee}}section{{background:#16181d}}}}
</style><h1>Mirror Android Stage A: <span class="{'ok' if rep['ok'] else 'bad'}">{'PASS' if rep['ok'] else 'FAIL'}</span></h1>
<p><code>{html.escape(str(rep.get('apk')))}</code> · {len(rep['summary'])} steps</p>"""]
    for st in rep["summary"]:
        cmds = [c for c in rep["commands"] if c["step"] == st["step"]]
        out.append(f"<section><h2 class=\"{'ok' if st['ok'] else 'bad'}\">{'✓' if st['ok'] else '✗'} {html.escape(st['step'])}</h2>")
        vals = {}
        for c in cmds:
            vals.update(c.get("values", {}))
            if not c["ok"]:
                out.append(f"<p class=bad><code>{html.escape(c['cmd'])}</code>: {html.escape(c.get('error', ''))}</p>")
        if vals:
            out.append("<p>" + " · ".join(f"<b>{html.escape(k)}</b> {html.escape(str(v))}" for k, v in vals.items()) + "</p>")
        shots = [s for c in cmds for s in c.get("shots", [])]
        out.append("<div class=shots>" + "".join(f'<a href="{s}"><img loading=lazy src="{s}">{html.escape(s)}</a>' for s in shots) + "</div></section>")
    with open(os.path.join(evidence, "index.html"), "w") as f:
        f.write("\n".join(out))


if __name__ == "__main__":
    write_index(sys.argv[1])
