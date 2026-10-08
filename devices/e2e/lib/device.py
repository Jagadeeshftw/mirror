"""adb + uiautomator helpers for Mirror device tests (stdlib only, Python 3.9+).

Why not Maestro: Maestro flows cannot issue emulator-console commands
(`adb emu finger touch`) mid-flow, and a sidecar that dumps the UI would fight
Maestro for the single UiAutomation connection. One process that owns both
the UI driver and the emulator console keeps passkey approval deterministic.
"""
from __future__ import annotations

import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Callable, Iterable, List, Optional

SDK = os.environ.get("ANDROID_HOME", "/opt/homebrew/share/android-commandlinetools")
ADB = os.environ.get("ADB", os.path.join(SDK, "platform-tools", "adb"))
DEFAULT_PIN = os.environ.get("MIRROR_TEST_PIN", "1234")

GMS = "com.google.android.gms"
SYSTEMUI = "com.android.systemui"
CREDMAN_PKGS = (GMS, "com.google.android.gms.ui", "com.android.credentialmanager")

# Buttons on the Credential Manager / Google Password Manager sheets.
PASSKEY_BUTTONS = re.compile(
    r"^(Continue|Create|Create passkey|Save|Save passkey|Use passkey|Sign in|Next|OK|Allow)$",
    re.I,
)
# Text that indicates the biometric prompt is up and waiting for a finger.
BIOMETRIC_TEXT = re.compile(
    r"(touch the fingerprint sensor|use your fingerprint|fingerprint sensor|verify it.s you|confirm it.s you|use fingerprint)",
    re.I,
)
NO_CRED_TEXT = re.compile(r"(sign in another way|no passkeys|no saved|view options)", re.I)
PIN_TEXT = re.compile(r"(enter your pin|confirm your pin|use pin|device pin|re-enter your pin)", re.I)


def run(args: List[str], check: bool = True, timeout: int = 120, capture: bool = True) -> str:
    p = subprocess.run(args, capture_output=capture, text=True, timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} -> {p.returncode}: {p.stderr.strip() or p.stdout.strip()}")
    return (p.stdout or "") if capture else ""


