// Laptop shell (web, >= 1024 px): left sidebar with the app sections and the public pages, the
// beta deposit limit and who is signed in. Each laptop screen draws its own top bar (LaptopTop).
import * as Linking from "expo-linking";
import { router, usePathname } from "expo-router";
import React from "react";
import { View } from "react-native";
import { ausd, shortAddr } from "../../lib/format";
import { VERSION_LABEL } from "../../lib/version";
import { followLimits } from "../../lib/policy";
import { useConfig, useFeedAll, useTotals } from "../../state/data";
import { useSession } from "../../state/session";
import { Icon, type IconName } from "../icons";
import { BrandMark, Identicon, Meter, Press, Row, T } from "../kit";
import { useColors } from "../theme";

const NAV: { key: string; label: string; icon: IconName; href: string }[] = [
  { key: "home", label: "Home", icon: "home", href: "/home" },
  { key: "leaders", label: "Leaders", icon: "leaders", href: "/leaders" },
  { key: "feed", label: "Feed", icon: "feed", href: "/feed" },
  { key: "positions", label: "Positions", icon: "positions", href: "/positions" },
];
const PUBLIC: { key: string; label: string; icon: IconName; url: string }[] = [
  { key: "analytics", label: "Perpl analytics", icon: "activity", url: "https://mirror.0xo.in/perpl" },
  { key: "stats", label: "Mirror stats", icon: "stats", url: "https://mirror.0xo.in/stats" },
];

function NavRow({ on, icon, label, badge, onPress, testID }: { on?: boolean; icon: IconName; label: string; badge?: number; onPress: () => void; testID: string }) {
  const c = useColors();
  return (
    <Press testID={testID} onPress={onPress} accessibilityRole="link" accessibilityState={{ selected: !!on }} style={{ flexDirection: "row", alignItems: "center", gap: 12, height: 42, paddingHorizontal: 12, borderRadius: 12, backgroundColor: on ? c.acs : "transparent" }}>
      <Icon name={icon} size={20} color={on ? c.ac : c.mu} />
      <T size={14} w={on ? 600 : 500} color={on ? c.ac : c.mu} style={{ flex: 1 }}>
        {label}
      </T>
      {badge ? (
        <View style={{ minWidth: 18, height: 18, borderRadius: 999, backgroundColor: c.neg, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
          <T size={10} mono color={c.onNeg}>
            {badge}
          </T>
        </View>
      ) : null}
    </Press>
  );
}

export function LaptopFrame({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const path = usePathname();
  const { account } = useSession();
  const { totals } = useTotals();
  const feed = useFeedAll();
  const blocked = feed.events.filter((e) => e.kind === "Blocked" && e.timestamp > Date.now() - 24 * 3600e3).length;
  const active = path.startsWith("/leader") ? "leaders" : path.replace(/^\//, "").split("/")[0] || "home";
  const deposited = totals?.deposited ?? 0n;
  // The factory's per-account deposit cap from the network config (200 test AUSD on testnet), per follow account.
  const cap = followLimits(useConfig().data).capCNS * BigInt(Math.max(1, totals?.accounts.length ?? 1));
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.bg }}>
      <View testID="layout.laptop.sidebar" style={{ width: 240, backgroundColor: c.sf, borderRightWidth: 1, borderRightColor: c.bd, paddingVertical: 18, paddingHorizontal: 14, gap: 4 }}>
        <Row gap={10} style={{ paddingHorizontal: 8, paddingBottom: 18 }}>
          <BrandMark size={28} />
          <T size={18} w={700} style={{ flex: 1, letterSpacing: -0.2 }}>
            Mirror
          </T>
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.sf2 }}>
            <T size={11} w={600} color="mu">
              Beta
            </T>
          </View>
        </Row>
        {NAV.map((n) => (
          <NavRow key={n.key} testID={`layout.laptop.nav.${n.key}`} on={active === n.key} icon={n.icon} label={n.label} badge={n.key === "feed" ? blocked : undefined} onPress={() => router.navigate(n.href as any)} />
        ))}
        <T size={11} w={500} color="mu" upper style={{ paddingTop: 16, paddingBottom: 6, paddingHorizontal: 12 }}>
          Public
        </T>
        {PUBLIC.map((n) => (
          <NavRow key={n.key} testID={`layout.laptop.nav.${n.key}`} icon={n.icon} label={n.label} onPress={() => Linking.openURL(n.url)} />
        ))}
        <View style={{ flex: 1 }} />
        <View testID="layout.laptop.cap" style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: c.sf2, marginBottom: 8 }}>
          <Row>
            <T size={12} color="mu" style={{ flex: 1 }}>
              Beta deposit limit
            </T>
            <T size={12} mono>
              {ausd(deposited)} / {ausd(cap)}
            </T>
          </Row>
          <Meter height={6} parts={[{ frac: Number(deposited) / Number(cap), color: c.ac }]} />
        </View>
        <Press testID="layout.laptop.me" onPress={() => router.navigate("/settings")} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: c.bd }}>
          {account ? <Identicon seed={account.address} size={32} /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={13} mono>
              {shortAddr(account?.address)}
            </T>
            <T size={12} color="mu">
              Passkey · {VERSION_LABEL}
            </T>
          </View>
          <Icon name="gear" size={18} color={c.mu} />
        </Press>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}
