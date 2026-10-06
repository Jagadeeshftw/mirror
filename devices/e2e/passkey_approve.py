#!/usr/bin/env python3
"""Passkey-approval helper: wait for the system passkey sheet on <serial>, press its
confirm button and satisfy the biometric prompt with `adb emu finger touch 1`.

usage: passkey_approve.py <serial> [--timeout 90] [--evidence DIR]
Exit 0 when the sheet completed, 1 on timeout / no-credential sheet. Prints a JSON summary.
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from device import Device  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("serial"); ap.add_argument("--timeout", type=float, default=90); ap.add_argument("--evidence")
a = ap.parse_args()
r = Device(a.serial, a.evidence).approve_passkey(timeout=a.timeout)
print(json.dumps(r)); sys.exit(0 if r.get("ok") else 1)
