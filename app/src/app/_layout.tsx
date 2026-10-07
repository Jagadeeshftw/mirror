import "../lib/push"; // registers the encrypted-push background task at module load
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname } from "expo-router";
import { useFonts } from "expo-font";
import { Platform } from "react-native";
import { installPwa } from "../lib/pwa";
import { LaptopFrame } from "../ui/laptop/Frame";
import { useLayout } from "../ui/layout";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { listenForEncryptedPush, registerForPush, setupNotifications } from "../lib/push";
import { LiveProvider } from "../state/live";
import { SessionProvider, useSession } from "../state/session";
import { ThemeProvider, useColors } from "../ui/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Android embeds the fonts at build time (expo-font plugin); the web build loads the same files here. They are
// vendored under assets/fonts so the web export never puts them under a node_modules path (hosts such as Vercel
// do not serve those). Web never waits on them: every family in theme.fonts falls back to a system stack, so
// the app renders at once and swaps to Inter / Geist Mono when (if) they arrive.
const WEB_FONTS =
  Platform.OS === "web"
    ? {
        Inter_400Regular: require("../../assets/fonts/Inter_400Regular.ttf"),
        Inter_500Medium: require("../../assets/fonts/Inter_500Medium.ttf"),
        Inter_600SemiBold: require("../../assets/fonts/Inter_600SemiBold.ttf"),
        Inter_700Bold: require("../../assets/fonts/Inter_700Bold.ttf"),
        GeistMono_400Regular: require("../../assets/fonts/GeistMono_400Regular.ttf"),
        GeistMono_500Medium: require("../../assets/fonts/GeistMono_500Medium.ttf"),
        GeistMono_600SemiBold: require("../../assets/fonts/GeistMono_600SemiBold.ttf"),
      }
    : {};

function Shell() {
  const c = useColors();
  const { ready, account } = useSession();
  useFonts(WEB_FONTS);
  const layout = useLayout();
  const path = usePathname();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  useEffect(() => {
    installPwa();
  }, []);
  useEffect(() => {
    setupNotifications().catch(() => {});
    const sub = listenForEncryptedPush();
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (account) registerForPush(account.address).catch(() => {});
  }, [account?.address]);
  if (!ready) return null;
  const stack = (
    <Stack screenOptions={{ headerShown: false, animation: "none", animationDuration: 0, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="follow/[id]" options={{ presentation: "transparentModal", animation: "none", contentStyle: { backgroundColor: "transparent" } }} />
    </Stack>
  );
  const framed = layout === "laptop" && !!account && !/^\/(welcome|restore)?$/.test(path);
  return (
    <>
      <StatusBar style={c.dark ? "light" : "dark"} />
      {framed ? <LaptopFrame>{stack}</LaptopFrame> : stack}
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
