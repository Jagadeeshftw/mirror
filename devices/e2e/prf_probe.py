#!/usr/bin/env python3
"""Run the Mirror PRF probe app on an emulator and capture the outcome.

usage: prf_probe.py <serial> <apk> [--evidence DIR] [--steps create,create2ns,enc,restore]

Taps each probe button, auto-approves the passkey sheet (emu finger touch),
then records the app's result line (from logcat) plus every system-sheet text.
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from device import Device  # noqa: E402

PKG = "com.zeroxo.mirror"
BUTTONS = {"create": ("Create passkey", "CREATE"), "create2ns": ("Create 2NS", "CREATE2NS"),
           "enc": ("Encrypt key", "NSENC"), "restore": ("Restore", "RESTORE")}


def app_lines(d: Device):
    out = d.adb("logcat", "-d", "-s", "ReactNativeJS:I", check=False)
    return [l for l in out.splitlines() if "[meraprobe]" in l]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("serial")
    ap.add_argument("apk")
    ap.add_argument("--evidence", default=None)
    ap.add_argument("--steps", default="create,create2ns,enc")
    a = ap.parse_args()
    ev = a.evidence or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evidence",
                                    time.strftime("prf-%Y%m%d-%H%M%S"))
    os.makedirs(ev, exist_ok=True)
    d = Device(a.serial, ev)
    d.wait_boot()
    d.unlock()
    d.adb("install", "-r", a.apk, timeout=300)
    d.sh(f"pm clear {PKG}")
    d.adb("logcat", "-c", check=False)
    d.sh(f"monkey -p {PKG} -c android.intent.category.LAUNCHER 1")
    d.wait_for("text~:SELFTEST", timeout=60)
    d.screenshot("launch")
    gms = re.findall(r"versionName=(\S+)", d.sh("dumpsys package com.google.android.gms"))
    results = {"serial": a.serial, "gms_versions": gms, "android": d.sh("getprop ro.build.version.release").strip(),
               "google_account_present": "com.google" in d.sh("dumpsys account"), "steps": []}
    for step in a.steps.split(","):
        label, tag = BUTTONS[step]
        before = len(app_lines(d))
        d.tap(f"text~:^{label}$", timeout=20)
        approval = d.approve_passkey(timeout=60)
        line = None
        t0 = time.time()
        while time.time() - t0 < 30:
            new = app_lines(d)[before:]
            done = [l for l in new if re.search(rf"{tag} (OK|FAIL)", l)]
            if done:
                line = done[-1].split("'[meraprobe]', ")[-1].strip("'")
                break
            time.sleep(1)
        d.screenshot(f"{step}-result")
        results["steps"].append({"step": step, "result": line, "approval": approval})
        print(f"[{step}] {line}\n   sheet: {approval}")
    full = d.adb("logcat", "-d", check=False)
    keep = [l for l in full.splitlines() if re.search(r"(meraprobe|Credential|Fido|passkey|Passkey|assetlink|AssetLink|DigitalAsset|webauthn)", l)]
    with open(os.path.join(ev, "logcat-filtered.txt"), "w") as f:
        f.write("\n".join(keep))
    with open(os.path.join(ev, "result.json"), "w") as f:
        json.dump(results, f, indent=2)
    print(json.dumps({k: v for k, v in results.items() if k != "steps"}))
    print("evidence:", ev)


if __name__ == "__main__":
    main()
