// Owner levels and stops in the dev mock: SET_LEVELS / CLOSE_MARKET actions, a level fired by a stranger
// (StopTriggered, the market halted until the next policy), seeds for the funded scenario, and
// GET /v1/accounts/:account/stops. State is kept in the app's types; wire.mjs serves the engine's shapes
// (account `levels[]` with side "long" | "short", `policy.markets[].halted`, feed `keeper` / `reason` / `data`).
import { decodeAbiParameters, getAddress } from "viem";
import { LEVELS_PARAM } from "../src/lib/contracts.ts";
import { byPerp, bySymbol, lns, pns, txHash } from "./data.mjs";

/** The stranger in the design ("0x12…ab"): any address may execute a level once it is hit. */
export const STRANGER = getAddress("0x12f4a9c03b7e5d1a6c8e2f0b9d4a7c3e5b1f80ab");
const SIDE = ["long", "short"];

export function makeStops({ ev, upnl }) {
  const levelsOf = (a) => (a.levels ??= new Map());
  const haltedOf = (a) => (a.halted ??= new Set());

  function setLevel(a, perpId, side, sl, tp, slip) {
    if (sl === 0n && tp === 0n) levelsOf(a).delete(perpId);
    else levelsOf(a).set(perpId, { perpId, side, stopLossPNS: sl.toString(), takeProfitPNS: tp.toString(), slippageBps: slip });
  }
  const levelEvent = (a, perpId, side, sl, tp, slip, ageMs = 0, state = "proposed") =>
    ev(a, "LevelSet", { perpId, data: { side: SIDE.indexOf(side), stopLossPNS: sl.toString(), takeProfitPNS: tp.toString(), slippageBps: slip } }, ageMs, state);

  /** Realise a position's PnL into the account (what a reduce-only close does). */
  function closePos(a, p) {
    const pnl = upnl(p);
    a.collateral += pnl;
    a.realisedByLeader.set(p.leaderAccountId, (a.realisedByLeader.get(p.leaderAccountId) ?? 0n) + pnl);
    a.positions = a.positions.filter((x) => x !== p);
    return pnl;
  }

  /** ACTION_SET_LEVELS: the contract's _setLevels checks, then LevelSet per level. */
  function actSetLevels(a, data) {
    const [lvls] = decodeAbiParameters([LEVELS_PARAM], data);
    const events = [];
    for (const l of lvls) {
      const sl = BigInt(l.stopLossPNS), tp = BigInt(l.takeProfitPNS), side = SIDE[Number(l.side)];
      if (!(sl === 0n && tp === 0n)) {
        if (Number(l.side) > 1) return { error: 'InvalidLevel("side")' };
        if (l.slippageBps === 0 || l.slippageBps > 2000) return { error: 'InvalidLevel("slippageBps")' };
        if (sl !== 0n && tp !== 0n && (side === "long" ? sl >= tp : sl <= tp)) return { error: 'InvalidLevel("order")' };
      }
      setLevel(a, Number(l.perpId), side, sl, tp, Number(l.slippageBps));
      events.push(levelEvent(a, Number(l.perpId), side, sl, tp, Number(l.slippageBps)));
    }
    return { events };
  }

  /** ACTION_CLOSE_MARKET: reduce-only close of the whole position. */
  function actCloseMarket(a, data) {
    const [perpId, slip] = decodeAbiParameters([{ type: "uint32" }, { type: "uint16" }], data);
    if (slip === 0 || slip > 2000) return { error: 'InvalidPolicy("slippageBps")' };
    const p = a.positions.find((x) => x.perpId === Number(perpId));
    if (!p) return { error: "NothingToClose()" };
    const lots = p.lots;
    closePos(a, p);
    return { events: [ev(a, "MarketClosed", { perpId: Number(perpId), data: { slippageBps: slip, lotsBefore: lots.toString(), lotsAfter: "0" } }, 0, "proposed")] };
  }

  /** triggerLevel(perpId) by `keeper`: closes the position, halts the market, deletes the level. */
  function trigger(a, perpId, keeper = STRANGER, ageMs = 0, state = "proposed") {
    const lv = levelsOf(a).get(perpId);
    const p = a.positions.find((x) => x.perpId === perpId);
    if (!lv || !p) return null;
    const mark = byPerp[perpId].markPNS;
    const tp = BigInt(lv.takeProfitPNS);
    const kind = tp !== 0n && (p.side === "long" ? mark >= tp : mark <= tp) ? "TakeProfit" : "StopLoss";
    const level = kind === "TakeProfit" ? lv.takeProfitPNS : lv.stopLossPNS;
    haltedOf(a).add(perpId);
    const lots = p.lots;
    closePos(a, p);
    levelsOf(a).delete(perpId);
    return ev(a, "StopTriggered", { perpId, reason: kind, keeper, limit: level, actual: mark.toString(), data: { kind, scope: perpId, caller: keeper, limit: level, actual: mark.toString(), oraclePNS: mark.toString(), closed: lots.toString() } }, ageMs, state);
  }

  /** Funded scenario: the design's levels, one take-profit executed by a stranger, one close by the owner. */
  function seed(a1, a2, a3, mir) {
    const P = (s, v) => pns(s, v);
    const b = bySymbol.BTC.perpId, sol = bySymbol.SOL.perpId, eth = bySymbol.ETH.perpId, mon = bySymbol.MON.perpId;
    setLevel(a1, b, "long", P("BTC", 108450.0), P("BTC", 141456.0), 300);
    levelEvent(a1, b, "long", P("BTC", 108450.0), P("BTC", 141456.0), 300, 100 * 60e3, "finalized");
    setLevel(a1, sol, "long", P("SOL", 182.25), P("SOL", 237.72), 300);
    levelEvent(a1, sol, "long", P("SOL", 182.25), P("SOL", 237.72), 300, 90 * 60e3, "finalized");
    setLevel(a2, eth, "short", P("ETH", 4698.0), P("ETH", 3480.0), 300);
    levelEvent(a2, eth, "short", P("ETH", 4698.0), P("ETH", 3480.0), 300, 150 * 60e3, "finalized");
    // a3: MON short copied, take-profit set, then executed by a stranger once the mark reached it.
    mir(a3, 7 * 3600e3, "MON", "short", "open", 220, 0.0442, 300);
    const lots = lns("MON", 220);
    a3.positions.push({ perpId: mon, side: "short", lots, entry: P("MON", 0.0442), lev: 300, leaderAccountId: a3.leaderAccountId });
    setLevel(a3, mon, "short", 0n, P("MON", 0.0418), 300);
    levelEvent(a3, mon, "short", 0n, P("MON", 0.0418), 300, 6.5 * 3600e3, "finalized");
    const saved = byPerp[mon].markPNS;
    byPerp[mon].markPNS = P("MON", 0.0417);
    trigger(a3, mon, STRANGER, 5 * 3600e3, "finalized");
    byPerp[mon].markPNS = saved;
    // a1: an ETH long the owner closed with Close position yesterday.
    mir(a1, 30 * 3600e3, "ETH", "long", "open", 0.002, 4280.0, 300);
    ev(a1, "MarketClosed", { perpId: eth, data: { slippageBps: 300, lotsBefore: lns("ETH", 0.002).toString(), lotsAfter: "0" } }, 26 * 3600e3, "finalized");
  }

  /** Engine executor attempts (stop_triggers rows); levels fired by others are only in the feed. */
  const stopsFor = (a) => ({ items: (a.stopAttempts ?? []).slice().reverse() });

  return { levelsOf, haltedOf, actSetLevels, actCloseMarket, trigger, seed, stopsFor, txHash };
}
