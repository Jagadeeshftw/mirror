import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { LeaderSort, LeaderWindow } from "../../lib/api";
import { MINUS, pctSigned, shortAddr } from "../../lib/format";
import { ALL_MARKETS } from "../../lib/policy";
import type { LeaderSummary } from "../../lib/types";
import { useLeaders } from "../../state/data";
import { AppBar } from "../../ui/chrome";
import { Spark } from "../../ui/charts";
import { Icon } from "../../ui/icons";
import { Card, Chip, ChipS, ErrorBanner, Identicon, LoadingBlock, NansenLabel, Press, Row, Screen, Scroll, Seg, Sheet, T } from "../../ui/kit";
import { useColors } from "../../ui/theme";
import { LaptopLeaders } from "../../ui/laptop/LaptopLeaders";
import { useLayout } from "../../ui/layout";
import { AdversarialFlag } from "../../ui/adversarial";

function LeaderRow({ l, rank, index }: { l: LeaderSummary; rank: number; index: number }) {
  const c = useColors();
  return (
    <Press testID={`leaders.item.${index}`} onPress={() => router.push({ pathname: "/leader/[id]", params: { id: String(l.accountId) } })} style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 8 }}>
      <Row gap={10}>
        <T size={12} mono color="mu" style={{ width: 12 }}>
          {rank}
        </T>
        <Identicon seed={l.address} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Row gap={6}>
            <T size={14} w={500} mono>
              {shortAddr(l.address)}
            </T>
            <AdversarialFlag a={l.adversarial} compact testID={`leaders.adversarial.${l.accountId}`} />
          </Row>
          <View style={{ flexDirection: "row", gap: 4, marginTop: 3 }}>
            {l.nansen.labels.length ? <NansenLabel label={l.nansen.labels[0]} /> : <T size={12} color="mu">No label</T>}
          </View>
        </View>
        <Row gap={8}>
          <Spark data={l.spark ?? []} positive={l.pnlPct >= 0} />
          <View style={{ alignItems: "flex-end" }}>
            <T size={14} w={600} mono color={l.pnlPct >= 0 ? "posI" : "neg"}>
              {pctSigned(l.pnlPct)}
            </T>
            <T size={12} color="mu">
              Score{" "}
              <T size={12} w={600} mono>
                {l.score}
              </T>
            </T>
          </View>
        </Row>
      </Row>
      <Row gap={12} style={{ marginLeft: 22 }}>
        <T size={12} mono>
          <T size={12} color="mu">
            Max DD{" "}
          </T>
          <T size={12} w={600} mono color={l.maxDrawdownPct > 15 ? c.neg : c.tx}>
            {MINUS}
            {l.maxDrawdownPct.toFixed(1)}%
          </T>
        </T>
        <T size={12} mono>
          <T size={12} color="mu">
            Win{" "}
          </T>
          {l.winRate}%
        </T>
        <T size={12} mono>
          <T size={12} color="mu">
            Lev{" "}
          </T>
          {l.avgLeverage.toFixed(1)}x
        </T>
        <View style={{ flex: 1 }} />
        <T size={12} mono color="mu">
          {l.markets.slice(0, 2).join(" ")}
          {l.markets.length > 2 ? ` +${l.markets.length - 2}` : ""}
        </T>
      </Row>
    </Press>
  );
}

const SORTS: { key: LeaderSort; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "pnl", label: "PnL" },
  { key: "drawdown", label: "Drawdown" },
];

export default function Leaders() {
  return useLayout() === "laptop" ? <LaptopLeaders /> : <PhoneLeaders />;
}

