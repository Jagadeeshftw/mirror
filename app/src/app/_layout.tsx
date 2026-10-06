import "../lib/push"; // registers the encrypted-push background task at module load
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { listenForEncryptedPush, registerForPush, setupNotifications } from "../lib/push";
import { LiveProvider } from "../state/live";
import { SessionProvider, useSession } from "../state/session";
import { ThemeProvider, useColors } from "../ui/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const c = useColors();
  const { ready, account } = useSession();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  useEffect(() => {
    setupNotifications().catch(() => {});
    const sub = listenForEncryptedPush();
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (account) registerForPush(account.address).catch(() => {});
  }, [account?.address]);
  if (!ready) return null;
  return (
    <>
      <StatusBar style={c.dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, animation: "none", contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="follow/[id]" options={{ presentation: "transparentModal", animation: "none", contentStyle: { backgroundColor: "transparent" } }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } } }));
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <SessionProvider>
            <LiveProvider>
              <Shell />
            </LiveProvider>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
