// Share sheet (design proposal-2 #cards, 08e): card preview, Square / Wide, "Show AUSD amounts", Copy link,
// Save image, Share. The card is rendered by the website from live engine data (web/app/(site)/c/...); the link
// shared is its landing page. No motion: the preview has no fade and nothing animates.
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import React, { useEffect, useMemo, useState } from "react";
import { Image, Modal, Platform, Pressable, Share, View } from "react-native";
import { defaultOptions, hasAmounts, imageUrl, landingUrl, SIZE, shareMethod, shareTitle, type ShareOptions, type ShareTarget } from "../lib/share";
import { shortAddr } from "../lib/format";
import type { MirrorAccount } from "../lib/types";
import { Icon } from "./icons";
import { Button, Chip, IconButton, Lbl, Row, Seg, Sheet, Switch, T } from "./kit";
import { useLayout } from "./layout";
import { useColors, useTheme } from "./theme";

/** Three actions on one row at 390 px: compact type, full touch height. */
const BTN = { height: 44, paddingHorizontal: 8, gap: 6, flexGrow: 1, flexBasis: "auto" } as const;

export interface ShareChoice {
  key: string;
  label: string;
  target: ShareTarget;
}

/** One follower card per follow account, labelled by the leader it copies. */
export function followerChoices(accounts: MirrorAccount[]): ShareChoice[] {
  return accounts
    .filter((a) => a.deployed !== false)
    .map((a) => ({ key: a.account, label: shortAddr(a.leader?.address ?? a.account), target: { kind: "follower" as const, account: a.account, teamRun: a.teamRun } }));
}

/**
 * `targets`: one card, or several to pick from (one follower card per follow account).
 * Renders as a bottom sheet on the phone and as a centred panel on the laptop layout.
 */
export function ShareSheet({ visible, onClose, targets }: { visible: boolean; onClose: () => void; targets: ShareChoice[] }) {
  const laptop = useLayout() === "laptop";
  if (!visible || !targets.length) return null;
  const body = <ShareBody targets={targets} onClose={onClose} />;
  if (!laptop)
    return (
      <Sheet visible onClose={onClose} testID="share.sheet" tall>
        {body}
      </Sheet>
    );
  return <LaptopPanel onClose={onClose}>{body}</LaptopPanel>;
}

function LaptopPanel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const c = useColors();
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.scrim, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} testID="share.sheet.scrim" />
        <View testID="share.sheet" style={{ width: 480, maxWidth: "100%", maxHeight: "94%", backgroundColor: c.sf, borderRadius: 24, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 20, borderWidth: 1, borderColor: c.bd }}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function ShareBody({ targets, onClose }: { targets: ShareChoice[]; onClose: () => void }) {
  const c = useColors();
  const { c: colors } = useTheme();
  const [pick, setPick] = useState(0);
  const target = targets[Math.min(pick, targets.length - 1)].target;
  const [opts, setOpts] = useState<ShareOptions>(() => defaultOptions(target.kind));
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const theme = colors.dark ? "dark" : "light";
  const url = useMemo(() => landingUrl(target, opts), [target, opts]);
  const img = useMemo(() => imageUrl(target, opts, theme), [target, opts, theme]);
  const title = shareTitle(target);
  useEffect(() => setFailed(false), [img]);
  useEffect(() => setStatus(null), [url]);
  const size = SIZE[opts.format];

  const copy = async () => {
    await Clipboard.setStringAsync(url);
    setStatus("Link copied");
  };
  const share = async () => {
    const how = shareMethod(Platform.OS, typeof navigator !== "undefined" && typeof (navigator as any).share === "function");
    try {
      if (how === "native") await Share.share({ message: `${title} · ${url}`, url, title });
      else if (how === "webshare") await (navigator as any).share({ title: `Mirror · ${title}`, url });
      else await copy();
    } catch (e: any) {
      // The person closed the system sheet: nothing to report. Anything else falls back to copying the link.
      if (e?.name !== "AbortError") await copy();
    }
  };
  const save = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") window.open(img, "_blank", "noopener");
    else void Linking.openURL(img);
  };

  return (
    <View style={{ gap: 14, paddingTop: 4 }}>
      <Row gap={8} align="flex-start">
        <View style={{ flex: 1 }}>
          <Lbl>Share</Lbl>
          <T size={18} w={600} lh={24} testID="share.title">
            {title}
          </T>
        </View>
        <IconButton name="close" onPress={onClose} testID="share.close" />
      </Row>
      {targets.length > 1 ? (
        <Row gap={6} style={{ flexWrap: "wrap" }}>
          {targets.map((t, i) => (
            <Chip key={t.key} label={t.label} mono on={i === pick} onPress={() => setPick(i)} testID={`share.account.${i}`} height={30} />
          ))}
        </Row>
      ) : null}
      <View testID="share.preview" style={{ borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: c.bd, backgroundColor: c.bg, aspectRatio: size.width / size.height, maxHeight: 340, alignSelf: "center", width: "100%" }}>
        {failed ? (
          <View testID="share.preview.unavailable" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 6 }}>
            <Icon name="img" size={22} color={c.mu} />
            <T size={13} color="mu" center>
              Preview not available. The link still opens the card.
            </T>
          </View>
        ) : (
          <Image source={{ uri: img }} style={{ width: "100%", height: "100%" }} resizeMode="contain" fadeDuration={0} onError={() => setFailed(true)} accessibilityLabel={`${title} card`} testID="share.preview.image" />
        )}
      </View>
      <T size={12} mono color="mu" lines={1} selectable testID="share.url">
        {url.replace(/^https?:\/\//, "").replace(/0x[0-9a-fA-F]{12,}/g, (h) => shortAddr(h))}
      </T>
      <Seg
        options={[
          { key: "sq", label: "Square" },
          { key: "og", label: "Wide" },
        ]}
        value={opts.format}
        onChange={(format) => setOpts((o) => ({ ...o, format }))}
        testIDPrefix="share.format"
      />
      {hasAmounts(target.kind) ? (
        <Row gap={12} style={{ paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.bd }}>
          <View style={{ flex: 1 }}>
            <T size={14} w={600}>
              Show AUSD amounts
            </T>
            <T size={12} color="mu">
              Off shows percentages only
            </T>
          </View>
          <Switch on={opts.amounts} onChange={(amounts) => setOpts((o) => ({ ...o, amounts }))} testID="share.amounts" />
        </Row>
      ) : null}
      {status ? (
        <T size={12} color="posI" testID="share.status">
          {status}
        </T>
      ) : null}
      <Row gap={8}>
        <Button title="Copy link" icon="link" kind="out" size="sm" style={BTN} onPress={copy} testID="share.copyLink" />
        <Button title="Save image" icon="img" kind="out" size="sm" style={BTN} onPress={save} testID="share.saveImage" />
        <Button title="Share" icon="share" size="sm" style={BTN} onPress={share} testID="share.share" />
      </Row>
    </View>
  );
}
