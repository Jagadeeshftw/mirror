import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { ausd, ausdSigned, shortAddr, timeHM } from "../lib/format";
import { isLeaderDetached } from "../lib/budgets";
import { useConfig, useTotals } from "../state/data";
import { useOwnerAction } from "../state/ownerAction";
import { useSession } from "../state/session";
import { AppBar } from "../ui/chrome";
import { CloseAllDialog } from "../ui/closeAll";
import { Icon, type IconName } from "../ui/icons";
import { Button, Card, IconButton, Identicon, LoadingBlock, Note, Press, Row, Screen, Scroll, Switch, T } from "../ui/kit";
import { useColors } from "../ui/theme";
import { followerChoices, ShareSheet } from "../ui/shareSheet";
import { StopFollowSheet } from "../ui/stopFollow";

function SetRow({ icon, title, sub, onPress, testID }: { icon: IconName; title: string; sub?: string; onPress?: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Press testID={testID} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, paddingHorizontal: 14 }}>
      <Icon name={icon} size={20} color={c.mu} />
      <View style={{ flex: 1 }}>
        <T size={13}>{title}</T>
        {sub ? (
          <T size={12} color="mu">
            {sub}
          </T>
        ) : null}
      </View>
      <Icon name="chev" size={18} color={c.mu} />
    </Press>
  );
}

export default function AccountControls() {
  const c = useColors();
  const { account: me } = useSession();
  const cfg = useConfig().data;
  const { totals } = useTotals();
  const act = useOwnerAction();
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState<number | null>(null);
  const [stopping, setStopping] = useState<number | null>(null);
  if (!me) return null;
  const accts = totals?.accounts ?? [];
  const allPaused = accts.length > 0 && accts.every((a) => a.paused);
  const open = totals?.openPositions ?? 0;

  return (
    <Screen>
      <AppBar title="Account" showBack noAv />
      <Scroll contentStyle={{ paddingHorizontal: 20, paddingTop: 4, gap: 16 }} testID="account.screen">
        <Card style={{ padding: 18, gap: 12 }}>
          <Row gap={12}>
            <Identicon seed={me.address} size={36} />
            <View style={{ flex: 1 }}>
              <T size={14} w={600} mono testID="account.address">
                {shortAddr(me.address)}
              </T>
              <T size={12} color="mu">
                Passkey account{me.device ? ` · ${me.device}` : ""}
              </T>
            </View>
            <IconButton
              name={copied ? "check" : "copy"}
              small
              testID="account.copyAddress"
              onPress={async () => {
                await Clipboard.setStringAsync(me.address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
          </Row>
          {totals ? (
            <Row>
              {[
                ["Equity", ausd(totals.equity)],
                ["Withdrawable", ausd(totals.withdrawable)],
                ["In wallet", ausd(totals.wallet)],
              ].map(([k, v]) => (
                <View key={k} style={{ flex: 1, gap: 2 }}>
                  <T size={12} color="mu">
                    {k}
                  </T>
                  <T size={16} w={500} mono>
                    {v}
                  </T>
                </View>
              ))}
            </Row>
          ) : (
            <LoadingBlock />
          )}
          <Row gap={8}>
            <Button title="Add funds" icon="arrdown" kind="ton" size="md" flex onPress={() => router.push("/funds")} testID="account.addFunds" />
            <Button title="Withdraw" icon="arrup" kind="out" size="md" flex onPress={() => router.push("/withdraw")} testID="account.withdraw" />
            <Button icon="send" kind="out" size="md" onPress={() => router.push("/send")} testID="account.send" style={{ width: 44, paddingHorizontal: 0 }} />
          </Row>
        </Card>

        {accts.length ? (
          <Card style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
            <Row gap={12} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.bd }}>
              <View style={{ flex: 1 }}>
                <T size={14} w={600}>
                  Pause all following
                </T>
                <T size={12} color="mu">
                  {allPaused ? `Paused ${timeHM(Date.now())}. New leader trades are not copied.` : "Stop copying new trades. Open positions stay open and still follow the leader's closes (Stop following, keep my positions refuses those too)."}
                </T>
              </View>
              <Switch on={allPaused} onChange={(v) => act.setPaused(accts.filter((a) => a.paused !== v), v)} disabled={!!act.busy} testID="account.pauseAll" />
            </Row>
            {accts.map((a, i) => (
              <Row key={a.account} gap={12} style={{ paddingVertical: 10, borderBottomWidth: i < accts.length - 1 ? 1 : 0, borderBottomColor: c.bd }}>
                <Identicon seed={a.leader?.address ?? a.account} size={28} />
                <T size={13} w={500} mono style={{ flex: 1 }}>
                  {shortAddr(a.leader?.address ?? a.account)}
                </T>
                <T size={12} color="mu" testID={`account.follow.${i}.status`}>
                  {a.leader && isLeaderDetached(a, a.leader.accountId) ? "Stopped, positions kept" : a.paused ? "Paused" : "Copying"}
                </T>
                <IconButton name="share" small onPress={() => setSharing(i)} testID={`account.follow.${i}.share`} />
                <IconButton name="close" small onPress={() => setStopping(i)} testID={`account.follow.${i}.stop`} />
                <Switch on={!a.paused} onChange={(v) => act.setPaused([a], !v)} disabled={!!act.busy} testID={`account.follow.${i}.toggle`} />
              </Row>
            ))}
          </Card>
        ) : null}
        <StopFollowSheet visible={stopping !== null} onClose={() => setStopping(null)} account={stopping !== null ? accts[stopping] : null} leaderId={stopping !== null ? (accts[stopping]?.leader?.accountId ?? 0) : 0} leaderAddress={stopping !== null ? accts[stopping]?.leader?.address : undefined} cfg={cfg} act={act} />
        <ShareSheet visible={sharing !== null} onClose={() => setSharing(null)} targets={sharing !== null && accts[sharing] ? followerChoices([accts[sharing]]) : []} />

        <Card style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
          <Row gap={12}>
            <View style={{ flex: 1 }}>
              <T size={14} w={600} color="neg">
                Close all positions
              </T>
              <T size={12} mono color="mu">
                {open} open · unrealised {ausdSigned(totals?.upnl ?? 0n)} AUSD
              </T>
            </View>
            <Button title="Close all" kind="dngO" size="sm" onPress={() => setConfirm(true)} disabled={open === 0} testID="account.closeAll" />
          </Row>
        </Card>
        {act.error && !confirm && stopping === null ? <Note tone="neg" icon="warn" testID="account.error">{act.error}</Note> : null}
        {act.busy ? <Note tone="ac" icon="fp">Confirm with your passkey. One prompt signs every account.</Note> : null}

        <Card list>
          <SetRow icon="bell" title="Notifications" onPress={() => router.push("/notifications")} testID="account.notifications" />
          <SetRow icon="gear" title="Settings" onPress={() => router.push("/settings")} testID="account.settings" />
          <SetRow icon="feed" title="Team-run demo" sub="Watch a copy land, or get blocked" onPress={() => router.push("/demo")} testID="account.demo" />
        </Card>
        <Note icon="shield">Mirror can trade within your rules but can never withdraw. Only your passkey can move funds out.</Note>
      </Scroll>
      <CloseAllDialog
        visible={confirm}
        accounts={accts}
        cfg={cfg}
        busy={act.busy === "closeAll"}
        error={act.error}
        onCancel={() => {
          setConfirm(false);
          act.clearError();
        }}
        onConfirm={async () => {
          const r = await act.closeAll(accts);
          if (r) setConfirm(false);
        }}
      />
    </Screen>
  );
}
