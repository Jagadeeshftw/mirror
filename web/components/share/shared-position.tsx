"use client";
/**
 * The friend's page body (design proposal-2 #share, 07a / 07b): the read-only card, the suggestion form with live
 * "% from entry" and the estimated AUSD result if hit, then "Suggestion sent". Posts straight to the engine
 * (POST /v1/share/:id/suggest); no sign-in, no cookies, no analytics. The card refreshes every 15 s so a revoke or a
 * closed position shows up without reloading.
 */
import { IconCircleCheck } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { ausdSigned, checkSuggestion, fmtPrice, movePct, noteLength, parsePrice, pctText, resultAtCNS, type SharedCard } from "@/lib/share/levels";
import { cn } from "@/lib/utils";
import { PositionCard } from "./position-card";

const NOTE_MAX = 140;
const Z = BigInt(0);

type Sent = { stopLossPNS: string | null; takeProfitPNS: string | null; prevStopLossPNS: string; prevTakeProfitPNS: string; note: string };

function LevelField({ id, label, value, onChange, hint, sub, bad }: { id: string; label: string; value: string; onChange: (v: string) => void; hint: string; sub: string | null; bad: boolean }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
      <div className={cn("flex h-12 items-center gap-2 rounded-xl border bg-background px-3.5", bad ? "border-negative" : "border-border focus-within:border-brand")}>
        <input id={id} data-testid={`share.${id}`} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Price" className="min-w-0 flex-1 bg-transparent font-mono text-base outline-none placeholder:text-muted-foreground/70" />
        <span className="shrink-0 text-right text-xs text-muted-foreground" data-testid={`share.${id}.hint`}>{hint}</span>
      </div>
      {sub ? <span className="text-right font-mono text-xs text-muted-foreground" data-testid={`share.${id}.result`}>{sub}</span> : null}
    </div>
  );
}

