/**
 * Shared position link (design proposal-2 #share): a friend opens /p/<id>, sees the position read-only and may
 * suggest a stop-loss and take-profit with a short note. No login, no tracking, not indexed. Revoked and closed links
 * show that state without numbers. Data: engine GET /v1/share/:id (docs/api.md "Shared positions").
 */
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SharedPosition } from "@/components/share/shared-position";
import { API_BASE, API_CONFIGURED } from "@/lib/site";
import type { SharedCard } from "@/lib/share/levels";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };
type Load = { ok: true; card: SharedCard; verify: string | null } | { ok: false; status: number; message: string };

const validId = (id: string) => /^[A-Za-z0-9_-]{43}$/.test(id) || /^0x[0-9a-fA-F]{64}$/.test(id);

async function load(id: string): Promise<Load> {
  if (!validId(id)) return { ok: false, status: 404, message: "This link does not exist." };
  if (!API_CONFIGURED) return { ok: false, status: 503, message: "Mirror's server is not configured for this site." };
  try {
    const [r, cfg] = await Promise.all([
      fetch(`${API_BASE}/v1/share/${id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      fetch(`${API_BASE}/v1/config`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    if (r.status === 404) return { ok: false, status: 404, message: "This link does not exist." };
    if (!r.ok) return { ok: false, status: r.status, message: r.status === 429 ? "Mirror's server is busy. Try again in a minute." : `Mirror's server answered ${r.status}.` };
    const card = (await r.json()) as SharedCard;
    // Verify: the block the card was read at, on the network's explorer.
    const tx = typeof cfg?.explorerTx === "string" ? cfg.explorerTx : "";
    const verify = card.block && /\/tx\/?$/.test(tx) ? `${tx.replace(/\/tx\/?$/, "/block/")}${card.block}` : null;
    return { ok: true, card, verify };
  } catch {
    return { ok: false, status: 503, message: "Mirror's server didn't answer." };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const l = await load(id);
  const title = l.ok ? `Shared ${l.card.symbol} ${l.card.side}` : "Shared position";
  return {
    title,
    description: "A read-only position shared from Mirror. Suggest a stop-loss and take-profit; the owner decides.",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function SharedPositionPage({ params }: Props) {
  const { id } = await params;
  const l = await load(id);
  return (
    <>
      <SiteHeader />
      <main id="content" className="flex-1" data-testid="share.page">
        <div className="mx-auto w-full max-w-xl px-4 py-6 md:max-w-5xl md:px-8 md:py-12">
          {l.ok ? (
            <SharedPosition initial={l.card} id={id} api={API_BASE} verifyHref={l.verify} />
          ) : (
            <div className="grid gap-2 rounded-2xl border border-border bg-card p-6" data-testid="share.unavailable">
              <div className="font-mono text-xs uppercase tracking-[0.12em] text-brand">Shared position</div>
              <h1 className="text-xl font-semibold">{l.status === 404 ? "Link not found" : "Not available right now"}</h1>
              <p className="text-sm text-muted-foreground">{l.message}</p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
