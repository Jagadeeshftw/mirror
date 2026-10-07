#!/usr/bin/env python3
"""Tiny line-based flow runner for Mirror device tests (adb + uiautomator).

usage: flow.py <flow-file> --apk APK --evidence DIR [--device a=emulator-5554] [--device b=emulator-5556]

Flow syntax (one command per line, '#' comments, blank lines ignored):
  device <alias|serial>         switch the active device (aliases from --device)
  install | uninstall | clear   APK / app data on the active device
  launch | stop                 start / force-stop the app
  tap <sel>                     wait for and tap a node
  tapIfPresent <sel>            tap if visible within 3s, else continue
  waitFor <sel> [secs]          wait until visible (default 30s)
  waitGone <sel> [secs]
  assertText <sel> <regex>      node text must match regex
  input <sel> <text...>         tap a field and type text
  scrollTo <sel> [up]           swipe (500 px) until visible inside the content area (max 14 swipes)
  passkey [secs] [choose-regex] approve the system passkey sheet (tap Continue/..., emu finger touch);
                                with choose-regex, first tap the matching entry in the account picker
  passkeyExpectFail             same, but the step passes if the sheet ends in an error
  key <KEYCODE> | back | home | sleep <secs> | screenshot <name> | log <text...>
  expectResult <sel> <regex> [secs]   wait for a node whose text matches regex
  step <title...>               start a named step (report.json groups commands; pass/fail per step)
  readText <sel> <var> [regex] [secs]  store the node text (or regex group 1) in ${var}; waits for a match
  squash <var>                  remove whitespace from ${var} (e.g. the grouped wallet address)
  assertVar <var> <regex>       ${var} must match regex (regex may contain ${other})
  shell <cmd...>                run a host command (sh -c); ${var} substituted; non-zero exit fails;
                                stdout lines "VAR name=value" set ${name}
  open <path>                   deep link mirror://<path> on the active device (e.g. /funds)
  tapAt <sel> <fx> <fy>         tap a point inside the node's bounds (fractions 0..1, e.g. a slider end)
  swipeUp                       one upward swipe (scroll)
  retry <n> <pause> <cmd> ;; <cmd> ...  run the commands; on a failure wait <pause> s and start over (n tries)

${name} is replaced in every line before it is parsed (environment variables work too).
Every step saves a screenshot to the evidence dir; at the end report.json and index.html are written.

Selectors: idtext:<id-regex>~<subtree-text-regex>  id:<testID>  text:<exact>  text~:<regex>  desc:<exact>  desc~:<regex>  (bare = text)
Lines are split with shlex: quote any selector or text that contains spaces or backslashes.
"""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from device import Device, SDK  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Commands that take their own screenshot or change nothing visible.
NO_SHOT = {"tap", "assertText", "expectResult", "passkey", "passkeyExpectFail", "screenshot", "log", "sleep",
           "device", "step", "squash", "assertVar", "stop", "uninstall", "install", "clear"}


def apk_package(apk: str) -> str:
    aapt = os.path.join(SDK, "build-tools")
    vers = sorted(os.listdir(aapt))
    out = subprocess.run([os.path.join(aapt, vers[-1], "aapt2"), "dump", "badging", apk],
                         capture_output=True, text=True).stdout
    return re.search(r"package: name='([^']+)'", out).group(1)


