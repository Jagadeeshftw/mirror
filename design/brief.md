# Design brief — "Mirror" (working name, may be renamed; keep the name a single replaceable token)

## Product in one line
Copy the best traders on Perpl (an onchain perpetuals exchange on Monad) from your Android phone. Your limits are enforced by a smart contract on every copied order — the app can trade for you but can never withdraw.

## Who it's for
Crypto-curious traders who don't have time to watch charts, and who don't want to hand custody to a copy-trading platform. Judges are crypto VCs (Paradigm, Dragonfly, Electric Capital) and Monad co-founders: it must look like a fundable, finished consumer fintech product, not a hackathon demo.

## Core facts to show (real, not lorem)
- Account is a passkey (Mera). One fingerprint/face prompt creates it. No seed phrase, no extension. Restores on a new phone from the passkey alone.
- Balance is in AUSD (Agora's dollar stablecoin). The AUSD balance is ALWAYS visible (persistent header element on every main screen).
- Leaders = any public Perpl trader, ranked automatically from onchain data (PnL, drawdown, win rate, consistency) plus Nansen wallet intelligence (labels like "Smart Trader", "Fund", cross-venue history).
- Follow policy controls (every one must appear in the follow sheet): allocation (AUSD amount), sizing ratio (% of leader's size, or fixed fraction of allocation), max leverage, max notional per market, allowed markets (BTC, ETH, SOL, MON, HYPE, ZEC, LIT, VVV, PUMP, NEAR, UNI), daily loss stop (%), high-water-mark stop (%), expiry (date).
- Copies land fast: show latency per copy ("copied in 0.61 s"), commit state (Proposed → Voted → Finalized), and a tx link (monadvision.com/tx/0x…).
- "Blocked by your rule": when a leader's trade would break a rule, the contract rejects it; the app shows which rule and the numbers (e.g. "Leader opened 20x BTC long. Your max leverage is 5x. Not copied.").
- Positions & PnL with attribution per leader; pause following, close all positions, withdraw (gasless — user never needs MON).
- Per-account deposit cap (contract is unaudited): e.g. "Deposit limit 25 AUSD during beta".

## Visual direction
Calm, precise, trustworthy fintech (think Revolut/Robinhood clarity, Linear-level craft), not neon degen. Numbers are the hero. Generous whitespace, strong typographic hierarchy, tabular numerals. Green/red only for PnL and states, never decoration. Rounded but not bubbly (radius 12–16 on cards, 999 on pills).

## Tokens (use exactly; both themes)
Light: bg #F6F6F3 · surface #FFFFFF · surface-2 #EFEFEA · text #0E0F12 · text-muted #5B606B · border #E3E3DE · accent #4B3BFF · accent-soft #ECEAFF · positive #11914B · negative #D93A40 · warning #B7791F
Dark: bg #0A0B0E · surface #14161B · surface-2 #1B1E24 · text #F2F3F5 · text-muted #9097A3 · border #262A31 · accent #8B7DFF · accent-soft #221F3D · positive #3DD68C · negative #FF6369 · warning #FFB224
Type: "Inter" (UI), "JetBrains Mono" or "Geist Mono" for numbers/addresses/tx hashes, tabular-nums everywhere numbers appear. (Google Fonts.)

## Constraints
- App: NO motion anywhere. Android (Material-ish affordances: system back, bottom nav, bottom sheets). 390 px wide frames.
- Landing page: motion allowed and expected (this is the only surface with motion).
- Don't use Monad's or Perpl's logos/brand colours as our brand; we may name them in text ("Built on Monad", "Trades on Perpl", "Balance in AUSD by Agora", "Passkeys by Mera").
