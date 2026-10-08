# Funding (Monad mainnet)

Caps: at most 30 USD parked in total, under 10 USD actually spent.

**Status 8 Oct 2026:** the ops wallet holds 197.66 MON (enough for the deploy, worst case 2.19 MON, and the whole budget below) and Perpl account 5416 holds the demo leader's 10.00 AUSD. Still needed: 10.00 AUSD for the demo follower's passkey address. The ordered checklist, with exact commands, is [runbook-mainnet.md](./runbook-mainnet.md).

## Send to the ops wallet

One EOA does every team-run job: it deploys the contracts, is the keeper and the relayer, is the team-run demo leader, and pays for Nansen x402 calls.

```
0x299E77E58DD37607e4890C761924D829F8ACe82C
```

| Token (Monad mainnet) | Amount | For | Spent or parked |
|---|---|---|---|
| MON | **37** | Gas for about 1,240 transactions (breakdown below) | Spent. Whatever is left is recoverable. |
| USDC (`0x7547…b603`, native Circle) | **3.00** | Nansen API via x402: about 60 calls at $0.05, or 120+ at the first-100 discount. Covers the coverage check plus leader-ranking refreshes | Spent |
| AUSD (`0x0000…9012a`) | **10.00** | Team-run demo leader's Perpl account. 10.00 is Perpl's minimum deposit to open an account | Parked, recoverable with `withdrawCollateral` |

Later, a second address: **10.00 AUSD** to the team-run demo follower's passkey address. That address is shown in the app once the emulator passkey works. It funds the demo follower's MirrorAccount (Perpl minimum 10.00). Parked, recoverable with Withdraw.

**Totals:**
- **Parked:** 20.00 AUSD (about $20).
- **Spent:** about 37 MON (about $1.20 at $0.0325) + 3.00 USDC + Perpl trading fees (about $0.30 over 250 demo cycles) + swap slippage, so about **$4.5**.

### Why 10.00 AUSD per demo account is enough
10.00 AUSD is the smallest amount Perpl accepts to open an account (`getMinAccountOpenCNS()` = 10,000,000).

After opening:
- A 1-lot BTC copy (0.00001 BTC, about $0.86 notional) needs about $0.43 of margin at 2x.
- The blocked-trade cycle's leader order needs about $0.09 at 10x.
- Fees are about $0.0003 per side.

So 10.00 runs thousands of cycles. There is no maintenance minimum on the free balance.

The automated end-to-end runs use a local fork of mainnet with test funds, so they need no real AUSD.

## MON: measured gas, not a round number
Gas per transaction is measured in `contracts/test/fork/PerplMainnetFork.t.sol` (`test_fork_followMatchNowAndGasProfile`). The deploy figure is forge's estimate for `script/Deploy.s.sol`.

The budget assumes:
- each measured figure × 1.3 (cold storage) + 25k intrinsic gas;
- then × 1.2, because Monad charges the gas **limit**;
- a gas price of 102 gwei (base 100 + tip 2, read from `eth_gasPrice`).

| Item | Txs | Gas (M) | MON |
|---|---|---|---|
| Deploy registry, factory and implementation; register keeper | 3 | 7.97 | 0.81 |
| Team-run demo leader: approve and open Perpl account | 2 | 0.24 | 0.02 |
| Team-run demo follower: create, deposit, follow with match now | 3 | 1.49 | 0.15 |
| "Run demo trade" × 150: leader open/close + copy open/close | 600 | 171.7 | 17.51 |
| "Run blocked trade" × 100: leader open/close + blocked copy | 300 | 41.6 | 4.24 |
| External followers × 10 onboarded by the relayer | 30 | 14.9 | 1.52 |
| Keeper copies for external followers × 300 | 300 | 119.9 | 12.23 |
| **Total** | **1,238** | **357.8** | **36.5** |

No MON has to move between team wallets, because one EOA does every job. That also sidesteps Monad's 10 MON reserve rule for value transfers.

## Cheapest way to get each token onto Monad
1. **MON:** buy MON on an exchange that lists it with Monad-network withdrawals (Coinbase, Kraken, OKX and Bybit list MON). Withdraw straight to the address above in one step.
   - Some exchanges set a minimum withdrawal above 37 MON. If so, withdraw the minimum; the extra stays recoverable.
2. **USDC:**
   - Withdraw USDC on the Monad network if your exchange offers it.
   - Otherwise, move USDC from Base, Arbitrum or Ethereum with Circle CCTP V2. It is native burn-and-mint, Monad is CCTP domain 15, there is no wrapped token, and receiving needs no MON.
   - Bring about **24 USDC**: 3 for Nansen + about 20.2 to swap into AUSD + headroom.
3. **AUSD:**
   - On Monad, swap about 20.2 USDC → AUSD in your own wallet (for example on Kuru, Uniswap, or any aggregator that routes the AUSD/USDC pool). AUSD is not sold by most exchanges, and Ramp Network needs KYC.
   - Then send 10.00 AUSD to the ops wallet now, and keep 10.00 for the demo follower address later.
   - I can't make swaps or transfers for you; these are steps you run yourself.