class Runner:
    def __init__(self, apk, evidence, devices):
        self.apk = apk
        self.pkg = os.environ.get("APP_ID") or (apk_package(apk) if apk else "com.zeroxo.mirror")
        self.evidence = evidence
        self.aliases = devices
        self.devs = {}
        self.report = []
        self.d = None
        self.vars = dict(os.environ)
        self.cur_step = "setup"
        self.extra = {}
        self.log_f = open(os.path.join(evidence, "run.log"), "a")

    def log(self, msg):
        line = f"{time.strftime('%H:%M:%S')} {msg}"
        print(line, flush=True)
        self.log_f.write(line + "\n")
        self.log_f.flush()

    def use(self, name):
        serial = self.aliases.get(name, name)
        if serial not in self.devs:
            dev = Device(serial, self.evidence, log=self.log)
            dev.wait_boot()
            dev.unlock()
            self.devs[serial] = dev
        self.d = self.devs[serial]

    def subst(self, raw):
        def rep(m):
            k = m.group(1)
            if k not in self.vars:
                raise KeyError(f"unset variable ${{{k}}}")
            return self.vars[k]
        return re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", rep, raw)

    def step(self, n, raw):
        if raw.split(None, 1)[0] in ("step", "log"):  # free text: no shlex (apostrophes)
            parts = self.subst(raw).split()
        else:
            parts = shlex.split(self.subst(raw))
        cmd, args = parts[0], parts[1:]
        d = self.d
        if cmd == "device":
            self.use(args[0]); return
        if d is None:
            self.use(next(iter(self.aliases), "emulator-5554")); d = self.d
        if cmd == "install":
            for attempt in range(3):  # right after boot the package manager can refuse with an empty error
                try:
                    d.adb("install", "-r", "-g", self.apk, timeout=300); break
                except RuntimeError as e:
                    self.log(f"  install failed ({e}); uninstall + retry")
                    d.adb("uninstall", self.pkg, check=False); time.sleep(5)
            else:
                raise RuntimeError("install failed 3 times")
        elif cmd == "uninstall":
            d.adb("uninstall", self.pkg, check=False)
        elif cmd == "clear":
            d.sh(f"pm clear {self.pkg}")
        elif cmd == "launch":
            d.sh(f"monkey -p {self.pkg} -c android.intent.category.LAUNCHER 1")
            time.sleep(2)
        elif cmd == "stop":
            d.sh(f"am force-stop {self.pkg}")
        elif cmd == "tap":
            d.tap(args[0], timeout=float(args[1]) if len(args) > 1 else 30)
            time.sleep(0.6); d.screenshot(f"s{n}-tap-{args[0]}")
        elif cmd == "tapIfPresent":
            try:
                d.tap(args[0], timeout=3)
            except TimeoutError:
                self.log(f"  (not present: {args[0]})")
        elif cmd == "waitFor":
            d.wait_for(args[0], float(args[1]) if len(args) > 1 else 30)
        elif cmd == "waitGone":
            d.wait_for(args[0], float(args[1]) if len(args) > 1 else 30, gone=True)
        elif cmd in ("assertText", "expectResult"):
            sel, rx = args[0], args[1]
            secs = float(args[2]) if len(args) > 2 else (5 if cmd == "assertText" else 60)
            t0 = time.time(); txt = None
            while time.time() - t0 < secs:
                node = d.find(sel)
                txt = (node.text or node.desc or node.alltext) if node else None
                if txt is not None and re.search(rx, txt):
                    break
                time.sleep(1)
            else:
                d.screenshot(f"s{n}-assert-FAILED")
                raise AssertionError(f"{sel} text {txt!r} !~ /{rx}/")
            self.log(f"  {sel} = {txt!r}")
            d.screenshot(f"s{n}-{cmd}")
        elif cmd == "input":
            d.tap(args[0]); d.type_text(" ".join(args[1:])); time.sleep(0.5)
        elif cmd == "scrollTo":
            up = len(args) > 1 and args[1] == "up"  # scrollTo <sel> [up]: content moves down (back to the top)
            for _ in range(14):
                n = d.find(args[0])
                if n and n.bounds[3] < 2150 and n.bounds[1] > 300:
                    break
                d.sh("input swipe 540 1000 540 1500 400" if up else "input swipe 540 1500 540 1000 400"); time.sleep(0.9)
            d.wait_for(args[0], 3)
        elif cmd in ("passkey", "passkeyExpectFail"):
            res = d.approve_passkey(timeout=float(args[0]) if args else 90, choose=args[1] if len(args) > 1 else None)
            self.log(f"  passkey -> {res}")
            d.screenshot(f"s{n}-after-passkey")
            if cmd == "passkey" and not res.get("ok"):
                raise AssertionError(f"passkey approval failed: {res}")
        elif cmd == "key":
            d.key(args[0])
        elif cmd == "back":
            d.key("KEYCODE_BACK")
        elif cmd == "home":
            d.key("KEYCODE_HOME")
        elif cmd == "sleep":
            time.sleep(float(args[0]))
        elif cmd == "screenshot":
            d.screenshot(args[0])
        elif cmd == "step":
            self.cur_step = raw.split(None, 1)[1]
        elif cmd == "readText":
            sel, var = args[0], args[1]
            rx = args[2] if len(args) > 2 else None
            secs = float(args[3]) if len(args) > 3 else 30
            t0 = time.time(); txt = None
            while True:
                node = d.find(sel)
                txt = (node.text or node.desc or node.alltext) if node else None
                m = re.search(rx, txt) if (txt is not None and rx) else None
                if txt is not None and (rx is None or m):
                    val = (m.group(1) if m and m.groups() else m.group(0)) if rx else txt
                    break
                if time.time() - t0 > secs:
                    raise AssertionError(f"readText {sel}: {txt!r} !~ /{rx}/")
                time.sleep(1)
            self.vars[var] = val
            self.extra.setdefault("values", {})[var] = val
            self.log(f"  {var} = {val!r}")
        elif cmd == "squash":
            self.vars[args[0]] = re.sub(r"\s+", "", self.vars[args[0]])
            self.extra.setdefault("values", {})[args[0]] = self.vars[args[0]]
        elif cmd == "assertVar":
            val = self.vars.get(args[0])
            if val is None or not re.search(args[1], val):
                raise AssertionError(f"${{{args[0]}}} = {val!r} !~ /{args[1]}/")
            self.extra.setdefault("values", {})[args[0]] = val
            self.log(f"  {args[0]} = {val!r} ~ /{args[1]}/")
        elif cmd == "shell":
            line = self.subst(raw).split(None, 1)[1]
            self.log(f"  $ {line}")
            p = subprocess.run(["sh", "-c", line], capture_output=True, text=True, timeout=300)
            out = (p.stdout or "").strip()
            for l in out.splitlines():
                mm = re.match(r"^VAR ([A-Za-z_][A-Za-z0-9_]*)=(.*)$", l)
                if mm:
                    self.vars[mm.group(1)] = mm.group(2)
                    self.extra.setdefault("values", {})[mm.group(1)] = mm.group(2)
            if out:
                self.log("  > " + out[-800:].replace("\n", "\n  > "))
            self.extra.setdefault("shell", []).append(out[-1500:])
            if p.returncode != 0:
                raise AssertionError(f"shell exit {p.returncode}: {(p.stderr or out)[-500:]}")
        elif cmd == "open":
            d.sh(f"am start -a android.intent.action.VIEW -d 'mirror://{args[0]}' {self.pkg}")
            time.sleep(1.5)
        elif cmd == "tapAt":
            node = d.wait_for(args[0], 30)
            x1, y1, x2, y2 = node.bounds
            x = int(x1 + (x2 - x1) * float(args[1])); y = int(y1 + (y2 - y1) * float(args[2]))
            d.tap_xy(x, y); self.log(f"  tapAt {args[0]} @({x},{y})"); time.sleep(0.6)
        elif cmd == "swipeUp":
            d.sh("input swipe 540 1700 540 900 350"); time.sleep(0.8)
        elif cmd == "retry":
            # retry <times> <pause-secs> <cmd> ;; <cmd> ...   run the sub-commands; on a failure pause and start over
            times, pause = int(args[0]), float(args[1])
            subs = [c.strip() for c in self.subst(raw).split(None, 3)[3].split(";;") if c.strip()]
            for attempt in range(1, times + 1):
                try:
                    for c in subs:
                        self.log(f"  retry {attempt}/{times}: {c}")
                        self.step(n, c)
                    break
                except Exception as e:  # noqa: BLE001
                    self.log(f"  attempt {attempt} failed: {e}")
                    self.extra.setdefault("attempts", []).append(str(e)[:300])
                    if attempt == times:
                        raise
                    d.screenshot(f"s{n}-retry-{attempt}")
                    time.sleep(pause)
        elif cmd == "log":
            self.log("  # " + " ".join(args))
        else:
            raise ValueError(f"unknown command: {cmd}")

    def run(self, flow):
        lines = [l.rstrip() for l in open(flow)]
        ok = True
        for i, raw in enumerate(lines, 1):
            s = raw.strip()
            if not s or s.startswith("#"):
                continue
            self.log(f"[{i}] {s}")
            t0 = time.time()
            self.extra = {}
            cmd0 = s.split()[0]
            before = set(os.listdir(self.evidence))
            try:
                self.step(i, s)
                if self.d and cmd0 not in NO_SHOT:
                    self.d.screenshot(f"s{i}-{cmd0}")
                self.extra["shots"] = sorted(f for f in set(os.listdir(self.evidence)) - before if f.endswith(".png"))
                self.report.append({"line": i, "step": self.cur_step, "cmd": s, "ok": True, "secs": round(time.time() - t0, 1), **self.extra})
            except Exception as e:  # noqa: BLE001
                ok = False
                self.log(f"  FAILED: {e}")
                if self.d:
                    try:
                        self.d.screenshot(f"s{i}-FAILED"); self.d.save_ui(f"s{i}-FAILED")
                    except Exception:  # noqa: BLE001
                        pass
                self.extra["shots"] = sorted(f for f in set(os.listdir(self.evidence)) - before if f.endswith(".png"))
                self.report.append({"line": i, "step": self.cur_step, "cmd": s, "ok": False, "error": str(e), **self.extra})
                break
        steps = []
        for r in self.report:
            if not steps or steps[-1]["step"] != r["step"]:
                steps.append({"step": r["step"], "ok": True, "commands": 0})
            steps[-1]["commands"] += 1
            steps[-1]["ok"] = steps[-1]["ok"] and r["ok"]
        with open(os.path.join(self.evidence, "report.json"), "w") as f:
            json.dump({"flow": flow, "apk": self.apk, "package": self.pkg, "ok": ok, "summary": steps,
                       "commands": self.report}, f, indent=2)
        try:
            from contact_sheet import write_index
            write_index(self.evidence)
        except Exception as e:  # noqa: BLE001
            self.log(f"contact sheet failed: {e}")
        self.log(f"RESULT {'PASS' if ok else 'FAIL'}  evidence: {self.evidence}")
        return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("flow")
    ap.add_argument("--apk")
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--device", action="append", default=[], help="alias=serial")
    a = ap.parse_args()
    os.makedirs(a.evidence, exist_ok=True)
    aliases = dict(x.split("=", 1) for x in a.device) or {"a": "emulator-5554", "b": "emulator-5556"}
    sys.exit(0 if Runner(a.apk, a.evidence, aliases).run(a.flow) else 1)


if __name__ == "__main__":
    main()
