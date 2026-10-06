# Mirror app testIDs

`testID` shows up as the Android `resource-id`, so the harness selects them with `id:<testID>`.
Every ID that `devices/e2e/TESTIDS.md` asks for exists with exactly that name, except the
ones listed under "Differences" (please update `flows/mirror-full.flow` for those).
List indexes start at 0 = newest / top.

## IDs from devices/e2e/TESTIDS.md

| testID | Where | Notes |
|---|---|---|
| `onboarding.screen` | Welcome root view | |
| `onboarding.createAccount` | "Create account" | One Mera passkey create (PRF). |
| `onboarding.restore` | "I already have an account" | Opens Restore, which immediately runs the discoverable passkey get. Then tap `restore.go.home`. |
| `home.screen` | Home root view | |
| `home.balance.ausd` | Text in the persistent AUSD balance chip (app bar, every main screen) | Total AUSD: wallet + all follow accounts. Format `21.37`. |
| `home.account.address` | Text on Home, right of "EQUITY" | Shortened `0x1234…abcd`. Full address: `account.address` (Account screen) or `funds.address` (grouped in fours). |
| `home.tab.leaders` / `home.tab.activity` / `home.tab.portfolio` | Bottom nav (Leaders, Feed, Positions) | Also `home.tab.home`. |
| `home.withdraw` | Home "Withdraw" | |
| `leaders.list` | Leaderboard ScrollView | |
| `leaders.item.<n>` | Leader row n | |
| `leader.screen` | Leader profile root | |
| `leader.follow` | "Follow 0x…" (only when not following) | Opens the follow sheet. |
| `leader.rules` | "Edit limits" (only when already following) | Opens the follow sheet in edit mode (SET_POLICY). |
| `leader.pause` | Pause / resume button (only when following) | One passkey prompt, ACTION_SET_PAUSED. |
| `follow.sheet` | Follow sheet root | |
| `follow.matchNow.toggle` | "Match the leader now" switch | ON by default. |
| `follow.amount.input` | Allocation TextInput | 10 to 25 AUSD, and no more than the wallet holds. |
| `follow.confirm` | "Approve with passkey" on the Review step | See "Differences": tap `follow.review` first. |
| `follow.status` | Text | Follow sheet result: `Approving` / `Following` / `Matched` / `Saved` / `Failed`. Leader profile (when following): `Following` / `Paused`. |
| `activity.item.<n>` | Feed card n | |
| `activity.item.<n>.type` | Text in the card header | `COPY`, `CLOSE`, `BLOCKED`, `DEPOSIT`, `WITHDRAW`, `FOLLOW`, `PAUSED`, `CLOSEDALL`, `POLICYUPDATED` (shown uppercase; the text node holds `Copy`, `Close`, `Blocked`, …, because the uppercase is a style). |
| `activity.blocked.banner` | Footer text of a blocked card | "Not copied. Your rule: Max leverage 5x". Tap the card to open `blocked.sheet`. |
| `rules.maxTradeSize.input` | "Max notional per market" TextInput | The contract's per-market notional cap (maxNotionalCNS). |
| `rules.save` | "Save with passkey" in edit mode | Single step: signs SET_POLICY. |
| `portfolio.closeAll` | Positions "Close all positions" | Also `account.closeAll` on the Account screen. |
| `portfolio.closeAll.confirm` | Dialog "Close all" | One prompt; ACTION_CLOSE_ALL per account with positions. |
| `portfolio.positions.count` | Text next to "Open positions" | Number only. |
| `withdraw.address.input` | Destination TextInput | Prefilled with the user's own wallet. Another address = withdraw to own wallet + gasless ERC-3009 transfer, same prompt. |
| `withdraw.amount.input` | Amount TextInput (custom keypad; soft keyboard suppressed, `adb input text` works) | |
| `withdraw.confirm` | "Confirm with passkey" in the confirm sheet | See "Differences": tap `withdraw.continue` first. |
| `withdraw.status` | Text on the result screen | `Confirmed` (to own wallet), `Sent` (forwarded), `Pending`. |

### Differences

- `follow.confirm` is on step 2. Flow: `follow.amount.input` → `follow.review` → `follow.confirm`.
- `withdraw.confirm` is in a confirmation sheet. Flow: `withdraw.amount.input` → `withdraw.continue` → `withdraw.confirm`.
- `trade.status` does not exist (there is no trade detail screen). Use `activity.item.0.type` (`Copy`) and the commit track on the card, or `follow.status` = `Matched` after a follow with match-now.
- `passkey.confirm.continue` does not exist. Signing buttons go straight to the system sheet.
- Deep links work for direct navigation: `adb shell am start -a android.intent.action.VIEW -d "mirror:///leaders"` (`/home`, `/feed`, `/positions`, `/demo`, `/account`, `/settings`, `/notifications`, `/funds`, `/withdraw`, `/send`, `/leader/1588`, `/follow/1588`).

## Other IDs

