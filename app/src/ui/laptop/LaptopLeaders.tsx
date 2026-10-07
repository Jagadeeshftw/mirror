// Laptop Leaders: the ranked table on the left, the selected leader's profile on the right.
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { LeaderWindow } from "../../lib/api";
import { MINUS, pctSigned, shortAddr } from "../../lib/format";
import type { LeaderSummary } from "../../lib/types";
import { useLeaders } from "../../state/data";
import { AdversarialFlag } from "../adversarial";
import { Spark } from "../charts";
import { Chip, ErrorBanner, Identicon, NansenLabel, Row, Seg, T } from "../kit";
import { useColors } from "../theme";
import { LeaderPanel } from "./LeaderPanel";
import { LCard, LaptopPage } from "./Top";
import { Table, type Col } from "./Table";

export function LaptopLeaders() {
  const c = useColors();
  const params = useLocalSearchParams<{ leader?: string }>();
  const [window, setWindow] = useState<LeaderWindow>("30d");
  const [ddCap, setDdCap] = useState(true);
  const [labeled, setLabeled] = useState(false);
  const [picked, setPicked] = useState<number | null>(params.leader ? Number(params.leader) : null);
  const q = useLeaders(window, "score");
  const list = useMemo(() => (q.data ?? []).filter((l) => !l.teamRun && (!ddCap || l.maxDrawdownPct <= 25) && (!labeled || l.nansen.labels.length > 0)), [q.data, ddCap, labeled]);
  const sel = picked ?? (params.leader ? Number(params.leader) : list[0]?.accountId ?? null);
  const days = window === "7d" ? 7 : window === "90d" ? 90 : 30;
  const cols: Col<LeaderSummary>[] = [
    { key: "rank", label: "#", flex: 0.35, render: (_l, i) => <T size={12} mono color="mu">{i + 1}</T> },
    {
      key: "trader",
      label: "Trader",
      flex: 3.4,
      render: (l) => (
        <Row gap={10}>
          <Identicon seed={l.address} size={32} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Row gap={6}>
              <T size={13} mono>{shortAddr(l.address)}</T>
              <AdversarialFlag a={l.adversarial} compact testID={`leaders.adversarial.${l.accountId}`} />
            </Row>
            <Row gap={6}>
              {l.nansen.labels[0] ? <NansenLabel label={l.nansen.labels[0]} /> : null}
              <T size={11} mono color="mu" lines={1}>{l.markets.join(" ")}</T>
            </Row>
          </View>
        </Row>
      ),
    },
    { key: "pnl", label: window.toUpperCase(), align: "right", render: (l) => <T size={13} w={600} mono color={l.pnlPct >= 0 ? "posI" : "neg"}>{pctSigned(l.pnlPct)}</T> },
    { key: "spark", label: "", flex: 0.9, render: (l) => <Spark data={l.spark ?? []} positive={l.pnlPct >= 0} /> },
    { key: "dd", label: "Max DD", align: "right", render: (l) => <T size={13} mono color={l.maxDrawdownPct > 15 ? c.neg : c.tx}>{`${MINUS}${l.maxDrawdownPct.toFixed(1)}%`}</T> },
    { key: "win", label: "Win", flex: 0.7, align: "right", render: (l) => <T size={13} mono>{l.winRate}%</T> },
    { key: "lev", label: "Lev.", flex: 0.8, align: "right", render: (l) => <T size={13} mono>{l.avgLeverage.toFixed(1)}x</T> },
    { key: "freq", label: "Per day", flex: 0.9, align: "right", render: (l) => <T size={13} mono>{(l.trades / days).toFixed(1)}</T> },
    { key: "fol", label: "Follow.", flex: 0.9, align: "right", render: (l) => <T size={13} mono>{l.followers}</T> },
    { key: "score", label: "Score", flex: 0.7, align: "right", render: (l) => <T size={13} w={600} mono>{l.score}</T> },
  ];
  return (
    <LaptopPage testID="leaders.screen" title="Leaders" sub="Ranked by Mirror score from onchain Perpl fills · labels by Nansen">
      {q.isError ? <ErrorBanner title="Can't reach Mirror" body="The leaderboard comes from our server. Try again in a moment." onRetry={() => q.refetch()} /> : null}
      <View style={{ flexDirection: "row", gap: 16, flex: 1 }}>
        <LCard style={{ flex: 1 }} testID="leaders.list">
          <Row gap={10} style={{ flexWrap: "wrap" }}>
            <Seg small testIDPrefix="leaders.window" value={window} onChange={setWindow} options={[{ key: "7d", label: "7D" }, { key: "30d", label: "30D" }, { key: "90d", label: "90D" }]} />
            <Chip label="Max DD ≤ 25%" on={ddCap} icon={ddCap ? "check" : undefined} onPress={() => setDdCap(!ddCap)} testID="leaders.filter.dd" />
            <Chip label="Nansen labeled" on={labeled} icon={labeled ? "check" : undefined} onPress={() => setLabeled(!labeled)} testID="leaders.filter.nansen" />
          </Row>
          <Table testIDPrefix="leaders.table" cols={cols} rows={list} rowKey={(l) => String(l.accountId)} selected={sel !== null ? String(sel) : null} onRow={(l) => setPicked(l.accountId)} />
          <T size={12} color="mu">Past results don't predict future returns. Click a row to open the profile on the right.</T>
        </LCard>
        {sel !== null ? (
          <LCard style={{ width: 440 }} testID="leaders.panel">
            <LeaderPanel id={sel} onClose={() => setPicked(null)} />
          </LCard>
        ) : null}
      </View>
    </LaptopPage>
  );
}
