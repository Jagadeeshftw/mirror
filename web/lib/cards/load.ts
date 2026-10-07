/**
 * Loads one share card from the engine: the same model feeds the image route and the landing page.
 * Anything that fails becomes the "not available" card with the reason; no numbers are invented.
 */
import "server-only";
import { SITE_URL } from "@/lib/site";
import { CardUnavailable, getConfig, getFeed, getJson, postJson } from "./engine";
import { blockedModel, ctxFromConfig, followerModel, leaderModel, simModel, unavailableModel, type Ctx } from "./model";
import { parseSimParams } from "./sim-params";
import { amountsOf, landingPath, type CardModel, type CardRequest } from "./types";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;

export async function loadCard(req: CardRequest): Promise<CardModel> {
  const cfg = await getConfig();
  const ctx = ctxFromConfig(cfg, SITE_URL + landingPath(req), amountsOf(req.search));
  try {
    switch (req.kind) {
      case "leader":
        if (!/^\d{1,12}$/.test(req.id)) throw new CardUnavailable("That is not a leader id.");
        return leaderModel(req.id, await getJson(`/v1/leaders/${req.id}?window=30d`), ctx);
      case "follower":
        return await loadFollower(req.id, ctx);
      case "blocked":
        return await loadBlocked(req, cfg, ctx);
      case "sim":
        return await loadSim(req, ctx);
    }
  } catch (e) {
    if (e instanceof CardUnavailable) return unavailableModel(req.kind, e.message, ctx);
    console.error("card", req.kind, req.id, e);
    return unavailableModel(req.kind, "This card could not be built.", ctx);
  }
}

async function loadFollower(account: string, ctx: Ctx): Promise<CardModel> {
  if (!ADDRESS.test(account)) throw new CardUnavailable("That is not an account address.");
  const acct = await getJson(`/v1/accounts/${account}`);
  const feed = await getFeed(account).catch(() => null);
  if (!feed) throw new CardUnavailable("The account's copies could not be read.");
  return followerModel(acct, feed.items, feed.complete, ctx);
}

async function loadBlocked(req: CardRequest, cfg: Record<string, any> | null, ctx: Ctx): Promise<CardModel> {
  if (!TX.test(req.id)) throw new CardUnavailable("That is not a transaction hash.");
  const fromQuery = req.search.get("a");
  const account = fromQuery && ADDRESS.test(fromQuery) ? fromQuery : cfg?.teamRun?.demoFollowerAccount;
  if (!account) throw new CardUnavailable("The account that recorded this block is not known.");
  const feed = await getFeed(account, 12);
  const item = feed.items.find((i) => i.kind === "Blocked" && String(i.txHash).toLowerCase() === req.id.toLowerCase());
  if (!item) throw new CardUnavailable("This blocked copy was not found in the account's feed.");
  const acct = await getJson(`/v1/accounts/${account}`).catch(() => null);
  let leaderAddr: string | null = null;
  if (item.leaderAccountId) leaderAddr = (await getJson(`/v1/leaders/${item.leaderAccountId}`).catch(() => null))?.address ?? null;
  return blockedModel(item, acct ?? { address: account, teamRun: isTeamRun(cfg, account) }, leaderAddr, ctx);
}

function isTeamRun(cfg: Record<string, any> | null, account: string): boolean {
  const list: string[] = [...(cfg?.teamRun?.addresses ?? []), cfg?.teamRun?.demoFollowerAccount].filter(Boolean).map((a: string) => a.toLowerCase());
  return list.includes(account.toLowerCase());
}

async function loadSim(req: CardRequest, ctx: Ctx): Promise<CardModel> {
  if (!/^\d{1,12}$/.test(req.id)) throw new CardUnavailable("That is not a leader id.");
  const body = parseSimParams(req.search);
  if (!body) throw new CardUnavailable("The limits for this simulation are missing from the link.");
  const [bt, leader] = await Promise.all([postJson(`/v1/leaders/${req.id}/backtest`, body), getJson(`/v1/leaders/${req.id}?window=30d`).catch(() => null)]);
  if (bt.simulation !== true && !Array.isArray(bt.equityCurve)) throw new CardUnavailable("The engine did not return a simulation.");
  return simModel(req.id, bt, leader, ctx);
}