@dataclass
class Node:
    text: str
    rid: str
    desc: str
    pkg: str
    cls: str
    clickable: bool
    enabled: bool
    bounds: tuple
    alltext: str = ""  # texts of this node and its descendants, joined with " | "

    @property
    def center(self):
        x1, y1, x2, y2 = self.bounds
        return ((x1 + x2) // 2, (y1 + y2) // 2)

    def label(self) -> str:
        return self.text or self.desc or self.rid


class Device:
    def __init__(self, serial: str, evidence_dir: Optional[str] = None, log: Callable[[str], None] = print):
        self.serial = serial
        self.evidence_dir = evidence_dir
        self.log = log
        self.shot_idx = 0

    # ---------- raw adb ----------
    def adb(self, *args: str, check: bool = True, timeout: int = 120) -> str:
        return run([ADB, "-s", self.serial, *args], check=check, timeout=timeout)

    def sh(self, cmd: str, check: bool = False, timeout: int = 60) -> str:
        return self.adb("shell", cmd, check=check, timeout=timeout)

    def emu(self, cmd: str) -> str:
        return self.adb("emu", *cmd.split(), check=False)

    def wait_boot(self, timeout: int = 600) -> None:
        t0 = time.time()
        run([ADB, "-s", self.serial, "wait-for-device"], timeout=timeout)
        while time.time() - t0 < timeout:
            if self.sh("getprop sys.boot_completed").strip() == "1":
                # package manager ready?
                if "package:" in self.sh("pm path android"):
                    return
            time.sleep(2)
        raise TimeoutError(f"{self.serial} did not boot in {timeout}s")

    def wake(self) -> None:
        self.sh("input keyevent KEYCODE_WAKEUP")

    def unlock(self, pin: str = DEFAULT_PIN) -> None:
        self.wake()
        if "mDreamingLockscreen=true" in self.sh("dumpsys window") or self.is_keyguard():
            self.sh("wm dismiss-keyguard")
            time.sleep(1)
            if self.is_keyguard():
                self.sh("input keyevent 82")
                time.sleep(1)
                self.sh(f"input text {pin}")
                self.sh("input keyevent 66")
                time.sleep(1.5)
            if self.is_keyguard():
                # After a cold boot the PIN pad can ignore `input text`: tap its keys instead.
                nodes = self.dump()
                keys = {n.rid.split("/")[-1]: n for n in nodes}
                if "key_enter" in keys:
                    for ch in pin:
                        if f"key{ch}" in keys:
                            self.tap_xy(*keys[f"key{ch}"].center); time.sleep(0.3)
                    self.tap_xy(*keys["key_enter"].center)
                    time.sleep(2)
                self.log(f"  unlock via keypad -> keyguard={self.is_keyguard()}")

    def is_keyguard(self) -> bool:
        out = self.sh("dumpsys window")
        return bool(re.search(r"(isKeyguardShowing|mKeyguardShowing|keyguardShowing)=true", out))

    # ---------- ui ----------
    def dump(self, retries: int = 3) -> List[Node]:
        last = ""
        for _ in range(retries):
            args = ["exec-out", "uiautomator", "dump"] + ([] if os.environ.get("FLOW_DUMP_FULL") == "1" else ["--compressed"]) + ["/dev/tty"]
            xml = self.adb(*args, check=False, timeout=30)
            last = xml
            i = xml.find("<?xml")
            j = xml.rfind("</hierarchy>")
            if i >= 0 and j > i:
                return parse_nodes(xml[i : j + len("</hierarchy>")])
            time.sleep(0.7)
        raise RuntimeError(f"uiautomator dump failed: {last[-300:]}")

    def dismiss_anr(self, nodes: Optional[List[Node]] = None) -> bool:
        """Tap 'Wait' on an "<app> isn't responding" dialog (common right after first boot)."""
        nodes = nodes if nodes is not None else self.dump()
        if any("isn't responding" in (n.text or "") or "isn\u2019t responding" in (n.text or "") for n in nodes):
            w = next((n for n in nodes if n.text in ("Wait", "WAIT")), None)
            if w is not None:
                self.log("  dismiss ANR dialog (Wait)")
                self.tap_xy(*w.center)
                time.sleep(2)
                return True
        return False

    def find(self, sel: str, nodes: Optional[List[Node]] = None) -> Optional[Node]:
        nodes = nodes if nodes is not None else self.dump()
        m = match_fn(sel)
        for n in nodes:
            x1, y1, x2, y2 = n.bounds
            if x2 <= x1 or y2 <= y1:  # scrolled out of view: uiautomator reports clipped, empty bounds
                continue
            if m(n):
                return n
        return None

    def wait_for(self, sel: str, timeout: float = 30, gone: bool = False) -> Optional[Node]:
        t0 = time.time()
        while time.time() - t0 < timeout:
            n = self.find(sel)
            if (n is not None) != gone:
                return n
            time.sleep(0.8)
        raise TimeoutError(f"{'gone' if gone else 'visible'} timeout ({timeout}s): {sel}")

    def tap(self, sel: str, timeout: float = 30) -> Node:
        n = self.wait_for(sel, timeout)
        x, y = n.center
        self.sh(f"input tap {x} {y}")
        self.log(f"  tap {sel} -> '{n.label()}' @({x},{y})")
        return n

    def tap_xy(self, x: int, y: int) -> None:
        self.sh(f"input tap {x} {y}")

    def type_text(self, text: str) -> None:
        safe = text.replace(" ", "%s").replace("'", "\\'").replace('"', '\\"').replace("&", "\\&")
        self.sh(f"input text '{safe}'")

    def key(self, code: str) -> None:
        self.sh(f"input keyevent {code}")

    def screenshot(self, name: str) -> Optional[str]:
        if not self.evidence_dir:
            return None
        os.makedirs(self.evidence_dir, exist_ok=True)
        self.shot_idx += 1
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
        path = os.path.join(self.evidence_dir, f"{self.shot_idx:02d}-{self.serial}-{safe}.png")
        data = b""
        for t in (30, 60):  # screencap can stall under host load; a missing screenshot never fails a step
            try:
                data = subprocess.run([ADB, "-s", self.serial, "exec-out", "screencap", "-p"], capture_output=True, timeout=t).stdout
                break
            except subprocess.TimeoutExpired:
                self.log(f"  screencap timed out after {t}s")
        if not data:
            self.log(f"  screenshot skipped: {name}")
            return None
        with open(path, "wb") as f:
            f.write(data)
        self.log(f"  screenshot {path}")
        return path

    def save_ui(self, name: str) -> None:
        if not self.evidence_dir:
            return
        xml = self.adb("exec-out", "uiautomator", "dump", "/dev/tty", check=False, timeout=30)
        with open(os.path.join(self.evidence_dir, f"{self.shot_idx:02d}-{self.serial}-{name}.xml"), "w") as f:
            f.write(xml)

    # ---------- fingerprint ----------
    def finger(self, finger_id: int = 1) -> None:
        self.emu(f"finger touch {finger_id}")
        time.sleep(0.6)
        self.emu(f"finger remove {finger_id}")

    # ---------- passkey approval ----------
    def approve_passkey(self, timeout: float = 90, finger_id: int = 1, pin: str = DEFAULT_PIN,
                        settle: float = 4.0, choose: Optional[str] = None) -> dict:
        """Wait for the Credential Manager / GPM sheet, press its confirm button,
        satisfy the biometric prompt with `emu finger touch`, and return once
        the system UI is gone. Returns a dict describing what happened, with the
        last visible error text if the sheet showed one."""
        t0 = time.time()
        acted = False
        quiet_since = None
        events: List[str] = []
        texts_seen: List[str] = []
        stalled_since = None
        while time.time() - t0 < timeout:
            try:
                nodes = self.dump()
            except RuntimeError:
                time.sleep(1)
                continue
            if self.dismiss_anr(nodes):
                continue
            sys_nodes = [n for n in nodes if n.pkg in CREDMAN_PKGS or n.pkg == SYSTEMUI]
            visible_text = " | ".join(n.text for n in sys_nodes if n.text)
            if visible_text and (not texts_seen or texts_seen[-1] != visible_text):
                texts_seen.append(visible_text)
            bio = any(BIOMETRIC_TEXT.search(n.text or n.desc or "") for n in sys_nodes) or any(
                n.pkg == SYSTEMUI and "biometric" in n.rid for n in nodes)
            pin_prompt = any(PIN_TEXT.search(n.text or n.desc or "") for n in sys_nodes)
            button = next((n for n in nodes if n.pkg in CREDMAN_PKGS and n.enabled
                           and PASSKEY_BUTTONS.match((n.text or n.desc or "").strip())), None)
            if choose and not any(e.startswith("choose:") for e in events):
                # Account picker ("Choose a saved passkey for ..."): tap the first entry matching `choose`.
                pick = next((n for n in nodes if n.pkg in CREDMAN_PKGS and n.text and re.search(choose, n.text)), None)
                # The compact sheet lists only the most recent passkeys: open the full list once, then scroll it.
                more = next((n for n in nodes if n.pkg in CREDMAN_PKGS and n.enabled and re.match(r"^(Sign-in options|More options|View all|Show more)$", (n.text or n.desc or "").strip())), None)
                if pick is None and more is not None and "more" not in events:
                    events.append("more")
                    self.log(f"  passkey: '{more.text or more.desc}' (wanted passkey not in the short list)")
                    self.tap_xy(*more.center)
                    stalled_since = None
                    time.sleep(2)
                    continue
                if pick is None and "more" in events and events.count("scroll") < 6 and any(n.pkg in CREDMAN_PKGS for n in nodes):
                    events.append("scroll")
                    self.sh("input swipe 540 1700 540 900 350")
                    time.sleep(1.2)
                    continue
                if pick is None and any(n.pkg in CREDMAN_PKGS for n in nodes) and re.search(r"Choose a saved passkey|Sign-in options|passkey", visible_text):
                    stalled_since = stalled_since or time.time()
                    if time.time() - stalled_since > 8:  # e.g. the passkey has not synced to this device yet
                        self.screenshot("passkey-choice-missing")
                        self.key("KEYCODE_BACK")
                        return {"ok": False, "events": events + ["back"], "texts": texts_seen, "error": "choice-not-listed"}
                if pick is not None:
                    events.append(f"choose:{pick.text}")
                    self.log(f"  passkey: choose '{pick.text}'")
                    self.screenshot("passkey-picker")
                    self.tap_xy(*pick.center)
                    acted, quiet_since = True, None
                    time.sleep(1.5)
                    continue
            if bio:
                events.append("biometric->finger")
                self.log("  passkey: biometric prompt -> emu finger touch")
                self.screenshot("passkey-biometric")
                self.finger(finger_id)
                acted, quiet_since = True, None
                time.sleep(2)
                continue
            if button is not None:
                events.append(f"tap:{button.label()}")
                self.log(f"  passkey: tap '{button.label()}'")
                self.screenshot(f"passkey-sheet-{button.label()}")
                x, y = button.center
                self.tap_xy(x, y)
                acted, quiet_since = True, None
                time.sleep(1.5)
                continue
            if pin_prompt and any(n.cls.endswith("EditText") for n in sys_nodes):
                events.append("pin")
                self.log("  passkey: PIN prompt -> typing test PIN")
                self.type_text(pin)
                self.key("KEYCODE_ENTER")
                acted, quiet_since = True, None
                time.sleep(2)
                continue
            on_sheet = any(n.pkg in CREDMAN_PKGS for n in nodes)
            if on_sheet and not acted and NO_CRED_TEXT.search(visible_text):
                # e.g. "Sign in another way | View options": no passkey for this rpId on the device.
                stalled_since = stalled_since or time.time()
                if time.time() - stalled_since > 6:
                    self.screenshot("passkey-no-credential")
                    self.key("KEYCODE_BACK")
                    return {"ok": False, "events": events + ["back"], "texts": texts_seen, "error": "no-credential-sheet"}
            if not on_sheet and acted:
                quiet_since = quiet_since or time.time()
                if time.time() - quiet_since > settle:
                    return {"ok": True, "events": events, "texts": texts_seen}
            elif on_sheet:
                quiet_since = None
            time.sleep(1)
        self.screenshot("passkey-timeout")
        if any(n.pkg in CREDMAN_PKGS for n in self.dump()):
            self.key("KEYCODE_BACK")
        return {"ok": False, "events": events, "texts": texts_seen, "error": "timeout"}


def parse_bounds(b: str) -> tuple:
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b or "")
    return tuple(int(v) for v in m.groups()) if m else (0, 0, 0, 0)


