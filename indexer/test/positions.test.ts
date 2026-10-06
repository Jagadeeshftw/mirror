import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

import { DAY, ETH, LONG, SHORT, T0, Timeline, chain143, usd } from "./helpers.js";

describe("Perpl position lifecycle", () => {
  it("open -> increase -> decrease -> close: positions, trade history, derived prices, stats", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    const A = 7n;
    tl.tx(T0 + 100).open(A, ETH, LONG, 1000n, 300000n, { lev: 500n, fee: 1050n }); // 1 ETH @ 3000
    tl.tx(T0 + 200).increase(A, ETH, LONG, 1000n, 2000n, 305000n, { lev: 1000n, fee: 1000n }); // fill 3100
    tl.tx(T0 + 300).decrease(A, ETH, LONG, 2000n, 1500n, usd(50), -200_000n); // exit 3150
    tl.tx(T0 + 400).close(A, ETH, LONG, 290000n, usd(-225), 100_000n); // 1.5 ETH @ 2900
    await indexer.process(chain143(tl.items));

    const events = (await indexer.PositionEvent.getAll()).sort((a, b) => a.blockNumber - b.blockNumber);
    expect(events.map((e) => e.kind)).toEqual(["OPEN", "INCREASE", "DECREASE", "CLOSE"]);
    expect(events.map((e) => [e.lotsBeforeLNS, e.lotsAfterLNS])).toEqual([
      [0n, 1000n],
      [1000n, 2000n],
      [2000n, 1500n],
      [1500n, 0n],
    ]);
    expect(events.map((e) => e.pricePNS)).toEqual([300000n, 310000n, 315000n, 290000n]);
    expect(events.map((e) => e.priceSource)).toEqual(["EVENT", "DERIVED_FROM_ENTRY", "DERIVED_FROM_PNL", "EVENT"]);
    expect(events.map((e) => e.notionalCNS)).toEqual([usd(3000), usd(3100), usd(1575), usd(4350)]);
    expect(events[2]!.realizedPnlCNS).toBe(usd(50));
    expect(events[2]!.fundingCNS).toBe(-200_000n);
    expect(events[3]!.lotsClosedLNS).toBe(1500n);
    expect(events[0]!.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const pos = await indexer.Position.getOrThrow(`${A}-20`);
    expect(pos.isOpen).toBe(false);
    expect(pos.lotsLNS).toBe(0n);
    expect(pos.realizedPnlCNS).toBe(usd(-175));
    expect(pos.trades).toBe(4);

    const s = await indexer.LeaderStats.getOrThrow(String(A));
    expect(s.trades).toBe(4);
    expect(s.openingTrades).toBe(2);
    expect(s.closingTrades).toBe(2);
    expect([s.wins, s.losses, s.winRateBps]).toEqual([1, 1, 5000]);
    expect(s.volumeCNS).toBe(usd(12025));
    expect(s.realizedPnlCNS).toBe(usd(-175));
    expect(s.fundingCNS).toBe(-100_000n);
    expect(s.feesCNS).toBe(2050n);
    expect(s.netPnlCNS).toBe(usd(-175) - 100_000n - 2050n);
    // notional-weighted: (5x * 3000 + 10x * 3100) / 6100
    expect(s.avgLeverageHdths).toBe(754);
    expect(s.openPositions).toBe(0);
    expect(s.marketsTraded).toEqual([20]);

    const market = await indexer.Market.getOrThrow("20");
    expect(market.symbol).toBe("ETH");
    expect(market.volumeCNS).toBe(usd(12025));
    expect(market.longLotsLNS).toBe(0n);
    expect(market.lastPricePNS).toBe(290000n);
  });

  it("invert closes the old side at the event price and opens the new one", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    const A = 8n;
    tl.tx(T0 + 10).open(A, ETH, SHORT, 1000n, 300000n);
    tl.tx(T0 + 20).invert(A, ETH, LONG, 1000n, 3000n, 290000n, usd(100), { fee: 30n });
    await indexer.process(chain143(tl.items));

    const pos = await indexer.Position.getOrThrow(`${A}-20`);
    expect([pos.side, pos.lotsLNS, pos.entryPricePNS, pos.isOpen]).toEqual(["LONG", 3000n, 290000n, true]);
    const inv = (await indexer.PositionEvent.getAll()).find((e) => e.kind === "INVERT")!;
    expect([inv.lotsClosedLNS, inv.lotsOpenedLNS, inv.lotsTradedLNS]).toEqual([1000n, 3000n, 4000n]);
    expect(inv.notionalCNS).toBe(usd(11600));
    const s = await indexer.LeaderStats.getOrThrow(String(A));
    expect([s.wins, s.losses, s.openPositions]).toEqual([1, 0, 1]);
    const market = await indexer.Market.getOrThrow("20");
    expect([market.longLotsLNS, market.shortLotsLNS]).toEqual([3000n, 0n]);
  });

  it("liquidation: posLotLNS is the size left, so lots before = liq + remaining", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    const A = 9n;
    tl.tx(T0 + 10).open(A, ETH, LONG, 3000n, 290000n);
    tl.tx(T0 + 20).liquidate(A, ETH, LONG, 1000n, 2000n, 250000n, usd(-40)); // partial
    tl.tx(T0 + 30).liquidate(A, ETH, LONG, 2000n, 0n, 245000n, usd(-90)); // full
    await indexer.process(chain143(tl.items));

    const liqs = (await indexer.PositionEvent.getAll()).filter((e) => e.kind === "LIQUIDATION").sort((a, b) => a.blockNumber - b.blockNumber);
    expect(liqs.map((e) => [e.lotsBeforeLNS, e.lotsAfterLNS, e.pricePNS])).toEqual([
      [3000n, 2000n, 250000n],
      [2000n, 0n, 245000n],
    ]);
    const s = await indexer.LeaderStats.getOrThrow(String(A));
    expect([s.liquidations, s.losses, s.openPositions]).toEqual([2, 2, 0]);
    expect(s.realizedPnlCNS).toBe(usd(-130));
    const pos = await indexer.Position.getOrThrow(`${A}-20`);
    expect(pos.isOpen).toBe(false);
  });

  it("a close for a position opened before the indexed range still counts PnL, with lots flagged unknown", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    tl.tx(T0 + 10).close(10n, ETH, LONG, 300000n, usd(5));
    await indexer.process(chain143(tl.items));
    const e = (await indexer.PositionEvent.getAll())[0]!;
    expect([e.lotsKnown, e.lotsTradedLNS, e.notionalCNS, e.realizedPnlCNS]).toEqual([false, 0n, 0n, usd(5)]);
    const s = await indexer.LeaderStats.getOrThrow("10");
    expect([s.wins, s.openPositions]).toEqual([1, 0]);
  });
});

