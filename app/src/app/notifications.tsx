import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { ausd, ausdSigned, leverage, orderSide, shortAddr, timeHM } from "../lib/format";
import type { FeedEvent, PushPayload } from "../lib/types";
import { useConfig, useFeedAll } from "../state/data";
import { getLastSeen, setLastSeen, useNotificationHistory } from "../state/notifications";
import { AppBar } from "../ui/chrome";
import { shortRule } from "../ui/feed";
import { Icon, type IconName } from "../ui/icons";
import { Card, Chip, Lbl, Press, Row, Screen, Scroll, T } from "../ui/kit";
import { useColors } from "../ui/theme";

type Kind = "copies" | "blocked" | "account";
interface Item {
  id: string;
  kind: Kind;
  icon: IconName;
  tone: "ac" | "ng" | "wr" | "nu";
  title: string;
  body: string;
  ts: number;
  event?: FeedEvent;
}

const DAY = 86400e3;
const dayName = (ts: number) => (Date.now() - ts < 6 * DAY ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(ts).getDay()] : new Date(ts).toISOString().slice(5, 10));

export default function Notifications() {
  const c = useColors();
  const cfg = useConfig().data;
  const feed = useFeedAll();
  const pushes = useNotificationHistory();
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [seen, setSeen] = useState(Number.MAX_SAFE_INTEGER);
  useEffect(() => {
    getLastSeen().then(setSeen);
    return () => {
      void setLastSeen();
    };
  }, []);

  const items = useMemo(() => {
    const out: Item[] = [];
    const ids = new Set<string>();
    for (const e of feed.events) {
      const sym = cfg?.markets.find((m) => m.perpId === e.perpId)?.symbol ?? "";
      const L = shortAddr(e.leaderAddress);
      let it: Item | null = null;
      if (e.kind === "Mirrored") {
        const open = (e.orderType ?? 0) <= 1;
        it = open
          ? { id: e.id, kind: "copies", icon: "feed", tone: "ac", title: `Copied ${sym} ${orderSide(e.orderType ?? 0).toLowerCase()}`, body: `${L} · ${ausd(e.notionalCNS ?? "0")} AUSD · ${((e.latencyMs ?? 0) / 1000).toFixed(2)} s`, ts: e.timestamp, event: e }
          : { id: e.id, kind: "copies", icon: "check", tone: "ac", title: `Closed ${sym} ${orderSide(e.orderType ?? 0).toLowerCase()}`, body: `${L} · realised ${ausdSigned(e.realisedPnlCNS ?? "0")} AUSD`, ts: e.timestamp, event: e };
      } else if (e.kind === "Blocked") {
        const stop = e.blocked?.reason === "DailyLossStop" || e.blocked?.reason === "DrawdownStop";
        it = stop
          ? { id: e.id, kind: "blocked", icon: "pause", tone: "wr", title: e.blocked?.reason === "DailyLossStop" ? "Daily loss stop reached" : "Drawdown stop reached", body: `${L}: new exposure paused, closes still follow`, ts: e.timestamp, event: e }
          : { id: e.id, kind: "blocked", icon: "ban", tone: "ng", title: "Blocked by your rule", body: `${leverage(e.leaderLeverageHdths ?? e.leverageHdths ?? 0)} ${sym} ${orderSide(e.orderType ?? 0).toLowerCase()} from ${L}. ${shortRule(cfg, e)}.`, ts: e.timestamp, event: e };
      } else if (e.kind === "Withdrawn") it = { id: e.id, kind: "account", icon: "arrup", tone: "nu", title: "Withdrawal complete", body: `${ausd(e.amountCNS ?? "0")} AUSD to your wallet`, ts: e.timestamp };
      else if (e.kind === "Deposited") it = { id: e.id, kind: "account", icon: "arrdown", tone: "nu", title: "Deposit received", body: `${ausd(e.amountCNS ?? "0")} AUSD added to your follow`, ts: e.timestamp };
      else if (e.kind === "Paused") it = { id: e.id, kind: "account", icon: "pause", tone: "nu", title: e.paused ? "Following paused" : "Following resumed", body: "From Account controls", ts: e.timestamp };
      else if (e.kind === "LeaderDetached") it = { id: e.id, kind: "account", icon: e.data?.detached ? "pause" : "check", tone: "nu", title: String(e.data?.label ?? (e.data?.detached ? "Stopped following this leader (positions kept)" : "Following this leader again")), body: e.data?.detached ? `${L || `Perpl #${e.leaderAccountId ?? "?"}`}: your contract refuses every copy from this leader, opens and closes. Your positions stay open.` : `${L || `Perpl #${e.leaderAccountId ?? "?"}`}: copies resume`, ts: e.timestamp };
      else if (e.kind === "ClosedAll") it = { id: e.id, kind: "account", icon: "close", tone: "nu", title: "Positions closed", body: `${e.positionsClosed ?? 0} closed at market`, ts: e.timestamp };
      if (it) {
        out.push(it);
        ids.add(it.id);
      }
    }
    for (const p of pushes as PushPayload[]) {
      if (p.eventId && ids.has(p.eventId)) continue;
      out.push({
        id: `push-${p.timestamp}-${p.title}`,
        kind: p.kind === "blocked" ? "blocked" : p.kind === "copied" || p.kind === "closed" ? "copies" : "account",
        icon: p.kind === "blocked" ? "ban" : p.kind === "expiry" ? "cal" : p.kind === "stop" ? "pause" : "bell",
        tone: p.kind === "blocked" ? "ng" : p.kind === "expiry" || p.kind === "stop" ? "wr" : "ac",
        title: p.title,
        body: p.body,
        ts: p.timestamp,
      });
    }
    // Expiry reminders are computed locally from each follow's policy.
    return out.sort((a, b) => b.ts - a.ts);
  }, [feed.events, pushes, cfg]);

  const shown = items.filter((i) => filter === "all" || i.kind === filter);
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const groups: [string, Item[]][] = [
    ["Today", shown.filter((i) => i.ts >= todayStart)],
    ["Earlier", shown.filter((i) => i.ts < todayStart)],
  ];
  const tones = { ac: [c.acs, c.ac], ng: [c.negS, c.neg], wr: [c.wrnS, c.wrnI], nu: [c.sf2, c.mu] } as const;

  return (
    <Screen>
      <AppBar title="Notifications" showBack noAv />
      <Scroll testID="notifications.screen">
        <Row gap={8} style={{ paddingHorizontal: 20 }}>
          {(["all", "copies", "blocked", "account"] as const).map((f) => (
            <Chip key={f} label={f[0].toUpperCase() + f.slice(1)} on={filter === f} onPress={() => setFilter(f)} testID={`notifications.filter.${f}`} />
          ))}
        </Row>
        {groups.map(([g, list]) =>
          list.length ? (
            <View key={g} style={{ gap: 10 }}>
              <Lbl style={{ paddingHorizontal: 20 }}>{g}</Lbl>
              <Card list style={{ marginHorizontal: 16 }}>
                {list.slice(0, 40).map((it, idx) => (
                  <Press
                    key={it.id}
                    testID={`notifications.item.${idx}`}
                    onPress={() => router.push({ pathname: "/feed", params: it.kind === "blocked" ? { filter: "blocked" } : {} })}
                    style={{ flexDirection: "row", gap: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: "flex-start" }}
                  >
                    {it.ts > seen ? <View style={{ position: "absolute", left: 5, top: 22, width: 6, height: 6, borderRadius: 3, backgroundColor: c.ac }} /> : null}
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: tones[it.tone][0], alignItems: "center", justifyContent: "center" }}>
                      <Icon name={it.icon} size={18} color={tones[it.tone][1]} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Row>
                        <T size={13} w={600} style={{ flex: 1 }}>
                          {it.title}
                        </T>
                        <T size={12} mono color="mu">
                          {it.ts >= todayStart ? timeHM(it.ts) : dayName(it.ts)}
                        </T>
                      </Row>
                      <T size={13} color="mu">
                        {it.body}
                      </T>
                    </View>
                  </Press>
                ))}
              </Card>
            </View>
          ) : null,
        )}
        {!shown.length ? (
          <Card style={{ marginHorizontal: 16, padding: 20, alignItems: "center" }}>
            <T size={13} color="mu">
              Nothing here yet.
            </T>
          </Card>
        ) : null}
        <Press onPress={() => router.push("/alerts")} testID="notifications.alerts" style={{ alignSelf: "center", padding: 6 }}>
          <T size={13} w={600} color="ac">
            Encrypted alerts received
          </T>
        </Press>
        <T size={12} color="mu" center style={{ paddingHorizontal: 24 }}>
          Push payloads are end-to-end encrypted to a key derived from your passkey. Change what you get in Settings.
        </T>
      </Scroll>
    </Screen>
  );
}