export function SharedPosition({ initial, id, api, verifyHref }: { initial: SharedCard; id: string; api: string; verifyHref: string | null }) {
  const [card, setCard] = useState(initial);
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  useEffect(() => {
    if (!api) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${api}/v1/share/${id}`, { cache: "no-store", credentials: "omit" });
        if (r.ok) setCard((await r.json()) as SharedCard);
      } catch {
        /* keep the last card */
      }
    }, 15_000);
    return () => clearInterval(t);
  }, [api, id]);

  const dec = card.priceDecimals;
  const entry = BigInt(card.entryPNS ?? "0");
  const slP = parsePrice(sl, dec);
  const tpP = parsePrice(tp, dec);
  const hint = (p: bigint | null) => {
    if (p === null) return "Not a price";
    if (p === Z) return "Optional";
    return `${pctText(movePct(entry, p, card.side))} from entry`;
  };
  const result = (p: bigint | null) => (p ? `If hit: about ${ausdSigned(resultAtCNS(card, p))} AUSD` : null);
  const check = slP !== null && tpP !== null ? checkSuggestion(card, slP, tpP) : null;
  const n = noteLength(note);
  const canSend = card.status === "open" && slP !== null && tpP !== null && !check && n <= NOTE_MAX && !busy;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${api}/v1/share/${id}/suggest`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(slP ? { stopLossPNS: slP.toString() } : {}), ...(tpP ? { takeProfitPNS: tpP.toString() } : {}), ...(note.trim() ? { note } : {}) }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) setSent(body as Sent);
      else if (r.status === 429) setError("One suggestion per link per hour. Try again later.");
      else if (r.status === 410) {
        setError(body.error ?? "This link no longer takes suggestions.");
        setCard((c) => ({ ...c, status: body.code === "revoked" ? "revoked" : "closed" }));
      } else setError(body.error ?? `Mirror answered ${r.status}.`);
    } catch {
      setError("Can't reach Mirror. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    const row = (k: string, v: string, tid: string) => (
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
        <span className="text-sm text-muted-foreground">{k}</span>
        <span className="min-w-0 truncate text-right font-mono text-sm" data-testid={tid}>{v}</span>
      </div>
    );
    const change = (prev: string, next: string | null) => (next ? `${prev !== "0" ? fmtPrice(prev, dec) : "none"} → ${fmtPrice(next, dec)}` : `${prev !== "0" ? fmtPrice(prev, dec) : "none"} (unchanged)`);
    return (
      <div className="grid gap-4" data-testid="share.sent">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-positive/15 text-positive"><IconCircleCheck size={30} aria-hidden /></div>
        <h1 className="text-center text-2xl font-semibold tracking-tight">Suggestion sent</h1>
        <p className="text-center text-sm text-muted-foreground">The owner can accept or decline it in Mirror. If they accept, the levels below become onchain levels on this position.</p>
        <div className="rounded-2xl border border-border bg-card">
          {row("Stop-loss", change(sent.prevStopLossPNS, sent.stopLossPNS), "share.sent.sl")}
          {row("Take-profit", change(sent.prevTakeProfitPNS, sent.takeProfitPNS), "share.sent.tp")}
          {sent.note ? row("Note", sent.note.length > 28 ? `${sent.note.slice(0, 26)}…` : sent.note, "share.sent.note") : null}
          {row("Status", "Waiting for the owner", "share.sent.status")}
        </div>
        <PositionCard c={card} verifyHref={verifyHref} />
        <p className="text-center text-xs text-muted-foreground">This page stays live. It stops taking suggestions when the position closes.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-start md:gap-6">
      <div className="grid gap-3">
        <div className="font-mono text-xs uppercase tracking-[0.12em] text-brand">Shared position</div>
        <PositionCard c={card} verifyHref={verifyHref} />
      </div>
      {card.status === "open" ? (
        <form onSubmit={send} noValidate className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:mt-7" data-testid="share.form">
          <b className="font-semibold">Suggest levels</b>
          <p className="-mt-1 text-xs text-muted-foreground">The owner sees your suggestion and decides. Nothing changes unless they approve it with their passkey.</p>
          <LevelField id="sl" label="Stop-loss" value={sl} onChange={setSl} hint={hint(slP)} sub={result(slP)} bad={slP === null || check?.field === "sl"} />
          <LevelField id="tp" label="Take-profit" value={tp} onChange={setTp} hint={hint(tpP)} sub={result(tpP)} bad={tpP === null || check?.field === "tp"} />
          <div className="grid gap-1.5">
            <label htmlFor="note" className="text-xs text-muted-foreground">Short note (optional)</label>
            <textarea id="note" data-testid="share.note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={cn("min-h-[72px] resize-none rounded-xl border bg-background px-3.5 py-3 text-sm outline-none", n > NOTE_MAX ? "border-negative" : "border-border focus:border-brand")} />
            <div className={cn("text-right font-mono text-xs", n > NOTE_MAX ? "text-negative" : "text-muted-foreground")} data-testid="share.note.count">{n} / {NOTE_MAX}</div>
          </div>
          {check && (sl || tp) ? <p className="text-xs text-negative" data-testid="share.check">{check.message}</p> : null}
          {error ? <p className="text-sm text-negative" role="alert" data-testid="share.error">{error}</p> : null}
          <button type="submit" disabled={!canSend} data-testid="share.send" className="h-12 rounded-full bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? "Sending…" : "Send suggestion"}
          </button>
        </form>
      ) : (
        <div className="grid gap-2 rounded-2xl border border-border bg-card p-4 md:mt-7" data-testid="share.ended">
          <b className="font-semibold" data-testid="share.ended.title">{card.status === "revoked" ? "Link revoked" : "Position closed"}</b>
          <p className="text-sm text-muted-foreground">{card.status === "revoked" ? "The owner revoked this link. It no longer takes suggestions." : "The position this link showed has closed. The link no longer takes suggestions."}</p>
          {error ? <p className="text-sm text-negative" role="alert" data-testid="share.error">{error}</p> : null}
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground md:col-span-2">No sign-in. We don&apos;t store who you are. One suggestion per link per hour.</p>
    </div>
  );
}
