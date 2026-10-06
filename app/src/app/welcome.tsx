import * as Device from "expo-device";
import { router } from "expo-router";
import React, { useState } from "react";
import { TextInput, View } from "react-native";
import { DEFAULT_API_BASE, getApiBase, setApiBaseOverride } from "../lib/api";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createAccount, devPasskeyActive, describeError } from "../lib/wallet";
import { useSession } from "../state/session";
import { Icon } from "../ui/icons";
import { BrandMark, Button, Dialog, Identicon, NansenLabel, Note, Press, Row, Scroll, Side, T } from "../ui/kit";
import { fonts, useColors } from "../ui/theme";

// Module-local so the minifier folds it to false in release builds and drops dev-only UI.
const DEV_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_MIRROR_DEV_TOOLS === "1";

export default function Welcome() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { setAccount } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [apiOpen, setApiOpen] = useState(false);
  const [api, setApi] = useState(getApiBase());

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const a = await createAccount(Device.modelName ?? undefined);
      setAccount(a);
      router.replace("/home");
    } catch (e) {
      const d = describeError(e);
      if (!d.cancelled) setError(d);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="onboarding.screen" style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Scroll contentStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12, gap: 18, flexGrow: 1 }}>
        <Press onLongPress={DEV_TOOLS ? () => setApiOpen(true) : undefined} delayLongPress={600} testID="onboarding.brand" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <BrandMark size={32} />
          <T size={20} w={700} style={{ letterSpacing: -0.2 }}>
            Mirror
          </T>
          <View style={{ flex: 1 }} />
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.sf2 }}>
            <T size={11} w={600} color="mu">
              Beta
            </T>
          </View>
        </Press>

        <View accessibilityLabel="Example copy" style={{ marginTop: 12 }}>
          <View style={{ backgroundColor: c.sf, borderWidth: 1, borderColor: c.bd, borderRadius: 16, padding: 14, gap: 6 }}>
            <Row gap={8}>
              <Identicon seed="0x7a3f…c91e" size={28} />
              <T size={14} w={500} mono>
                0x7a3f…c91e
              </T>
              <NansenLabel label="Smart Trader" />
            </Row>
            <Row gap={6}>
              <T size={13} color="mu">
                Opened
              </T>
              <T size={13} w={600}>
                BTC
              </T>
              <Side side="Long" />
              <T size={13} mono color="mu">
                1.20 BTC · 4x
              </T>
            </Row>
          </View>
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <View style={{ position: "absolute", top: 0, bottom: 0, left: "50%", borderLeftWidth: 1, borderLeftColor: c.bd }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.sf2, paddingLeft: 7, paddingRight: 9, paddingVertical: 3, borderRadius: 999 }}>
              <Icon name="feed" size={14} color={c.ac} />
              <T size={12} w={500} mono>
                copied in 0.61 s
              </T>
            </View>
          </View>
          <View style={{ backgroundColor: c.sf, borderWidth: 1, borderColor: c.ac, borderRadius: 16, padding: 14, gap: 6, shadowColor: c.ac }}>
            <Row gap={8}>
              <BrandMark size={28} />
              <T size={14} w={600}>
                Your copy
              </T>
              <View style={{ flex: 1 }} />
              <Icon name="check" size={14} color={c.posI} />
              <T size={12} w={600} color="posI">
                Finalized
              </T>
            </Row>
            <T size={13} mono>
              0.00012 BTC · 14.21 AUSD · 4x
            </T>
            <Row gap={6} style={{ paddingTop: 6, borderTopWidth: 1, borderTopColor: c.bd }}>
              <Icon name="shield" size={14} color={c.ac} />
              <T size={12} color="mu" style={{ flex: 1 }}>
                Checked onchain: under your 5x and 15.00 AUSD limits
              </T>
            </Row>
          </View>
        </View>

        <T size={28} w={700} lh={32} style={{ letterSpacing: -0.7, marginTop: 8 }}>
          Copy top Perpl traders. Your limits, enforced onchain.
        </T>
        <T size={15} color="mu" lh={22}>
          A smart contract checks every copied order against your rules. Mirror can trade for you but can never withdraw.
        </T>
        {error ? (
          <Note tone="neg" icon="warn" testID="onboarding.error">
            <T size={13} w={600}>
              {error.title}
            </T>
            <T size={12} color="mu">
              {error.detail}
            </T>
          </Note>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={{ gap: 8 }}>
          <Button title={busy ? "Waiting for your passkey" : "Create account"} icon="fp" onPress={create} disabled={busy} testID="onboarding.createAccount" />
          <Button title="I already have an account" kind="txt" onPress={() => router.push("/restore")} testID="onboarding.restore" />
        </View>
        <T size={12} color="mu" center lh={17}>
          One passkey. No seed phrase, no extension.{"\n"}Passkeys by Mera · Built on Monad · Trades on Perpl
          {DEV_TOOLS && devPasskeyActive() ? "\nDev build: passkey simulator" : ""}
        </T>
      </Scroll>
      {DEV_TOOLS ? (
      <Dialog visible={apiOpen} onClose={() => setApiOpen(false)} testID="onboarding.apiDialog">
        <T size={17} w={600}>
          Backend
        </T>
        <T size={12} color="mu">
          Developer setting. A local http mock (localhost, 10.0.2.2) switches on the emulator passkey simulator.
        </T>
        <TextInput
          testID="onboarding.apiBase.input"
          value={api}
          onChangeText={setApi}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ fontFamily: fonts.mono, fontSize: 12, color: c.tx, padding: 10, borderRadius: 10, backgroundColor: c.sf2 }}
        />
        <Row gap={8} justify="flex-end">
          <Button title="Cancel" kind="txt" size="md" onPress={() => setApiOpen(false)} />
          <Button
            title="Save"
            size="md"
            testID="onboarding.apiBase.save"
            onPress={async () => {
              await setApiBaseOverride(api.trim() === DEFAULT_API_BASE ? null : api.trim());
              setApiOpen(false);
            }}
          />
        </Row>
      </Dialog>
      ) : null}
    </View>
  );
}
