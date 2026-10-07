// Settings → Network: each side checked directly from this device. "Can't reach Monad" is about the
// RPC, "Can't reach Mirror" about our server; the rows say which one is down.
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import { View } from "react-native";
import { getApiBase } from "../lib/api";
import { hostOf, useMirrorHealth, useRpcHealth } from "../state/conn";
import { useConfig } from "../state/data";
import { Icon, type IconName } from "./icons";
import { Card, Link, Row, T } from "./kit";
import { LiveDot } from "./kit2";
import { useColors } from "./theme";

function NetRow({ icon, title, sub, right, testID }: { icon: IconName; title: string; sub: string; right: React.ReactNode; testID: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, paddingHorizontal: 14 }}>
      <Icon name={icon} size={20} color={c.mu} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={13}>{title}</T>
        <T size={12} mono color="mu" testID={`${testID}.detail`}>
          {sub}
        </T>
      </View>
      {right}
    </View>
  );
}

export function NetworkRows() {
  const qc = useQueryClient();
  const cfg = useConfig().data;
  const rpc = useRpcHealth(30_000);
  const api = useMirrorHealth(30_000);
  const at = Math.max(rpc.dataUpdatedAt, rpc.errorUpdatedAt, api.dataUpdatedAt, api.errorUpdatedAt);
  return (
    <>
      <Card list>
        <NetRow
          testID="settings.net.monad"
          icon="globe"
          title={`Monad RPC · chain ${cfg?.chainId ?? 143} · checked from this device`}
          sub={rpc.data ? `${rpc.data.host} · ${rpc.data.ms} ms · block ${Number(rpc.data.block).toLocaleString("en-US")}` : rpc.isError ? "Can't reach Monad" : "Checking"}
          right={<LiveDot on={!!rpc.data && !rpc.isError} label={rpc.isError ? "Offline" : rpc.data ? "Online" : "Checking"} />}
        />
        <NetRow
          testID="settings.net.mirror"
          icon="activity"
          title="Mirror server"
          sub={api.data ? `${hostOf(getApiBase())} · ${api.data.ms} ms` : api.isError ? "Can't reach Mirror" : "Checking"}
          right={<LiveDot on={!!api.data && !api.isError} label={api.isError ? "Offline" : api.data ? "Online" : "Checking"} />}
        />
        <NetRow
          testID="settings.net.checked"
          icon="clock"
          title={at ? `Last checked ${new Date(at).toLocaleTimeString("en-GB")}` : "Checking"}
          sub="Both checked directly, every 30 s while open"
          right={<Link title="Check now" testID="settings.net.check" onPress={() => { qc.invalidateQueries({ queryKey: ["rpcHealth"] }); qc.invalidateQueries({ queryKey: ["mirrorHealth"] }); }} />}
        />
      </Card>
      <Row>
        <T size={12} color="mu">If only one is down, the app says which: "Can't reach Monad" for the RPC, "Can't reach Mirror" for our server.</T>
      </Row>
    </>
  );
}
