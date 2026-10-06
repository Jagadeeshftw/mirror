#!/usr/bin/env python3
"""Drive the app on an emulator and capture screenshots (light + dark) via adb.
Usage: scripts/screens.py <serial> <outdir>   (mock on :8787, adb reverse set up)"""
import json, os, re, subprocess, sys, time, urllib.request
import xml.etree.ElementTree as ET

SERIAL, OUT = sys.argv[1], sys.argv[2]
ADB = os.environ.get("ADB", "adb")
PKG = "com.zeroxo.mirror"
MOCK = "http://localhost:8787"

def adb(*a, check=True):
    return subprocess.run([ADB, "-s", SERIAL, *a], capture_output=True, text=True, check=check).stdout

def mock(path, body=None):
    req = urllib.request.Request(MOCK + path, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    return json.loads(urllib.request.urlopen(req).read() or b"{}")

def dump():
    for _ in range(3):
        adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False)
        x = adb("shell", "cat", "/sdcard/ui.xml", check=False)
        if x.strip().startswith("<?xml"):
            return ET.fromstring(x)
        time.sleep(0.5)
    raise RuntimeError("uiautomator dump failed")

def find(rid, root=None):
    root = root if root is not None else dump()
    for n in root.iter("node"):
        if n.get("resource-id") == rid:
            return n
    return None

def center(n):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds")))
    return (x1 + x2) // 2, (y1 + y2) // 2

def tap(rid, wait=8.0, long=False):
    t0 = time.time()
    while time.time() - t0 < wait:
        n = find(rid)
        if n is not None:
            x, y = center(n)
            if long:
                adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), "900")
            else:
                adb("shell", "input", "tap", str(x), str(y))
            return True
        time.sleep(0.5)
    print(f"  ! not found: {rid}")
    return False

def tap_scroll(rid, tries=5):
    for _ in range(tries):
        if find(rid) is not None:
            return tap(rid)
        scroll(900)
    print(f"  ! not found after scrolling: {rid}")
    return False

def wait_health(timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            mock("/v1/health"); return True
        except Exception:
            time.sleep(0.5)
    return False

def wait_for(rid, wait=15.0):
    t0 = time.time()
    while time.time() - t0 < wait:
        if find(rid) is not None:
            return True
        time.sleep(0.5)
    print(f"  ! timeout waiting for {rid}")
    return False

def text(rid):
    n = find(rid)
    return n.get("text") if n is not None else None

def link(path):
    adb("reverse", "tcp:8787", "tcp:8787", check=False)  # survives adb server restarts
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", f"mirror://{path}", PKG)

def scroll(dy=1400):
    adb("shell", "input", "swipe", "585", "2000", "585", str(2000 - dy), "400")
    time.sleep(0.6)

def theme(mode):
    adb("shell", "cmd", "uimode", "night", "yes" if mode == "dark" else "no")

W = 1170  # 390 dp at 480 dpi
ISSUES = []

def check(name):
    """Cheap layout checks on the uiautomator tree: nodes outside the 390 dp viewport,
    text clipped at the right edge, empty texts, interactive nodes without a testID."""
    try:
        root = dump()
    except Exception as e:
        ISSUES.append(f"{name}: dump failed {e}"); return
    parent = {c: p for p in root.iter() for c in p}
    def in_hscroll(n):
        while n in parent:
            n = parent[n]
            if n.get("class", "").endswith("HorizontalScrollView"):
                return True
        return False
    for n in root.iter("node"):
        if n.get("package") != PKG:
            continue
        x1, y1, x2, y2 = map(int, re.findall(r"-?\d+", n.get("bounds")))
        cls, txt, rid = n.get("class", ""), n.get("text", ""), n.get("resource-id", "")
        if x2 - x1 <= 0 or y2 - y1 <= 0:
            continue
        in_hscroll = False
        if (x1 < 0 or x2 > W) and not in_hscroll(n):
            ISSUES.append(f"{name}: outside viewport {cls.split('.')[-1]} [{x1},{x2}] text={txt[:40]!r} id={rid}")
        if cls.endswith("TextView") and txt and x2 >= W - 2 and x1 > 2 and not in_hscroll(n):
            ISSUES.append(f"{name}: text touches right edge [{x1},{x2}] {txt[:50]!r}")
        if n.get("clickable") == "true" and not rid and not n.get("content-desc"):
            ISSUES.append(f"{name}: clickable without testID text={txt[:30]!r} bounds={n.get('bounds')}")

def shot(name, settle=1.2, both=True, before=None):
    """Capture `name` in light and dark (the app follows the system theme)."""
    for mode in (["light", "dark"] if both else ["light"]):
        theme(mode)
        if before:
            before()
        time.sleep(settle)
        os.makedirs(f"{OUT}/{mode}", exist_ok=True)
        with open(f"{OUT}/{mode}/{name}.png", "wb") as f:
            f.write(subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], capture_output=True, check=True).stdout)
        print(f"  {mode}/{name}.png")
        if mode == "light":
            check(name)
    theme("light")

if __name__ == "__main__":
    steps = sys.argv[3:] if len(sys.argv) > 3 else None
    print("driver ready", SERIAL, OUT, steps)
