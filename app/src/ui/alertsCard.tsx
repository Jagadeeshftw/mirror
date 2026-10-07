// "Get alerts for this follow?" after the first follow. The OS permission prompt appears only after
// "Turn on alerts". "Not now" doesn't ask again here; Settings has the switch.
import React from "react";
import { View } from "react-native";
import type { Address } from "../lib/types";
import { useAlerts } from "../state/alerts";
import { Icon } from "./icons";
import { Button, Note, Row, T } from "./kit";
import { useColors } from "./theme";

export function AlertsCard({ owner }: { owner: Address }) {
  const c = useColors();
  const alerts = useAlerts(owner);
  if (alerts.pref === "off") return null;
  if (alerts.pref === "on")
    return (
      <Note tone="ac" icon="bell" testID="follow.alerts.on.done">
        {alerts.permission === "denied" ? "Alerts are on in Mirror, but notifications are blocked for this app. You'll still see everything in the feed." : "Alerts are on. You'll hear when a copy lands, a copy is blocked by your rule, or a loss stop fires."}
      </Note>
    );
  return (
    <View testID="follow.alerts" style={{ padding: 16, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: c.ac, backgroundColor: c.sf }}>
      <Row gap={12} align="flex-start">
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.acs, alignItems: "center", justifyContent: "center" }}>
          <Icon name="bell" size={18} color={c.ac} />
        </View>
        <View style={{ flex: 1 }}>
          <T size={13} w={600}>
            Get alerts for this follow?
          </T>
          <T size={12} color="mu">
            When a copy lands, a copy is blocked by your rule, or a loss stop fires.
          </T>
        </View>
      </Row>
      <Row gap={10}>
        <Button title="Not now" kind="txt" size="md" flex onPress={alerts.turnOff} testID="follow.alerts.notNow" />
        <Button title="Turn on alerts" icon="bell" size="md" flex onPress={alerts.turnOn} testID="follow.alerts.enable" />
      </Row>
    </View>
  );
}
