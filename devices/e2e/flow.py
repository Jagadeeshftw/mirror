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
  scrollTo <sel>                swipe up until visible (max 8 swipes)
  passkey                       approve the system passkey sheet (tap Continue/..., emu finger touch)
  passkeyExpectFail             same, but the step passes if the sheet ends in an error
  key <KEYCODE> | back | home | sleep <secs> | screenshot <name> | log <text...>
  expectResult <sel> <regex> [secs]   wait for a node whose text matches regex

Selectors: id:<testID>  text:<exact>  text~:<regex>  desc:<exact>  desc~:<regex>  (bare = text)
Lines are split with shlex: quote any selector or text that contains spaces or backslashes.
Every tap / passkey / assert step saves a screenshot to the evidence dir.
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

    def step(self, n, raw):
        parts = shlex.split(raw)
        cmd, args = parts[0], parts[1:]
        d = self.d
        if cmd == "device":
            self.use(args[0]); return
        if d is None:
            self.use(next(iter(self.aliases), "emulator-5554")); d = self.d
        if cmd == "install":
            d.adb("install", "-r", "-g", self.apk, timeout=300)
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
                txt = node.text if node else None
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
            for _ in range(8):
                if d.find(args[0]):
                    break
                d.sh("input swipe 540 1700 540 800 350"); time.sleep(0.8)
            d.wait_for(args[0], 3)
        elif cmd in ("passkey", "passkeyExpectFail"):
            res = d.approve_passkey(timeout=float(args[0]) if args else 90)
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
            try:
                self.step(i, s)
                self.report.append({"line": i, "cmd": s, "ok": True, "secs": round(time.time() - t0, 1)})
            except Exception as e:  # noqa: BLE001
                ok = False
                self.log(f"  FAILED: {e}")
                if self.d:
                    try:
                        self.d.screenshot(f"s{i}-FAILED"); self.d.save_ui(f"s{i}-FAILED")
                    except Exception:  # noqa: BLE001
                        pass
                self.report.append({"line": i, "cmd": s, "ok": False, "error": str(e)})
                break
        with open(os.path.join(self.evidence, "report.json"), "w") as f:
            json.dump({"flow": flow, "apk": self.apk, "package": self.pkg, "ok": ok, "steps": self.report}, f, indent=2)
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