describe("win rate and max drawdown of the realized equity curve", () => {
  it("tracks peak, drawdown (absolute and vs capital base) and win rate", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    const A = 11n;
    tl.tx(T0 + 1).deposit(A, usd(1000), usd(1000));
    let t = T0 + 10;
    for (const pnl of [100, -300, 50, -20]) {
      tl.tx(t++).open(A, ETH, LONG, 1000n, 300000n);
      tl.tx(t++).close(A, ETH, LONG, 300000n + BigInt(pnl * 100), usd(pnl));
    }
    await indexer.process(chain143(tl.items));
    const s = await indexer.LeaderStats.getOrThrow(String(A));
    expect(s.netPnlCNS).toBe(usd(-170));
    expect(s.peakNetPnlCNS).toBe(usd(100));
    expect(s.maxDrawdownCNS).toBe(usd(300));
    expect(s.maxDrawdownBps).toBe(2727); // 300 / (1000 + 100)
    expect(s.capitalBaseCNS).toBe(usd(1000));
    expect(s.pnlBps).toBe(-1700);
    expect([s.wins, s.losses, s.winRateBps]).toEqual([2, 2, 5000]);

    const day = await indexer.DailyAccountStats.getOrThrow(`${A}-${T0 / DAY}`);
    expect(day.maxIntradayDrawdownCNS).toBe(usd(300));
    expect([day.highCumPnlCNS, day.lowCumPnlCNS, day.endCumPnlCNS]).toEqual([usd(100), usd(-200), usd(-170)]);
    const eq = await indexer.EquityPoint.getOrThrow(`${A}-${T0 / DAY}`);
    expect(eq.equityCNS).toBe(usd(830));
    expect(eq.drawdownCNS).toBe(usd(270));
  });
});

