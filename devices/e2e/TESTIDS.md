# testIDs the E2E flow assumes

React Native shows `testID` as the Android `resource-id`. This was checked on the probe: `testID="address"` showed up in the dump as `resource-id="address"`. The harness selects these with `id:<testID>`. Please add them exactly as written below, or change `flows/mirror-full.flow` to match.

Rules:
- Put the testID on the element you tap (Pressable or Button), not on a wrapper around it.
- For text checks, put the testID on the `<Text>` that shows the value. The harness reads that node's `text`.
- Lists use indexes: `leaders.item.0`, `activity.item.0`, and so on. Item 0 is the newest or top entry.

| testID | Element | Used for |
|---|---|---|
| `onboarding.screen` | root view of the first-run screen | wait for launch |
| `onboarding.createAccount` | "Create account" button (starts the single passkey create with PRF) | create |
| `onboarding.restore` | "I already have an account" / restore button (discoverable get) | restore on b |
| `home.screen` | root view of home | wait after create/restore |
| `home.balance.ausd` | Text with the AUSD balance number | balance |
| `home.account.address` | Text with the 0x address (full or shortened `0x1234…abcd`) | identity check a vs b |
| `home.tab.leaders` / `home.tab.activity` / `home.tab.portfolio` | bottom tabs | navigation |
| `home.withdraw` | Withdraw entry button | withdraw |
| `leaders.list` | leaders FlatList | wait |
| `leaders.item.<n>` | leader row n | open leader |
| `leader.screen` | leader detail root | wait |
| `leader.follow` | Follow button | follow |
| `leader.rules` | open the follow rules / guards editor | blocked rule |
| `leader.pause` | Pause following button | pause |
| `follow.sheet` | follow configuration sheet root | wait |
| `follow.matchNow.toggle` | "Match now" switch (copy current positions immediately) | follow with match-now |
| `follow.amount.input` | allocation amount TextInput | follow |
| `follow.confirm` | confirm follow button | follow |
| `follow.status` | Text: `Following` / `Matched` / `Paused` | follow, pause |
| `passkey.confirm.continue` | optional in-app "Confirm with passkey" button shown before the system sheet | any signing step |
| `activity.item.<n>` | activity row n | receive copy |
| `activity.item.<n>.type` | Text inside the row: `Copy`, `Blocked`, `Withdraw`, ... | receive copy |
| `activity.blocked.banner` | Text/banner shown when a guard rule blocks a copy (contains "Blocked" or "rule") | blocked rule |
| `trade.status` | Text on the trade detail screen: `Filled` / `Confirmed` | receive copy |
| `rules.maxTradeSize.input` | max trade size TextInput | blocked rule |
| `rules.save` | save rules button | blocked rule |
| `portfolio.closeAll` | "Close all" button | close all |
| `portfolio.closeAll.confirm` | confirm dialog button | close all |
| `portfolio.positions.count` | Text with the number of open positions | close all |
| `withdraw.address.input` | destination address TextInput | withdraw |
| `withdraw.amount.input` | amount TextInput | withdraw |
| `withdraw.confirm` | confirm withdraw button | withdraw |
| `withdraw.status` | Text: `Sent` / `Confirmed` | withdraw |

The system passkey sheet and the biometric prompt are not app UI. `passkey` steps handle them: the harness taps Continue/Create/Use passkey on the Credential Manager sheet, then runs `adb emu finger touch 1` when the fingerprint prompt appears.
