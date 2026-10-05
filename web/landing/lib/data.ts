/**
 * Illustrative data for the landing page mockups. Not live.
 * Shapes match what the app shows (latency per copy, commit state, tx link,
 * "blocked by your rule" with the rule and the numbers).
 */

export type CopyEvent =
  | {
      kind: "copied";
      id: string;
      market: string;
      side: "Long" | "Short";
      lev: string;
      size: string;
      leader: string;
      latency: string;
      tx: string;
    }
  | {
      kind: "blocked";
      id: string;
      market: string;
      side: "Long" | "Short";
      lev: string;
      leader: string;
      rule: string;
      detail: string;
    };

export const COPY_EVENTS: CopyEvent[] = [
  { kind: "copied", id: "e1", market: "BTC", side: "Long", lev: "3x", size: "6.00", leader: "0x7a3e…41f3", latency: "0.61", tx: "0x3f9c…a21e" },
  { kind: "copied", id: "e2", market: "ETH", side: "Short", lev: "2x", size: "4.20", leader: "0xc19b…07de", latency: "0.58", tx: "0x81d2…4c90" },
  { kind: "blocked", id: "e3", market: "BTC", side: "Long", lev: "20x", leader: "0x7a3e…41f3", rule: "Max leverage", detail: "Leader opened 20x BTC long. Your max leverage is 5x. Not copied." },
  { kind: "copied", id: "e4", market: "SOL", side: "Long", lev: "4x", size: "3.00", leader: "0x7a3e…41f3", latency: "0.64", tx: "0x0b7e…f3a1" },
  { kind: "copied", id: "e5", market: "MON", side: "Long", lev: "2x", size: "2.50", leader: "0x5e02…9ab4", latency: "0.59", tx: "0xd4a0…13bc" },
  { kind: "blocked", id: "e6", market: "PUMP", side: "Long", lev: "3x", leader: "0xc19b…07de", rule: "Allowed markets", detail: "Leader opened PUMP long. PUMP is not in your allowed markets. Not copied." },
  { kind: "copied", id: "e7", market: "HYPE", side: "Short", lev: "3x", size: "3.60", leader: "0xc19b…07de", latency: "0.62", tx: "0x6c3f…8e07" },
  { kind: "blocked", id: "e8", market: "ETH", side: "Long", lev: "4x", leader: "0x5e02…9ab4", rule: "Max notional", detail: "Copy would be 14.00 AUSD of ETH. Your max per market is 10.00 AUSD. Not copied." },
];

export const MARKETS = ["BTC", "ETH", "SOL", "MON", "HYPE", "ZEC", "LIT", "VVV", "PUMP", "NEAR", "UNI"];

export type Leader = {
  rank: number;
  address: string;
  label: string;
  pnl30: number;
  pnl7: number;
  drawdown: number;
  winRate: number;
  consistency: number;
  followers: number;
  spark: number[];
};

export const LEADERS: Leader[] = [
  { rank: 1, address: "0x7a3e…41f3", label: "Smart Trader", pnl30: 38.2, pnl7: 6.4, drawdown: 6.1, winRate: 64, consistency: 92, followers: 214, spark: [10, 11, 10.6, 12, 12.8, 12.2, 13.6, 14.1, 13.8, 15.2, 16, 15.7, 17.1, 18] },
  { rank: 2, address: "0xc19b…07de", label: "Fund", pnl30: 24.7, pnl7: 3.1, drawdown: 4.3, winRate: 58, consistency: 88, followers: 167, spark: [10, 10.4, 10.9, 10.7, 11.5, 11.9, 12.2, 12, 12.8, 13.1, 13.4, 13.9, 13.7, 14.2] },
  { rank: 3, address: "0x5e02…9ab4", label: "Smart Trader", pnl30: 19.5, pnl7: -1.2, drawdown: 9.8, winRate: 55, consistency: 79, followers: 98, spark: [10, 10.8, 11.6, 11.1, 12.4, 12.9, 12.1, 13.2, 13.9, 13.2, 12.7, 13.4, 12.9, 12.6] },
  { rank: 4, address: "0x9d41…c2e8", label: "Cross-venue", pnl30: 14.9, pnl7: 2.2, drawdown: 7.4, winRate: 61, consistency: 81, followers: 73, spark: [10, 10.2, 10.1, 10.9, 11.3, 11.1, 11.8, 12.1, 11.9, 12.4, 12.3, 12.8, 13, 13.3] },
  { rank: 5, address: "0x2b77…5f10", label: "Whale", pnl30: 11.3, pnl7: 4.8, drawdown: 12.6, winRate: 52, consistency: 70, followers: 51, spark: [10, 9.4, 10.2, 11, 10.3, 11.4, 10.8, 11.9, 11.2, 12.3, 11.8, 12.9, 12.4, 13.1] },
];
