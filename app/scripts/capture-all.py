#!/usr/bin/env python3
"""Capture every screen in light and dark against the dev mock.
Usage: scripts/capture-all.py <serial> <outdir> [step ...]"""
import subprocess, sys, time
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import screens as s

PKG = s.PKG
only = set(sys.argv[3:])
def want(k): return not only or k in only

def owner():
    st = s.mock("/__mock/state")
    return st["owners"][-1]["owner"] if st["owners"] else None

def back(): s.adb("shell", "input", "keyevent", "4"); time.sleep(0.8)

if want("welcome"):
    s.adb("shell", "pm", "clear", PKG, check=False)
    s.adb("shell", "pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS", check=False)
    s.adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    s.wait_for("onboarding.screen", 40)
    s.shot("01-welcome")
    s.tap("onboarding.createAccount")
    s.wait_for("home.screen", 30)
    time.sleep(3)

O = owner()
print("owner", O)

if want("home"):
    s.mock("/__mock/scenario", {"owner": O, "scenario": "funded"})
    s.link("/home"); s.wait_for("home.screen"); time.sleep(4)
    s.shot("03-home")
    s.scroll(1500); s.shot("03-home-scrolled")

if want("leaders"):
    s.link("/leaders"); s.wait_for("leaders.list"); time.sleep(2)
    s.shot("05-leaderboard")

if want("profile"):
    s.link("/leader/1588"); s.wait_for("leader.screen"); time.sleep(2.5)
    s.shot("06-leader-profile")
    s.scroll(1500); s.shot("06-leader-profile-due-diligence")
    s.scroll(1600); s.shot("06-leader-profile-risk")

if want("follow"):
    s.link("/follow/1588"); s.wait_for("follow.sheet"); time.sleep(3)
    s.shot("07-follow-limits")
    s.scroll(1500); s.shot("07-follow-limits-2")
    s.scroll(1500); s.shot("07-follow-limits-3")
    s.scroll(1500); s.shot("07-follow-limits-4")
    s.scroll(2000); time.sleep(1.5); s.shot("07-follow-match-now")
    s.tap("follow.review"); time.sleep(2)
    s.shot("07-follow-review")
    s.scroll(1500); s.shot("07-follow-review-2")
    s.tap("follow.confirm"); time.sleep(6)
    s.shot("07-follow-done")
    s.tap("follow.done"); time.sleep(2)

if want("feed"):
    s.link("/feed"); s.wait_for("activity.screen"); time.sleep(2.5)
    s.shot("08-feed")
    s.tap("feed.filter.blocked"); time.sleep(1)
    s.shot("09-feed-blocked")
    s.tap("activity.item.0"); s.wait_for("blocked.sheet"); time.sleep(1)
    s.shot("09-blocked-detail")
    s.tap("blocked.done"); time.sleep(1)

if want("positions"):
    s.link("/positions"); s.wait_for("portfolio.screen"); time.sleep(2)
    s.shot("10-positions")
    s.scroll(1500); s.shot("10-positions-scrolled")
    s.tap_scroll("portfolio.closeAll"); s.wait_for("closeAll.dialog"); time.sleep(0.8)
    s.shot("11-close-all-confirm")
    s.tap("closeAll.cancel"); time.sleep(0.8)

if want("account"):
    s.link("/account"); s.wait_for("account.screen"); time.sleep(2)
    s.shot("11-account-controls")

if want("funds"):
    s.link("/funds"); s.wait_for("funds.receive"); time.sleep(2)
    s.shot("04-add-funds-receive")
    s.tap("funds.step.deposit"); time.sleep(1.5)
    s.shot("04-add-funds-deposit")

if want("withdraw"):
    s.link("/withdraw"); s.wait_for("withdraw.screen"); time.sleep(2)
    s.shot("11-withdraw")
    s.tap("withdraw.continue"); s.wait_for("withdraw.sheet"); time.sleep(1)
    s.shot("11-withdraw-confirm")
    s.tap("withdraw.confirm"); s.wait_for("withdraw.status", 20); time.sleep(1)
    s.shot("11-withdraw-done")
    s.tap("withdraw.done"); time.sleep(1)

