// Alerts: the encrypted alerts this device received (Web Push, Android push or the live stream), decrypted here with
// the notification key from the passkey's second PRF namespace. Nothing on this screen came from the server in clear.
import { router } from "expo-router";
import React, { useEffect } from "react";
import { Platform, View } from "react-native";
import { shortAddr, timeHM } from "../lib/format";
import { NS_NOTIFY_LABEL } from "../lib/prfNamespaces";
import { drainInbox } from "../lib/push";
import type { PushPayload } from "../lib/types";
import { useNotificationHistory } from "../state/notifications";
import { useSession } from "../state/session";
import { useAlerts } from "../state/alerts";
import { useShareLists } from "../state/share";
import { useConfig } from "../state/data";
import { suggestionSummary } from "../ui/suggestions";
import { AppBar } from "../ui/chrome";
import { Icon, type IconName } from "../ui/icons";
import { Button, Card, Lbl, Note, Press, Row, Screen, Scroll, T } from "../ui/kit";
import { useColors } from "../ui/theme";

const LOOK: Record<PushPayload["kind"], { icon: IconName; tone: "ac" | "ng" | "wr" | "nu" }> = {
  copied: { icon: "feed", tone: "ac" },
  closed: { icon: "check", tone: "ac" },
  blocked: { icon: "ban", tone: "ng" },
  stop: { icon: "pause", tone: "wr" },
  leader_stop: { icon: "pause", tone: "wr" },
  low_equity: { icon: "warn", tone: "wr" },
  expiry: { icon: "cal", tone: "wr" },
  deposit: { icon: "arrdown", tone: "nu" },
  withdraw: { icon: "arrup", tone: "nu" },
  demo: { icon: "bell", tone: "ac" },
  suggestion: { icon: "msg", tone: "ac" },
};

const DAY = 86400e3;
const when = (ts: number) => (Date.now() - ts < DAY && new Date(ts).getDate() === new Date().getDate() ? timeHM(ts) : new Date(ts).toISOString().slice(5, 10));

export default function Alerts() {
  const c = useColors();
  const list = useNotificationHistory();
  const { account } = useSession();
  const alerts = useAlerts(account?.address);
  const share = useShareLists();
  const cfg = useConfig().data;
  const openPosition = (a: string, perpId: number, side: string) => router.push({ pathname: "/position", params: { account: a, perp: String(perpId), side } });
  const openAlert = (p: PushPayload) => {
    if (p.kind !== "suggestion") return router.push({ pathname: "/feed", params: p.kind === "blocked" ? { filter: "blocked" } : {} });
    const id = Number(String(p.eventId ?? "").split(":")[1]);
    for (const l of share.byAccount.values()) {
      const s = l.suggestions.find((x) => x.id === id);
      if (s) return openPosition(l.account, s.perpId, s.side);
    }
    router.push("/positions");
  };
  useEffect(() => {
    void drainInbox();
  }, []);
  const tones = { ac: [c.acs, c.ac], ng: [c.negS, c.neg], wr: [c.wrnS, c.wrnI], nu: [c.sf2, c.mu] } as const;

  return (
    <Screen>
      <AppBar title="Alerts" showBack noAv />
      <Scroll testID="alerts.screen" contentStyle={{ paddingHorizontal: 16, gap: 12 }}>
        <Note tone="ac" icon="lock" testID="alerts.privacy">
          {`End-to-end encrypted. Each alert is sealed to a key from your passkey's separate "${NS_NOTIFY_LABEL}" namespace and decrypted on this device. Mirror's server and the push service only relay ciphertext.`}
        </Note>
        {!alerts.on ? (
          <Card style={{ padding: 14, gap: 10 }} testID="alerts.off">
            <T size={13}>Alerts are off. Turn them on to hear about copies, blocked trades and stops outside the app.</T>
            <Button title="Turn on alerts" icon="bell" size="md" onPress={alerts.turnOn} testID="alerts.enable" />
          </Card>
        ) : null}
        {share.pending.length ? (
          <>
            <Lbl style={{ paddingHorizontal: 4 }}>{`Suggestions · ${share.pending.length} new`}</Lbl>
            <Card list testID="alerts.suggestions">
              {share.pending.map((s) => {
                const m = cfg?.markets.find((x) => x.perpId === s.perpId);
                return (
                  <Press key={s.id} testID={`alerts.suggestion.${s.id}`} onPress={() => openPosition(s.account, s.perpId, s.side)} style={{ flexDirection: "row", gap: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: "flex-start" }}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.acs, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="msg" size={18} color={c.ac} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Row>
                        <T size={13} w={600} style={{ flex: 1 }}>{`Suggested levels for ${m?.symbol ?? `#${s.perpId}`} ${s.side}`}</T>
                        <T size={12} mono color="mu">{when(s.createdMs)}</T>
                      </Row>
                      <T size={13} color="mu" lines={2}>{`${suggestionSummary(s, m?.priceDecimals ?? 0)}${s.note ? ` · "${s.note}"` : ""}`}</T>
                      <T size={12} w={600} color="ac">Review</T>
                    </View>
                  </Press>
                );
              })}
            </Card>
          </>
        ) : null}
        {list.length ? (
          <>
            <Lbl style={{ paddingHorizontal: 4 }}>Received</Lbl>
            <Card list>
              {list.slice(0, 100).map((p, i) => {
                const look = LOOK[p.kind] ?? LOOK.demo;
                return (
                  <Press
                    key={`${p.account}-${p.eventId}-${p.timestamp}`}
                    testID={`alerts.item.${i}`}
                    onPress={() => openAlert(p)}
                    style={{ flexDirection: "row", gap: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: "flex-start" }}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: tones[look.tone][0], alignItems: "center", justifyContent: "center" }}>
                      <Icon name={look.icon} size={18} color={tones[look.tone][1]} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Row>
                        <T size={13} w={600} style={{ flex: 1 }} testID={`alerts.item.${i}.title`}>
                          {p.title}
                        </T>
                        <T size={12} mono color="mu">
                          {when(p.timestamp)}
                        </T>
                      </Row>
                      <T size={13} color="mu" testID={`alerts.item.${i}.body`}>
                        {p.body}
                      </T>
                      {p.account ? (
                        <T size={11} mono color="mu">
                          {shortAddr(p.account)}
                        </T>
                      ) : null}
                    </View>
                  </Press>
                );
              })}
            </Card>
          </>
        ) : (
          <Card style={{ padding: 20, alignItems: "center" }} testID="alerts.empty">
            <T size={13} color="mu" center>
              No alerts yet. They appear here when a copy lands, a copy is blocked, a stop fires, or funds move.
            </T>
          </Card>
        )}
        <T size={12} color="mu" center style={{ paddingHorizontal: 12 }}>
          {Platform.OS === "web"
            ? 'Your browser shows "Mirror: new activity"; the details are decrypted when you open Mirror.'
            : "Kept on this device only."}
        </T>
      </Scroll>
    </Screen>
  );
}
