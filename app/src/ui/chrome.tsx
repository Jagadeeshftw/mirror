// App chrome: app bar with the persistent AUSD balance chip, bottom navigation.
import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ausd } from "../lib/format";
import { useConfig, useTotals, useWallet } from "../state/data";
import { ausdUnit } from "../lib/config";
import { useSession } from "../state/session";
import { Icon, type IconName } from "./icons";
import { BrandMark, Coin, IconButton, Identicon, Press, T, back } from "./kit";
import { useColors } from "./theme";

export function BalanceChip({ value, onPress }: { value?: bigint | null; onPress?: () => void }) {
  const c = useColors();
  const { totals } = useTotals();
  const cfg = useConfig().data;
  const wallet = useWallet();
  // Before Mirror answers (or while it is down) the wallet balance read from Monad is still shown.
  const v = value !== undefined ? value : (totals?.balance ?? (wallet.source === "rpc" ? wallet.cns : null));
  return (
    <Press
      testID="nav.balance"
      accessibilityLabel={`AUSD balance ${v === null ? "loading" : ausd(v)}`}
      onPress={onPress ?? (() => router.push("/account"))}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingLeft: 5, paddingRight: 12, borderRadius: 999, backgroundColor: c.sf, borderWidth: 1, borderColor: c.bd }}
    >
      <Coin />
      <T testID="home.balance.ausd" size={14} w={600} mono>
        {v === null ? "—" : ausd(v)}
      </T>
      <T size={11} w={500} color="mu">
        {ausdUnit(cfg?.chainId)}
      </T>
    </Press>
  );
}

export function AppBar({
  title,
  brand,
  onBack,
  showBack,
  noBal,
  noAv,
  right,
  addr,
  closeIcon,
  testID,
}: {
  title?: string;
  brand?: boolean;
  onBack?: () => void;
  showBack?: boolean;
  noBal?: boolean;
  noAv?: boolean;
  right?: React.ReactNode;
  addr?: boolean;
  closeIcon?: boolean;
  testID?: string;
}) {
  const { account } = useSession();
  return (
    <View testID={testID} style={{ height: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 12, paddingRight: 16 }}>
      {showBack || onBack ? <IconButton name={closeIcon ? "close" : "back"} testID="nav.back" onPress={onBack ?? back} /> : null}
      {brand ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8, flex: 1 }}>
          <BrandMark size={26} />
          <T size={18} w={700} style={{ letterSpacing: -0.2 }}>
            Mirror
          </T>
        </View>
      ) : (
        <T size={addr ? 16 : 22} w={addr ? 500 : 600} mono={addr} lines={1} style={{ flex: 1, paddingLeft: showBack || onBack || addr ? 0 : 8, letterSpacing: addr ? -0.16 : -0.2 }}>
          {title ?? ""}
        </T>
      )}
      {right}
      {noBal ? null : <BalanceChip />}
      {noAv || !account ? null : (
        <Press testID="nav.account" onPress={() => router.push("/account")} accessibilityLabel="Account">
          <Identicon seed={account.address} size={34} />
        </Press>
      )}
    </View>
  );
}

const TAB_IDS: Record<string, string> = { home: "home.tab.home", leaders: "home.tab.leaders", feed: "home.tab.activity", positions: "home.tab.portfolio" };
const TABS: { key: string; label: string; icon: IconName; href: string }[] = [
  { key: "home", label: "Home", icon: "home", href: "/home" },
  { key: "leaders", label: "Leaders", icon: "leaders", href: "/leaders" },
  { key: "feed", label: "Feed", icon: "feed", href: "/feed" },
  { key: "positions", label: "Positions", icon: "positions", href: "/positions" },
];

export function BottomNav({ active, onSelect, badge }: { active: string; onSelect: (key: string) => void; badge?: number }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: "row", backgroundColor: c.sf, borderTopWidth: 1, borderTopColor: c.bd, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 8) }}>
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Press key={t.key} testID={TAB_IDS[t.key]} onPress={() => onSelect(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={{ flex: 1, alignItems: "center", gap: 4 }} pressedStyle={{ opacity: 0.7 }}>
            <View style={{ width: 60, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.acs : "transparent" }}>
              <Icon name={t.icon} size={22} color={on ? c.ac : c.mu} />
              {badge && t.key === "feed" ? (
                <View style={{ position: "absolute", top: 1, right: 12, minWidth: 16, height: 16, borderRadius: 999, backgroundColor: c.neg, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                  <T size={10} mono color={c.onNeg}>
                    {badge}
                  </T>
                </View>
              ) : null}
            </View>
            <T size={12} w={on ? 600 : 500} color={on ? c.tx : c.mu}>
              {t.label}
            </T>
          </Press>
        );
      })}
    </View>
  );
}