def parse_nodes(xml: str) -> List[Node]:
    root = ET.fromstring(xml)
    out = []
    for e in root.iter("node"):
        a = e.attrib
        out.append(Node(
            text=a.get("text", ""), rid=a.get("resource-id", ""), desc=a.get("content-desc", ""),
            pkg=a.get("package", ""), cls=a.get("class", ""), clickable=a.get("clickable") == "true",
            enabled=a.get("enabled") != "false", bounds=parse_bounds(a.get("bounds", "")),
        ))
    # alltext: texts of every node drawn inside this node's bounds (a compressed dump flattens containers,
    # so the tree alone does not say which texts belong to a card / note).
    for n in out:
        x1, y1, x2, y2 = n.bounds
        if x2 <= x1 or y2 <= y1:
            continue
        n.alltext = " | ".join(m.text or m.desc for m in out if (m.text or m.desc) and m.bounds[0] >= x1
                               and m.bounds[1] >= y1 and m.bounds[2] <= x2 and m.bounds[3] <= y2)
    return out


def match_fn(sel: str) -> Callable[[Node], bool]:
    """Selectors:  idtext:<id regex>~<text regex>  id:<testID>  text:<exact>  text~:<regex>  desc:<exact>  desc~:<regex>  <bare text>
    React Native exposes `testID` as the Android resource-id (with or without a package prefix)."""
    kind, _, val = sel.partition(":") if ":" in sel and sel.split(":", 1)[0] in (
        "id", "text", "text~", "desc", "desc~", "pkg", "idtext") else ("text", "", sel)
    if kind == "idtext":  # idtext:<resource-id regex>~<subtree text regex>, e.g. idtext:watch\.feed\.\d+~Copy
        idrx, _, txrx = val.partition("~")
        ri, rt = re.compile(idrx), re.compile(txrx, re.I | re.S)
        return lambda n: bool(ri.fullmatch(n.rid.split("/")[-1])) and bool(rt.search(n.alltext))
    if kind == "id":
        return lambda n: n.rid == val or n.rid.endswith("/" + val)
    if kind == "text":
        return lambda n: n.text == val or n.desc == val
    if kind == "text~":
        r = re.compile(val, re.I)
        return lambda n: bool(r.search(n.text or ""))
    if kind == "desc":
        return lambda n: n.desc == val
    if kind == "desc~":
        r = re.compile(val, re.I)
        return lambda n: bool(r.search(n.desc or ""))
    if kind == "pkg":
        return lambda n: n.pkg == val
    raise ValueError(sel)