function PhoneLeaders() {
  const c = useColors();
  const [window, setWindow] = useState<LeaderWindow>("30d");
  const [sort, setSort] = useState<LeaderSort>("score");
  const [market, setMarket] = useState<string | undefined>();
  const [ddCap, setDdCap] = useState(true);
  const [labeled, setLabeled] = useState(false);
  const [picker, setPicker] = useState<"market" | "sort" | null>(null);
  const q = useLeaders(window, sort, market);
  const list = useMemo(
    () => (q.data ?? []).filter((l) => !l.teamRun && (!ddCap || l.maxDrawdownPct <= 25) && (!labeled || l.nansen.labels.length > 0)),
    [q.data, ddCap, labeled],
  );
  return (
    <Screen testID="leaders.screen">
      <AppBar title="Leaders" />
      <Scroll testID="leaders.list">
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <Seg
            testIDPrefix="leaders.window"
            value={window}
            onChange={setWindow}
            options={[
              { key: "7d", label: "7D" },
              { key: "30d", label: "30D" },
              { key: "90d", label: "90D" },
            ]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} overScrollMode="never" style={{ marginRight: -20 }} contentContainerStyle={{ gap: 8, paddingRight: 20 }}>
            <Chip label="Max DD ≤ 25%" on={ddCap} icon={ddCap ? "check" : undefined} onPress={() => setDdCap(!ddCap)} testID="leaders.filter.dd" />
            <Chip label={`Markets: ${market ?? "All"}`} on={!!market} trailing="down" onPress={() => setPicker("market")} testID="leaders.filter.market" />
            <Chip label="Nansen labeled" on={labeled} icon={labeled ? "check" : undefined} onPress={() => setLabeled(!labeled)} testID="leaders.filter.nansen" />
            <Chip label={`Sort: ${SORTS.find((s) => s.key === sort)!.label}`} trailing="down" onPress={() => setPicker("sort")} testID="leaders.sort" />
          </ScrollView>
        </View>
        <T size={12} color="mu" style={{ paddingHorizontal: 20, marginTop: -4 }}>
          Ranked by Mirror score from onchain Perpl fills: PnL, drawdown, win rate and consistency. Labels by Nansen.
        </T>
        {q.isError ? <ErrorBanner title="Can't load leaders" body="Check your connection and try again." onRetry={() => q.refetch()} /> : null}
        {q.isLoading ? <LoadingBlock label="Ranking traders" /> : null}
        {!q.isLoading && !q.isError && list.length === 0 ? (
          <Card style={{ marginHorizontal: 16, padding: 20, alignItems: "center", gap: 6 }}>
            <T size={15} w={600}>
              No leaders match
            </T>
            <T size={13} color="mu" center>
              Loosen a filter to see more traders.
            </T>
          </Card>
        ) : null}
        {list.length ? (
          <Card list style={{ marginHorizontal: 16 }}>
            {list.map((l, i) => (
              <LeaderRow key={l.accountId} l={l} rank={i + 1} index={i} />
            ))}
          </Card>
        ) : null}
        <Card style={{ marginHorizontal: 16, padding: 14 }} onPress={() => router.push("/demo")} testID="leaders.demo">
          <Row gap={12}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.acs, alignItems: "center", justifyContent: "center" }}>
              <Icon name="feed" size={18} color={c.ac} />
            </View>
            <View style={{ flex: 1 }}>
              <T size={14} w={600}>
                Try it before you follow
              </T>
              <T size={12} color="mu">
                Watch a copy land on the team-run demo account
              </T>
            </View>
            <ChipS label="Demo" tone="ac" />
          </Row>
        </Card>
      </Scroll>
      <Sheet visible={!!picker} onClose={() => setPicker(null)} testID="leaders.picker">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <T size={17} w={600}>
            {picker === "market" ? "Market" : "Sort by"}
          </T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {picker === "market"
              ? ["All", ...ALL_MARKETS].map((m) => (
                  <Chip key={m} label={m} mono={m !== "All"} on={(market ?? "All") === m} onPress={() => { setMarket(m === "All" ? undefined : m); setPicker(null); }} testID={`leaders.market.${m}`} />
                ))
              : SORTS.map((s) => <Chip key={s.key} label={s.label} on={sort === s.key} onPress={() => { setSort(s.key); setPicker(null); }} testID={`leaders.sort.${s.key}`} />)}
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}