if want("send"):
    s.link("/send"); s.wait_for("send.screen"); time.sleep(1)
    s.tap("send.address.input"); s.adb("shell", "input", "text", "0x19be728ba90e3454f77a0cb8323f484209da04d2")
    s.tap("send.amount.input"); s.adb("shell", "input", "text", "2.50")
    s.adb("shell", "input", "keyevent", "111"); time.sleep(0.8)
    s.shot("11-send-ausd")

if want("notifications"):
    s.link("/notifications"); s.wait_for("notifications.screen"); time.sleep(2)
    s.shot("12-notifications")

if want("push"):
    s.link("/home"); time.sleep(2)
    s.mock("/__mock/push", {"owner": O, "kind": "Blocked"})
    time.sleep(2)
    s.mock("/__mock/push", {"owner": O, "kind": "Mirrored"})
    time.sleep(2)
    def expand():
        s.adb("shell", "cmd", "statusbar", "expand-notifications")
    s.shot("12-push", settle=2.0, before=expand)
    s.adb("shell", "cmd", "statusbar", "collapse")

if want("settings"):
    s.link("/settings"); s.wait_for("settings.screen"); time.sleep(2.5)
    s.shot("12-settings")
    s.scroll(1600); s.shot("12-settings-scrolled")

if want("demo"):
    s.link("/demo"); s.wait_for("demo.screen"); time.sleep(3)
    s.shot("14-demo")
    s.tap("demo.runTrade"); time.sleep(2.5)
    s.scroll(900); s.shot("14-demo-trade-running", settle=0.6)
    time.sleep(20)
    s.shot("14-demo-trade-done")
    s.tap("demo.runBlocked") or (s.scroll(-900) or s.tap("demo.runBlocked"))
    time.sleep(2.5); s.shot("14-demo-blocked")
    time.sleep(3)
    s.mock("/__mock/demo-limit", {})
    s.tap("demo.runTrade"); time.sleep(1.5)
    s.shot("14-demo-rate-limited")

if want("empty"):
    s.mock("/__mock/scenario", {"owner": O, "scenario": "empty"})
    s.link("/home"); time.sleep(1); s.link("/leaders"); time.sleep(1); s.link("/home"); time.sleep(16)
    s.shot("13-empty-home")
    s.mock("/__mock/scenario", {"owner": O, "scenario": "funded"})

if want("offline"):
    s.link("/feed"); s.wait_for("activity.screen"); time.sleep(2)
    subprocess.run("lsof -ti:8787 | xargs kill", shell=True)
    time.sleep(1)
    s.tap("feed.filter.all"); time.sleep(1)
    s.link("/positions"); time.sleep(1); s.link("/feed"); time.sleep(34)
    s.shot("13-offline-feed")
    subprocess.Popen("node dev-mock/server.mjs >> /tmp/mirror-mock.log 2>&1", shell=True, cwd=__file__.rsplit("/", 2)[0])
    s.wait_health()
    s.link("/home"); time.sleep(3)

if want("restore"):
    s.link("/settings"); s.wait_for("settings.screen"); time.sleep(1)
    s.tap("settings.signOut"); s.tap("settings.signOut.confirm"); s.wait_for("onboarding.screen")
    s.tap("onboarding.restore"); time.sleep(0.4)
    s.shot("02-restore-progress", settle=0.2, both=False)
    s.wait_for("restore.welcome.back", 30); time.sleep(1)
    s.shot("02-restore-welcome-back")
    s.tap("restore.go.home"); time.sleep(2)
open(f"{sys.argv[2]}/checks.txt", "w").write("\n".join(s.ISSUES) + "\n")
print(f"done; {len(s.ISSUES)} layout issues -> {sys.argv[2]}/checks.txt")
