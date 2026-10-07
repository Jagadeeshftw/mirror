// Shared position links and suggestions in the dev mock (engine docs/api.md "Shared positions"): owner-signed
// ShareLink / ShareRevoke / ShareDecline, the sealed owner list (to the device key from /v1/push/register), accept by
// transaction, and /__mock/suggest to post a friend's suggestion for screenshots.
import { base64 } from "@scure/base";
import { recoverTypedDataAddress } from "viem";
import { seal } from "../src/lib/notifyKey.ts";
import { mirrorDomain } from "../src/lib/contracts.ts";

// Same typed data as src/lib/shareLink.ts (not imported: node cannot resolve its extensionless imports).
const td = (account, chainId, primaryType, fields, message) => ({ domain: mirrorDomain(account, chainId), types: { [primaryType]: fields }, primaryType, message });
const shareLinkTypedData = (a, c, perpId, linkId, deadline) => td(a, c, "ShareLink", [{ name: "perpId", type: "uint32" }, { name: "linkId", type: "bytes32" }, { name: "deadline", type: "uint256" }], { perpId, linkId, deadline });
const shareRevokeTypedData = (a, c, linkId, deadline) => td(a, c, "ShareRevoke", [{ name: "linkId", type: "bytes32" }, { name: "deadline", type: "uint256" }], { linkId, deadline });
const shareDeclineTypedData = (a, c, id, deadline) => td(a, c, "ShareDecline", [{ name: "suggestionId", type: "uint256" }, { name: "deadline", type: "uint256" }], { suggestionId: BigInt(id), deadline });
const urlIdOf = (linkId) => Buffer.from(linkId.slice(2), "hex").toString("base64url");