| Area | testIDs |
|---|---|
| Navigation | `nav.back`, `nav.account` (avatar → Account), `nav.balance` (balance chip) |
| Welcome | `onboarding.brand`, `onboarding.error`; devtools builds only: long-press `onboarding.brand` → `onboarding.apiBase.input`, `onboarding.apiBase.save` |
| Restore | `restore.title`, `step.<passkey|located|rules|balances>.<pending|now|done|failed>`, `restore.progress`, `restore.retry`, `restore.error`, `restore.welcome.back`, `restore.go.home` |
| Home | `home.equity`, `home.kv.balance`, `home.kv.upnl`, `home.kv.rpnl`, `home.addFunds`, `home.beta.cap`, `home.manage`, `follow.row.<accountAddress>`, `recent.<eventId>`, `home.feed.link`, `home.demo`, `home.empty`, `home.browseLeaders`, `home.empty.addFunds`, `suggest.<leaderId>`, `home.offline` |
| Leaders | `leaders.screen`, `leaders.window.<7d|30d|90d>`, `leaders.filter.dd`, `leaders.filter.market`, `leaders.filter.nansen`, `leaders.sort`, `leaders.market.<SYM>`, `leaders.sort.<score|pnl|drawdown>`, `leaders.demo` |
| Leader profile | `leader.copy.address`, `leader.window.<7d|30d|90d>`, `leader.pnl.pct`, `leader.chart`, `leader.due.diligence`, `leader.open.positions`, `leader.nansen`, `leader.risk.flags`, `leader.alerts` |
| Follow sheet | `follow.close`, `follow.back`, `follow.scroll`, `follow.amount.<10|15|20|max>`, `follow.ratio.value`, `follow.ratio.slider`, `follow.ratio.suggest`, `follow.leverage.value`, `follow.leverage.slider`, `follow.slippage.value`, `follow.slippage.<10|25|50|100|200>`, `follow.slippage.input` (bps, 1 to 1000), `follow.market.<SYM>`, `follow.dailyLoss.value`, `follow.dailyLoss.slider`, `follow.drawdown.value`, `follow.drawdown.slider`, `follow.expiry.<7|30|90|180>`, `follow.quote`, `follow.quote.row.<n>`, `follow.matchNow.summary`, `follow.note.input`, `follow.review`, `follow.review.slippage`, `step.<sign|create|deposit|follow|policy>.<state>`, `follow.result.<n>`, `follow.error`, `follow.retry`, `follow.viewFeed`, `follow.done`, `follow.section.<allocation|sizing|leverage|slippage|notional|markets|dailyLoss|drawdown|expiry|matchNow|note>` |
| Feed | `activity.screen`, `feed.scroll`, `feed.filter.<all|copied|blocked|closes>`, `feed.live` / `feed.offline.indicator`, `feed.offline`, `feed.empty`, `activity.item.<n>.tx` |
| Blocked sheet | `blocked.sheet`, `blocked.title`, `blocked.sentence`, `blocked.tx`, `blocked.done`, `blocked.edit.rule` |
| Positions | `portfolio.screen`, `positions.total.pnl`, `positions.attribution`, `positions.group.<market|leader>`, `position.<SYM>.<long|short>`, `positions.empty` |
| Account | `account.screen`, `account.address`, `account.copyAddress`, `account.addFunds`, `account.withdraw`, `account.send`, `account.pauseAll`, `account.follow.<n>.toggle`, `account.follow.<n>.status`, `account.closeAll`, `account.error`, `account.notifications`, `account.settings`, `account.demo`, `closeAll.dialog`, `closeAll.cancel` |
| Add funds | `funds.step.receive`, `funds.step.deposit`, `funds.receive`, `funds.qr`, `funds.address`, `funds.copy`, `funds.share`, `funds.wallet.balance`, `funds.toDeposit`, `funds.account.<address>`, `funds.amount.input`, `funds.cap`, `funds.confirm`, `funds.status`, `funds.done` |
| Withdraw | `withdraw.screen`, `withdraw.account.<address>`, `withdraw.pct.25`, `withdraw.pct.50`, `withdraw.max`, `withdraw.toMine`, `withdraw.key.<0-9|.|x>`, `withdraw.continue`, `withdraw.sheet`, `withdraw.error`, `withdraw.tx`, `withdraw.done` |
| Send AUSD | `send.screen`, `send.address.input`, `send.paste`, `send.amount.input`, `send.max`, `send.confirm`, `send.status`, `send.error`, `send.done` |
| Notifications | `notifications.screen`, `notifications.filter.<all|copies|blocked|account>`, `notifications.item.<n>` |
| Settings | `settings.screen`, `settings.signOut`, `settings.signOut.confirm`, `settings.notifyKey`, `settings.notifyKey.fingerprint`, `settings.exportPhrase`, `settings.phrase`, `settings.phrase.hide`, `settings.theme.<system|light|dark>`, `settings.apiBase.input`, `settings.apiBase.save` (devtools builds only) |
| Demo | `demo.screen`, `demo.live`, `demo.account`, `demo.balance`, `demo.equity`, `demo.realised`, `demo.position.<n>`, `demo.runTrade`, `demo.runBlocked`, `demo.error`, `demo.cycle.<id>`, `demo.cycle.status`, `demo.step.<key>.<status>`, `demo.latency.<key>`, `demo.tx.<key>`, `demo.feed.<n>` |
