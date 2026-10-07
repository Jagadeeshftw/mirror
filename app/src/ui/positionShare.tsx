// Share sheet for a shared position link: the friend page URL (/p/<id>), Copy link, Share, Revoke link, and the
// copy-result card as before. Bottom sheet on the phone, centred panel on the laptop. No motion.
import * as Clipboard from "expo-clipboard";
import React, { useState } from "react";
import { Platform, Share, View } from "react-native";
import { shareMethod } from "../lib/share";
import { positionLinkUrl, type ShareLinkInfo } from "../lib/shareLink";
import type { MarketConfig, MirrorAccount, Position } from "../lib/types";
import { useShareActions } from "../state/share";
import { Icon } from "./icons";
import { Button, IconButton, Lbl, Row, Sheet, T } from "./kit";
import { useLayout } from "./layout";
import { LaptopPanel } from "./shareSheet";
import { useColors } from "./theme";

const BTN = { height: 44, paddingHorizontal: 8, gap: 6, flexGrow: 1, flexBasis: "auto" } as const;

export function PositionShareSheet({ link, account, p, m, onClose, onCard }: { link: ShareLinkInfo | null; account: MirrorAccount; p: Position; m: MarketConfig | undefined; onClose: () => void; onCard: () => void }) {
  const laptop = useLayout() === "laptop";
  if (!link) return null;
  const body = <Body link={link} account={account} p={p} m={m} onClose={onClose} onCard={onCard} />;
  if (!laptop)
    return (
      <Sheet visible onClose={onClose} testID="shareLink.sheet">
        {body}
      </Sheet>
    );
  return <LaptopPanel onClose={onClose} testID="shareLink.sheet">{body}</LaptopPanel>;
}

function Body({ link, account, p, m, onClose, onCard }: { link: ShareLinkInfo; account: MirrorAccount; p: Position; m: MarketConfig | undefined; onClose: () => void; onCard: () => void }) {
  const c = useColors();
  const acts = useShareActions();
  const [status, setStatus] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(link.status !== "open");
  const url = positionLinkUrl(link.urlId);
  const title = `${m?.symbol ?? "Position"} ${p.side}`;
  const copy = async () => {
    await Clipboard.setStringAsync(url);
    setStatus("Link copied");
  };
  const share = async () => {
    const how = shareMethod(Platform.OS, typeof navigator !== "undefined" && typeof (navigator as any).share === "function");
    try {
      if (how === "native") await Share.share({ message: `My ${title} on Mirror. Suggest a stop or a target: ${url}`, url, title });
      else if (how === "webshare") await (navigator as any).share({ title: `Mirror · ${title}`, url });
      else await copy();
    } catch (e: any) {
      if (e?.name !== "AbortError") await copy();
    }
  };
  const revoke = async () => {
    const r = await acts.revoke(account, link.linkId);
    if (r) {
      setRevoked(true);
      setStatus("Link revoked. The page now says so and takes no suggestions.");
    }
  };
  return (
    <View style={{ gap: 14, paddingTop: 4 }}>
      <Row gap={8} align="flex-start">
        <View style={{ flex: 1 }}>
          <Lbl>Share position</Lbl>
          <T size={18} w={600} lh={24} testID="shareLink.title">{`${title} · read-only link`}</T>
        </View>
        <IconButton name="close" onPress={onClose} testID="shareLink.close" />
      </Row>
      <T size={13} color="mu">Anyone with this link sees this position read-only and can suggest a stop-loss and take-profit with a short note. Nothing changes unless you accept with your passkey. The link closes with the position.</T>
      <Row gap={10} style={{ padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.bd, backgroundColor: c.bg }}>
        <Icon name="link" size={18} color={revoked ? c.mu : c.ac} />
        <T size={13} mono lines={1} selectable style={{ flex: 1 }} color={revoked ? "mu" : "tx"} testID="shareLink.url">{url.replace(/^https?:\/\//, "")}</T>
      </Row>
      {status ? <T size={12} color={revoked ? "mu" : "posI"} testID="shareLink.status">{status}</T> : null}
      {acts.error ? <T size={12} color="neg" testID="shareLink.error">{acts.error}</T> : null}
      {revoked ? null : (
        <Row gap={8}>
          <Button title="Copy link" icon="link" kind="out" size="sm" style={BTN} onPress={copy} testID="shareLink.copy" />
          <Button title="Share" icon="share" size="sm" style={BTN} onPress={share} testID="shareLink.share" />
        </Row>
      )}
      <Row gap={8}>
        <Button title="Result card" icon="img" kind="out" size="sm" style={BTN} onPress={onCard} testID="shareLink.card" />
        {revoked ? null : <Button title={acts.busy === "revoke" ? "Revoking…" : "Revoke link"} kind="dngO" size="sm" style={BTN} disabled={acts.busy === "revoke"} onPress={revoke} testID="shareLink.revoke" />}
      </Row>
    </View>
  );
}
