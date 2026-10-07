// Laptop top bar: title and subtitle, the AUSD balance chip, Add funds and alerts.
import { router } from "expo-router";
import React from "react";
import { ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { BalanceChip } from "../chrome";
import { Button, IconButton, T } from "../kit";
import { useColors } from "../theme";

export function LaptopTop({ title, sub, extra }: { title: string; sub?: string; extra?: React.ReactNode }) {
  const c = useColors();
  return (
    <View testID="layout.laptop.topbar" style={{ height: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 28, borderBottomWidth: 1, borderBottomColor: c.bd }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={22} w={600} style={{ letterSpacing: -0.3 }} testID="layout.laptop.title">
          {title}
        </T>
        {sub ? (
          <T size={12} color="mu" lines={1}>
            {sub}
          </T>
        ) : null}
      </View>
      {extra}
      <BalanceChip />
      <Button title="Add funds" icon="arrdown" kind="ton" size="sm" onPress={() => router.push("/funds")} testID="layout.laptop.addFunds" />
      <View style={{ borderWidth: 1, borderColor: c.bd, borderRadius: 999 }}>
        <IconButton name="bell" onPress={() => router.push("/notifications")} testID="layout.laptop.alerts" />
      </View>
    </View>
  );
}

/** Screen body: fills the width; scrolls when the window is shorter than the composition. */
export function LaptopPage({ title, sub, extra, children, testID, contentStyle }: { title: string; sub?: string; extra?: React.ReactNode; children: React.ReactNode; testID?: string; contentStyle?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: c.bg }}>
      <LaptopTop title={title} sub={sub} extra={extra} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ padding: 20, paddingHorizontal: 28, gap: 16, flexGrow: 1 }, contentStyle]}>
        {children}
      </ScrollView>
    </View>
  );
}

/** Card used across the laptop compositions (.lc). */
export function LCard({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={[{ backgroundColor: c.sf, borderWidth: 1, borderColor: c.bd, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 18, gap: 12, minWidth: 0 }, style]}>
      {children}
    </View>
  );
}