describe("windowed stats (7d / 30d / 90d)", () => {
  it("computes windows from daily rows and keeps updating them incrementally within the day", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    const A = 12n;
    const trade = (ts: number, pnl: number) => {
      tl.tx(ts).open(A, ETH, LONG, 1000n, 300000n, { lev: 200n });
      tl.tx(ts + 1).close(A, ETH, LONG, 300000n + BigInt(pnl * 100), usd(pnl));
    };
    trade(T0 - 40 * DAY, 1000);
    trade(T0 - 10 * DAY, -200);
    trade(T0 + 60, 50);
    trade(T0 + 120, -30); // incremental path (windows already current for today)
    await indexer.process(chain143(tl.items));

    const w = async (id: string) => indexer.LeaderWindowStats.getOrThrow(`${A}-${id}`);
    const [d7, d30, d90] = await Promise.all([w("D7"), w("D30"), w("D90")]);
    const today = T0 / DAY;
    expect([d7.asOfDay, d30.asOfDay, d90.asOfDay]).toEqual([today, today, today]);
    expect(d7.netPnlCNS).toBe(usd(20));
    expect(d30.netPnlCNS).toBe(usd(-180));
    expect(d90.netPnlCNS).toBe(usd(820));
    expect([d7.trades, d30.trades, d90.trades]).toEqual([4, 6, 8]);
    expect([d7.wins, d7.losses, d7.winRateBps]).toEqual([1, 1, 5000]);
    expect([d30.activeDays, d90.activeDays]).toEqual([2, 3]);
    // D90 path: 0 -> 1000 (peak) -> 800 -> 850 -> 820: drawdown 200
    expect(d90.maxDrawdownCNS).toBe(usd(200));
    // D30 starts at 1000: -> 800 -> 850 -> 820: drawdown 200
    expect(d30.maxDrawdownCNS).toBe(usd(200));
    // D7 starts at 800: -> 850 -> 820: drawdown 30
    expect(d7.maxDrawdownCNS).toBe(usd(30));
    expect(d7.avgLeverageHdths).toBe(200);

    const curve = (await indexer.EquityPoint.getAll()).filter((p) => p.accountId === A).sort((a, b) => a.day - b.day);
    expect(curve.map((p) => p.cumulativeNetPnlCNS)).toEqual([usd(1000), usd(800), usd(820)]);
  });
});

describe("team-run exclusion (Perpl side)", () => {
  it("routes team-run account activity to TeamRunStats only", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    tl.tx(T0 + 1).open(999n, ETH, LONG, 1000n, 300000n); // 999 is team-run (ENVIO_TEAM_RUN_ACCOUNT_IDS)
    tl.tx(T0 + 2).open(5n, ETH, LONG, 1000n, 300000n);
    await indexer.process(chain143(tl.items));
    const g = await indexer.GlobalStats.getOrThrow("global");
    const tr = await indexer.TeamRunStats.getOrThrow("teamRun");
    expect([g.perplAccounts, g.perplTrades, g.perplVolumeCNS]).toEqual([1, 1, usd(3000)]);
    expect([tr.perplAccounts, tr.perplTrades, tr.perplVolumeCNS]).toEqual([1, 1, usd(3000)]);
    expect((await indexer.LeaderStats.getOrThrow("999")).teamRun).toBe(true);
    expect((await indexer.LeaderStats.getOrThrow("5")).teamRun).toBe(false);
  });
});
