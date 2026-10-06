import { Tabs } from "expo-router";
import React from "react";
import { useFeedAll } from "../../state/data";
import { BottomNav } from "../../ui/chrome";
import { useColors } from "../../ui/theme";

function Bar({ state, navigation }: any) {
  const feed = useFeedAll();
  const since = Date.now() - 24 * 3600e3;
  const blocked = feed.events.filter((e) => e.kind === "Blocked" && e.timestamp > since).length;
  return <BottomNav active={state.routes[state.index].name} badge={blocked || undefined} onSelect={(k) => navigation.navigate(k)} />;
}

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs
      tabBar={(props) => <Bar {...props} />}
      screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: c.bg } }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="leaders" />
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="positions" />
    </Tabs>
  );
}
