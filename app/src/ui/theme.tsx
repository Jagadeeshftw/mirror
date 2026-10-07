// Design tokens (design/brief.md + design/app-proposal/styles.css), light and dark.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SystemUI from "expo-system-ui";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform, useColorScheme } from "react-native";

export const light = {
  bg: "#F6F6F3",
  sf: "#FFFFFF",
  sf2: "#EFEFEA",
  tx: "#0E0F12",
  mu: "#5B606B",
  bd: "#E3E3DE",
  ac: "#4B3BFF",
  acs: "#ECEAFF",
  pos: "#11914B",
  neg: "#D93A40",
  wrn: "#B7791F",
  posI: "#0F7F43",
  wrnI: "#8C5B14",
  posS: "#E4F3EA",
  negS: "#FBE8E8",
  wrnS: "#F8EEDC",
  onAc: "#FFFFFF",
  onNeg: "#FFFFFF",
  scrim: "rgba(14,15,18,0.44)",
  dark: false,
};
export type Colors = typeof light;
export const dark: Colors = {
  bg: "#0A0B0E",
  sf: "#14161B",
  sf2: "#1B1E24",
  tx: "#F2F3F5",
  mu: "#9097A3",
  bd: "#262A31",
  ac: "#8B7DFF",
  acs: "#221F3D",
  pos: "#3DD68C",
  neg: "#FF6369",
  wrn: "#FFB224",
  posI: "#3DD68C",
  wrnI: "#FFB224",
  posS: "#11261B",
  negS: "#2E1517",
  wrnS: "#2B2110",
  onAc: "#0A0B0E",
  onNeg: "#0A0B0E",
  scrim: "rgba(0,0,0,0.62)",
  dark: true,
};

// On web each family carries a system fallback, so text renders before (or without) the font files.
const UI_FALLBACK = Platform.OS === "web" ? ', system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' : "";
const MONO_FALLBACK = Platform.OS === "web" ? ', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : "";

export const fonts = {
  ui: "Inter_400Regular" + UI_FALLBACK,
  uiMedium: "Inter_500Medium" + UI_FALLBACK,
  uiSemi: "Inter_600SemiBold" + UI_FALLBACK,
  uiBold: "Inter_700Bold" + UI_FALLBACK,
  mono: "GeistMono_400Regular" + MONO_FALLBACK,
  monoMedium: "GeistMono_500Medium" + MONO_FALLBACK,
  monoSemi: "GeistMono_600SemiBold" + MONO_FALLBACK,
};

export type ThemePref = "system" | "light" | "dark";
const PREF_KEY = "mirror.theme.v1";

interface ThemeCtx {
  c: Colors;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
}
const Ctx = createContext<ThemeCtx>({ c: light, pref: "system", setPref: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("system");
  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY)
      .then((v) => {
        if (v === "light" || v === "dark" || v === "system") setPrefState(v);
      })
      .catch(() => {});
  }, []);
  const c = pref === "system" ? (scheme === "dark" ? dark : light) : pref === "dark" ? dark : light;
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);
  const value = useMemo(
    () => ({
      c,
      pref,
      setPref: (p: ThemePref) => {
        setPrefState(p);
        AsyncStorage.setItem(PREF_KEY, p).catch(() => {});
      },
    }),
    [c, pref],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
export function useColors() {
  return useContext(Ctx).c;
}
