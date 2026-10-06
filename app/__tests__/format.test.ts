import { ago, ausd, ausdSigned, bps, formatFixed, groupedAddress, latency, leverage, lots, notionalCNS, parseUnits, pctSigned, price, shortAddr, usdCompact } from "../src/lib/format";

describe("AUSD (6 decimals)", () => {
  it("formats raw units", () => {
    expect(ausd("21370000")).toBe("21.37");
    expect(ausd(12_345_678n)).toBe("12.35");
    expect(ausd("1234567890123")).toBe("1,234,567.89");
    expect(ausd(0n)).toBe("0.00");
    expect(ausd("5", 6)).toBe("0.000005");
  });
  it("signs with a true minus", () => {
    expect(ausdSigned("920000")).toBe("+0.92");
    expect(ausdSigned("-450000")).toBe("−0.45");
    expect(ausdSigned("-4000")).toBe("+0.00"); // rounds to zero: no negative zero
  });
  it("rounds half away from zero", () => {
    expect(formatFixed(125n, 2, 1)).toBe("1.3");
    expect(formatFixed(-125n, 2, 1)).toBe("−1.3");
  });
  it("parses user input without floats", () => {
    expect(parseUnits("12.5", 6)).toBe(12_500_000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits("0.0000001", 6)).toBeNull();
    expect(parseUnits("abc", 6)).toBeNull();
    expect(parseUnits("25", 6)).toBe(25_000_000n);
  });
});

describe("per-market lots and prices", () => {
  it("BTC: 5 lot decimals, 1 price decimal", () => {
    expect(lots("15", 5)).toBe("0.00015");
    expect(price("1184025", 1)).toBe("118,402.5");
  });
  it("MON: 0 lot decimals, 6 price decimals", () => {
    expect(lots("220", 0)).toBe("220");
    expect(price("41800", 6)).toBe("0.041800");
  });
  it("notional = lots * price scaled to 6 decimals", () => {
    // 0.00015 BTC @ 118,402.5 = 17.760375 AUSD
    expect(notionalCNS(15n, 1184025n, 5, 1)).toBe(17_760_375n);
    // 220 MON @ 0.0418 = 9.196 AUSD
    expect(notionalCNS(220n, 41800n, 0, 6)).toBe(9_196_000n);
  });
});

describe("misc", () => {
  it("leverage, bps, percent", () => {
    expect(leverage(500)).toBe("5x");
    expect(leverage(450)).toBe("4.5x");
    expect(leverage(1500)).toBe("15x");
    expect(bps(50)).toBe("0.5%");
    expect(bps(1000)).toBe("10%");
    expect(bps(5)).toBe("0.05%");
    expect(bps(25)).toBe("0.25%");
    expect(pctSigned(38.44)).toBe("+38.4%");
    expect(pctSigned(-1.3)).toBe("−1.3%");
    expect(usdCompact(212400, true)).toBe("+$212.4k");
    expect(usdCompact(-7200)).toBe("−$7.2k");
  });
  it("addresses, latency, time", () => {
    expect(shortAddr("0x4b21C7e05A93d1F2bE6c8a04D71f3e2290a19e07")).toBe("0x4b21…9e07");
    expect(groupedAddress("0x4b21C7e05A93d1F2bE6c8a04D71f3e2290a19e07")).toBe("0x4b21 C7e0 5A93 d1F2 bE6c 8a04 D71f 3e22 90a1 9e07");
    expect(latency(610)).toBe("0.61 s");
    expect(ago(1000, 5000)).toBe("4s");
    expect(ago(0, 38 * 60 * 1000)).toBe("38m");
  });
});
