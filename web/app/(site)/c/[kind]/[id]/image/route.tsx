/**
 * Share card image: /c/leader/<id>/image, /c/follower/<account>/image, /c/blocked/<txHash>/image?a=<account>,
 * /c/sim/<leaderId>/image?<limits>. Query: f=og|sq (size), t=light|dark, amounts=0 (percentages only).
 * Rendered from live engine data on every request (short CDN cache); "not available" when the engine can't answer.
 */
import { cardImage } from "@/lib/cards/image";
import { loadCard } from "@/lib/cards/load";
import { formatOf, isKind, themeOf, type CardRequest } from "@/lib/cards/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!isKind(kind)) return new Response("Not found", { status: 404 });
  const search = new URL(request.url).searchParams;
  const req: CardRequest = { kind, id: decodeURIComponent(id), search };
  const model = await loadCard(req);
  return cardImage(model, formatOf(req), themeOf(search));
}