export function makeShare({ accounts, owners, chainId, lc, cs, send, readBody, broadcast, pushTo, posInfo }) {
  const links = new Map(); // linkId -> link
  const sugs = []; // suggestions
  const err = (res, status, code, error) => send(res, status, { error, code });
  const accountOf = (a) => accounts.get(lc(a));
  const sideOf = (s) => (s === 1 || s === "short" ? "short" : "long");
  const list = (a) => ({
    v: 1,
    account: cs(a.account),
    links: [...links.values()].filter((l) => lc(l.account) === lc(a.account)).map((l) => ({ ...l, account: undefined })),
    suggestions: sugs.filter((s) => lc(s.account) === lc(a.account)).slice().reverse().map((s) => ({ ...s, account: undefined })),
  });
  const ping = (a) => broadcast(a.account, "share", {});

  function suggest(linkId, b) {
    const l = links.get(lc(linkId));
    if (!l || l.status !== "open") return null;
    const a = accountOf(l.account);
    const p = posInfo(a, l.perpId);
    const lv = (a.levels?.get(l.perpId)) ?? { stopLossPNS: "0", takeProfitPNS: "0" };
    const s = {
      id: sugs.length + 1, account: a.account, linkId: l.linkId, perpId: l.perpId, side: l.side,
      stopLossPNS: b.stopLossPNS ?? null, takeProfitPNS: b.takeProfitPNS ?? null, prevStopLossPNS: lv.stopLossPNS, prevTakeProfitPNS: lv.takeProfitPNS,
      entryPNS: p?.entryPNS ?? "0", markPNS: p?.markPNS ?? "0", note: String(b.note ?? "").slice(0, 140), status: "pending",
      createdMs: b.createdMs ?? Date.now(), decidedMs: null, txHash: null,
    };
    sugs.push(s);
    ping(a);
    pushTo(a, { kind: "suggestion", title: `Suggested levels for ${p?.symbol ?? l.perpId} ${l.side}`, body: "A friend suggested new levels. Review it in Mirror.", account: a.account, eventId: `suggestion:${s.id}`, timestamp: Date.now() });
    return s;
  }

  async function route(req, res, p) {
    let m;
    if (req.method === "POST" && p === "/v1/share") {
      const b = await readBody(req);
      const a = accountOf(b.account);
      if (!a) return err(res, 404, "unknown_account", "Unknown account"), true;
      const signer = await recoverTypedDataAddress({ ...shareLinkTypedData(cs(a.account), chainId, b.perpId, b.linkId, BigInt(b.deadline)), signature: b.signature });
      if (lc(signer) !== lc(a.owner)) return err(res, 401, "not_owner", "Signature is not from the account owner"), true;
      const pos = posInfo(a, b.perpId);
      if (!pos) return err(res, 409, "no_position", "There is no open position in this market to share"), true;
      const l = { linkId: lc(b.linkId), urlId: urlIdOf(b.linkId), account: a.account, perpId: b.perpId, side: pos.side, status: "open", createdMs: Date.now(), endedMs: null, endedReason: null };
      links.set(l.linkId, l);
      ping(a);
      return send(res, 200, { linkId: l.linkId, urlId: l.urlId, status: "open", perpId: l.perpId, side: l.side }), true;
    }
    if (req.method === "GET" && (m = p.match(/^\/v1\/accounts\/(0x[0-9a-fA-F]{40})\/share$/))) {
      const a = accountOf(m[1]);
      const key = new URL(req.url, "http://x").searchParams.get("key")?.replace(/ /g, "+");
      const o = a && owners.get(lc(a.owner));
      if (!a) return err(res, 404, "unknown_account", "Unknown account"), true;
      if (!o?.notifyPub || o.notifyPub !== key) return err(res, 403, "unknown_key", "Register this device key first"), true;
      const body = list(a);
      return send(res, 200, { pending: body.suggestions.filter((s) => s.status === "pending").length, sealed: seal(base64.decode(key), new TextEncoder().encode(JSON.stringify(body))) }), true;
    }
    if (req.method === "POST" && (m = p.match(/^\/v1\/share\/(0x[0-9a-fA-F]{64})\/revoke$/))) {
      const b = await readBody(req);
      const l = links.get(lc(m[1]));
      if (!l) return err(res, 404, "unknown_link", "This link does not exist"), true;
      const a = accountOf(l.account);
      const signer = await recoverTypedDataAddress({ ...shareRevokeTypedData(cs(a.account), chainId, m[1], BigInt(b.deadline)), signature: b.signature });
      if (lc(signer) !== lc(a.owner)) return err(res, 401, "not_owner", "Signature is not from the account owner"), true;
      Object.assign(l, { status: "revoked", endedMs: Date.now(), endedReason: "revoked" });
      for (const s of sugs) if (s.linkId === l.linkId && s.status === "pending") s.status = "expired";
      ping(a);
      return send(res, 200, { linkId: l.linkId, status: "revoked" }), true;
    }
    if (req.method === "POST" && (m = p.match(/^\/v1\/share\/suggestions\/(\d+)\/(decline|accept)$/))) {
      const b = await readBody(req);
      const s = sugs.find((x) => x.id === Number(m[1]));
      if (!s) return err(res, 404, "unknown_suggestion", "Unknown suggestion"), true;
      const a = accountOf(s.account);
      if (m[2] === "decline") {
        const signer = await recoverTypedDataAddress({ ...shareDeclineTypedData(cs(a.account), chainId, s.id, BigInt(b.deadline)), signature: b.signature });
        if (lc(signer) !== lc(a.owner)) return err(res, 401, "not_owner", "Signature is not from the account owner"), true;
        Object.assign(s, { status: "declined", decidedMs: Date.now() });
      } else Object.assign(s, { status: "accepted", decidedMs: Date.now(), txHash: lc(b.txHash) });
      ping(a);
      return send(res, 200, { id: s.id, status: s.status, txHash: s.txHash }), true;
    }
    // ---- the friend's page (web /p/<id>): card and suggest, by bytes32 or the 43-char url id
    if ((m = p.match(/^\/v1\/share\/([A-Za-z0-9_-]{43}|0x[0-9a-fA-F]{64})(\/suggest)?$/))) {
      const l = [...links.values()].find((x) => x.urlId === m[1] || x.linkId === lc(m[1]));
      if (!l) return err(res, 404, "unknown_link", "This link does not exist"), true;
      const a = accountOf(l.account);
      const pos = posInfo(a, l.perpId);
      if (l.status === "open" && !pos) Object.assign(l, { status: "closed", endedMs: Date.now(), endedReason: "position_closed" });
      if (req.method === "POST" && m[2]) {
        if (l.status !== "open") return err(res, 410, l.status, l.status === "revoked" ? "The owner revoked this link" : "This position is closed"), true;
        const s = suggest(l.linkId, await readBody(req));
        return send(res, 200, { id: s.id, status: "pending", stopLossPNS: s.stopLossPNS, takeProfitPNS: s.takeProfitPNS, prevStopLossPNS: s.prevStopLossPNS, prevTakeProfitPNS: s.prevTakeProfitPNS, note: s.note }), true;
      }
      const base = { status: l.status, perpId: l.perpId, symbol: pos?.symbol ?? String(l.perpId), side: l.side, sharedBy: `${cs(a.owner).slice(0, 6)}…${cs(a.owner).slice(-4)}`, lotDecimals: pos?.lotDecimals ?? 0, priceDecimals: pos?.priceDecimals ?? 0 };
      if (l.status !== "open") return send(res, 200, { ...base, endedReason: l.endedReason }), true;
      const lv = (a.levels?.get(l.perpId)) ?? { stopLossPNS: "0", takeProfitPNS: "0" };
      return send(res, 200, { ...base, ...pos.card, entryPNS: pos.entryPNS, markPNS: pos.markPNS, stopLossPNS: lv.stopLossPNS, takeProfitPNS: lv.takeProfitPNS, copiedFrom: pos.copiedFrom, block: 18204402 }), true;
    }
    // ---- admin: a bare link (friend page screenshots) and ending one
    if (req.method === "POST" && p === "/__mock/link") {
      const b = await readBody(req);
      const a = [...accounts.values()].find((x) => lc(x.owner) === lc(b.owner) && posInfo(x, b.perpId ?? 1));
      if (!a) return err(res, 404, "none", "no position"), true;
      const id = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
      const l = { linkId: id, urlId: urlIdOf(id), account: a.account, perpId: b.perpId ?? 1, side: posInfo(a, b.perpId ?? 1).side, status: "open", createdMs: Date.now(), endedMs: null, endedReason: null };
      links.set(id, l);
      return send(res, 200, l), true;
    }
    if (req.method === "POST" && p === "/__mock/endlink") {
      const b = await readBody(req);
      const l = [...links.values()].find((x) => x.urlId === b.urlId);
      if (!l) return err(res, 404, "none", "no link"), true;
      Object.assign(l, { status: b.status ?? "revoked", endedMs: Date.now(), endedReason: b.status === "closed" ? "position_closed" : "revoked" });
      return send(res, 200, l), true;
    }
    // ---- admin: a friend's suggestion on the newest open link of the owner's position (screenshots)
    if (req.method === "POST" && p === "/__mock/suggest") {
      const b = await readBody(req);
      let l = [...links.values()].reverse().find((x) => x.status === "open" && lc(accountOf(x.account).owner) === lc(b.owner) && (!b.perpId || x.perpId === b.perpId));
      if (!l && b.create) {
        const a = [...accounts.values()].find((x) => lc(x.owner) === lc(b.owner) && posInfo(x, b.perpId ?? 1));
        if (!a) return err(res, 404, "none", "no position"), true;
        const id = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
        l = { linkId: id, urlId: urlIdOf(id), account: a.account, perpId: b.perpId ?? 1, side: posInfo(a, b.perpId ?? 1).side, status: "open", createdMs: Date.now(), endedMs: null, endedReason: null };
        links.set(id, l);
      }
      if (!l) return err(res, 404, "none", "no open link"), true;
      const s = suggest(l.linkId, b);
      return send(res, s ? 200 : 409, s ?? { error: "closed" }), true;
    }
    return false;
  }
  return { route, links, sugs, sideOf };
}
