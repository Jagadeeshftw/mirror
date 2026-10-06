#!/usr/bin/env python3
"""Provision an emulator for passkey tests: screen-lock PIN + one enrolled fingerprint.

usage: provision.py <serial> [--pin 1234] [--evidence DIR]

Idempotent: skips the PIN if a lock is already set and skips enrollment if a
fingerprint is already enrolled. Never touches accounts.
"""
import argparse
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from device import Device, DEFAULT_PIN  # noqa: E402

ENROLL_ADVANCE = re.compile(r"^(I agree|Agree|More|Next|Start|Continue|Got it|OK|Do it later|Accept)$", re.I)
ENROLL_DONE = re.compile(r"^(Done)$", re.I)
TOUCH_TEXT = re.compile(r"(touch the sensor|lift, then touch|keep lifting|put your finger|touch and hold|place your finger|fingerprint added|touch the power button)", re.I)


def fingerprint_count(d: Device) -> int:
    out = d.sh("dumpsys fingerprint")
    m = re.search(r'"count"\s*:\s*(\d+)', out) or re.search(r"enrolled[^\d]*(\d+)", out, re.I)
    return int(m.group(1)) if m else 0


def set_pin(d: Device, pin: str) -> None:
    out = d.sh(f"locksettings set-pin {pin}")
    if "set to" not in out.lower() and "already" not in out.lower():
        # retry assuming an existing identical PIN
        out2 = d.sh(f"locksettings set-pin --old {pin} {pin}")
        d.log(f"  set-pin retry: {out2.strip()}")
    d.log(f"  set-pin: {out.strip()}")


def enroll(d: Device, pin: str, timeout: float = 180) -> None:
    d.unlock(pin)
    d.sh("am start -a android.settings.FINGERPRINT_ENROLL")
    time.sleep(3)
    t0 = time.time()
    touches = 0
    while time.time() - t0 < timeout:
        nodes = d.dump()
        if d.dismiss_anr(nodes):
            continue
        texts = [n.text for n in nodes if n.text]
        joined = " | ".join(texts)
        # PIN confirmation
        edit = next((n for n in nodes if n.cls.endswith("EditText") and n.pkg == "com.android.settings"), None)
        if edit is not None and re.search(r"(PIN|re-enter|confirm)", joined, re.I):
            d.log("  enroll: confirming PIN")
            d.tap_xy(*edit.center)
            d.type_text(pin)
            d.key("KEYCODE_ENTER")
            time.sleep(2.5)
            continue
        done = next((n for n in nodes if ENROLL_DONE.match(n.text or "") and n.enabled), None)
        if done is not None and re.search(r"(fingerprint added|added)", joined, re.I):
            d.screenshot("fingerprint-added")
            d.tap_xy(*done.center)
            d.log("  enroll: done")
            return
        if any(TOUCH_TEXT.search(t) for t in texts) or re.search(r"(Touch|Lift)", joined):
            if not re.search(r"(I agree|More|Next)$", joined):
                touches += 1
                d.finger(1)
                time.sleep(1.2)
                if touches % 4 == 1:
                    d.log(f"  enroll: finger touch #{touches}")
                continue
        adv = next((n for n in nodes if ENROLL_ADVANCE.match((n.text or "").strip()) and n.enabled and n.clickable
                    and n.pkg == "com.android.settings" and n.text.lower() != "do it later"), None)
        if adv is not None:
            d.log(f"  enroll: tap '{adv.text}'")
            d.tap_xy(*adv.center)
            time.sleep(2)
            continue
        # Scroll down for "More"/"I agree" that may be off-screen
        d.sh("input swipe 540 1800 540 600 300")
        time.sleep(1)
    d.screenshot("fingerprint-enroll-timeout")
    raise TimeoutError("fingerprint enrollment did not finish; last screen: " + joined[:400])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("serial")
    ap.add_argument("--pin", default=DEFAULT_PIN)
    ap.add_argument("--evidence")
    a = ap.parse_args()
    d = Device(a.serial, a.evidence)
    d.wait_boot()
    d.sh("settings put system screen_off_timeout 1800000")
    d.sh("settings put global window_animation_scale 0.5")
    d.sh("settings put global transition_animation_scale 0.5")
    d.sh("settings put global animator_duration_scale 0.5")
    d.wake()
    d.sh("wm dismiss-keyguard")
    set_pin(d, a.pin)
    n = fingerprint_count(d)
    if n == 0:
        enroll(d, a.pin)
    n = fingerprint_count(d)
    d.key("KEYCODE_HOME")
    d.screenshot("provisioned-home")
    print(f"{a.serial}: pin=set fingerprints={n}")
    if n < 1:
        sys.exit(2)


if __name__ == "__main__":
    main()
