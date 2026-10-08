// Shared "Mirror's service is down" pieces for screens whose data only comes from it (Leaders).
import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import { demoDownLine, failTitle, feedBanners, leadersErrorCopy, mirrorDownBody, noCopiesLine } from "../lib/conn";
import { timeHM } from "../lib/format";
import { scannedMinutes } from "../lib/watchRpc";
import type { useFeedView } from "../state/data";
import { Icon } from "./icons";
import { Button, Card, ChipS, ErrorBanner, Note, Row, T } from "./kit";
import type { RelayGate } from "../lib/conn";
import { useColors } from "./theme";

/** Leaders unavailable: a clear "not live yet / can't reach Mirror's service" card, or a plain error banner. */
export function LeadersError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const copy = leadersErrorCopy(error);
  if (!copy.down) return <ErrorBanner testID="leaders.error" title={copy.title} body={copy.body} onRetry={onRetry} />;
  return (
    <Card style={{ marginHorizontal: 16, padding: 20, gap: 10, alignItems: "center" }} testID="leaders.down">
      <Icon name="wifioff" size={24} color={useColors().mu} />
      <T size={17} w={600} center testID="leaders.down.title">
        {copy.title}
      </T>
      <T size={13} color="mu" center>
        {copy.body}
      </T>
      <Row gap={10} style={{ alignSelf: "stretch" }}>
        <Button title="Watch copies on Home" icon="eye" size="md" flex onPress={() => router.navigate("/home")} testID="leaders.down.home" />
        <Button title="Retry" icon="refresh" kind="out" size="md" flex onPress={onRetry} testID="leaders.down.retry" />
      </Row>
    </Card>
  );
}

/** "Try it before you follow". With the backend down it says why the demo can't run and points to Home. */
export function DemoTryCard({ down, style }: { down: boolean; style?: object }) {
  const c = useColors();
  return (
    <Card style={{ padding: 14, ...(style ?? {}) }} onPress={() => (down ? router.navigate("/home") : router.push("/demo"))} testID="leaders.demo">
      <Row gap={12}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.acs, alignItems: "center", justifyContent: "center" }}>
          <Icon name="feed" size={18} color={c.ac} />
        </View>
        <View style={{ flex: 1 }}>
          <T size={14} w={600}>
            Try it before you follow
          </T>
          <T size={12} color="mu" testID={down ? "leaders.demo.down" : undefined}>
            {down ? demoDownLine() : "Watch a copy land on the team-run demo account"}
          </T>
        </View>
        <ChipS label={down ? "Not live yet" : "Demo"} tone={down ? "neutral" : "ac"} />
      </Row>
    </Card>
  );
}

type FeedView = ReturnType<typeof useFeedView>;

/** Feed banners: "Can't reach Mirror's service" for the backend, "Can't reach Monad" only for the RPC. */
export function FeedBanners({ feed, rpc }: { feed: FeedView; rpc: { isError: boolean; dataUpdatedAt: number; refetch: () => unknown } }) {
  const which = feedBanners({ feedError: feed.isError ? (feed.error ?? true) : null, rpcError: rpc.isError });
  return (
    <>
      {which.includes("mirror") ? (
        <ErrorBanner
          testID="feed.offline"
          title={failTitle("mirror")}
          body={feed.via === "rpc" ? mirrorDownBody("feed") : `${mirrorDownBody("feed").split(".")[0]}. Showing copies from ${feed.updatedAt ? timeHM(feed.updatedAt) : "earlier"}; your limits still apply onchain.`}
          onRetry={feed.refetch}
        />
      ) : null}
      {which.includes("monad") ? (
        <ErrorBanner
          testID="feed.monadDown"
          title={failTitle("monad")}
          body={`The Monad RPC isn't answering from this device. Balances are from ${rpc.dataUpdatedAt ? timeHM(rpc.dataUpdatedAt) : "earlier"}.${which.includes("mirror") ? "" : " Mirror's service is fine and copying continues."}`}
          onRetry={() => rpc.refetch()}
        />
      ) : null}
    </>
  );
}

/** With the backend down: where the copies come from, or a plain empty state. Nothing when reading from Mirror. */
export function FeedRpcState({ feed, style }: { feed: FeedView; style?: object }) {
  if (feed.via !== "rpc") return null;
  const o = feed.own;
  const d = o.data;
  const mins = d && d.block != null && d.fromBlock != null ? scannedMinutes({ block: d.block, fromBlock: d.fromBlock }) : null;
  let title: string;
  let body: string;
  let id: string;
  if (o.isLoading || (!d && o.fetchStatus === "fetching")) [id, title, body] = ["feed.rpc.loading", "Reading your copies from Monad", "Looking for your follow accounts onchain."];
  else if (!d) [id, title, body] = ["feed.rpc.error", o.isError ? "Can't reach Monad either" : "Copies can't be read right now", o.isError ? "Neither Mirror's service nor the Monad RPC is answering. Retrying." : "This network's contracts aren't known on this device yet."];
  else if (!d.accounts.length) [id, title, body] = ["feed.rpc.noAccount", "No follow accounts yet", "This passkey has no follow accounts on Monad, so there are no copies to show. Watch mode on Home shows real copies on the demo account."];
  else if (!d.events.length) [id, title, body] = ["feed.rpc.none", noCopiesLine(mins), `Read straight from Monad for your ${d.accounts.length === 1 ? "follow account" : `${d.accounts.length} follow accounts`}. Older copies show once Mirror's service is back.`];
  else [id, title, body] = ["feed.rpc", "Read from Monad", `Your latest copies, read straight from your ${d.accounts.length === 1 ? "follow account" : "follow accounts"} onchain${mins ? ` (last ${mins} min)` : ""}.`];
  return (
    <Card style={{ marginHorizontal: 16, padding: 14, gap: 4, ...(style ?? {}) }} testID={id}>
      <T size={14} w={600}>
        {title}
      </T>
      <T size={12} color="mu">
        {body}
      </T>
    </Card>
  );
}

/** Under a relayed action's button while Mirror's service is down: why it is off. Nothing otherwise. */
export function RelayNote({ gate, testID }: { gate: RelayGate; testID: string }) {
  if (gate.ready || gate.checking) return null;
  return (
    <Note tone="warn" icon="clock" testID={testID}>
      <T size={13} w={600}>
        {gate.title}
      </T>
      <T size={12} color="mu">
        {gate.body}
      </T>
    </Note>
  );
}

/** A relayed action may start (the passkey prompt) unless Mirror's service is known to be down. */
export const relayBlocked = (gate: RelayGate) => !gate.ready && !gate.checking;
