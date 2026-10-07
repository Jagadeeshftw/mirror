import { useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { DEFAULT_API_BASE, getApiBase, setApiBaseOverride } from "../lib/api";
import { addressUrl } from "../lib/chain";
import { dateShort, shortAddr } from "../lib/format";
import { fingerprint } from "../lib/notifyKey";
import { NS_NOTIFY_LABEL } from "../lib/prfNamespaces";
import { registerForPush, type PushRegistration } from "../lib/push";
import { devPasskeyActive, describeError, exportRecoveryPhrase, loadNotifyKey, RP_ID } from "../lib/wallet";
import { useConfig, useTotals } from "../state/data";
import { useSession } from "../state/session";
import { AppBar } from "../ui/chrome";
import { Icon, type IconName } from "../ui/icons";
import { Button, Card, Dialog, Lbl, Note, Press, Row, Screen, Scroll, Seg, Switch, T } from "../ui/kit";
import { NetworkRows } from "../ui/netRows";
import { useAlerts } from "../state/alerts";
import { VERSION_LABEL } from "../lib/version";
import { BUILDER_ID, FEE_PCT, FEES_DOC_URL } from "../lib/fees";
import { fonts, useColors, useTheme, type ThemePref } from "../ui/theme";

// Module-local so the minifier folds it to false in release builds and drops dev-only UI.
const DEV_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_MIRROR_DEV_TOOLS === "1";

function SetRow({ icon, title, sub, right, onPress, testID }: { icon: IconName; title: string; sub?: React.ReactNode; right?: React.ReactNode; onPress?: () => void; testID?: string }) {
  const c = useColors();
  const body = (
    <>
      <Icon name={icon} size={20} color={c.mu} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={13}>{title}</T>
        {typeof sub === "string" ? (
          <T size={12} color="mu">
            {sub}
          </T>
        ) : (
          sub
        )}
      </View>
      {right}
    </>
  );
  const style = { flexDirection: "row" as const, alignItems: "center" as const, gap: 14, paddingVertical: 13, paddingHorizontal: 14 };
  return onPress ? (
    <Press testID={testID} onPress={onPress} style={style}>
      {body}
    </Press>
  ) : (
    <View testID={testID} style={style}>
      {body}
    </View>
  );
}

function channelLabel(r: PushRegistration): string {
  if (!r.registered) return "Not registered yet";
  if (r.channel === "webpush") return "Registered · Web Push";
  if (r.channel === "fcm" || r.channel === "expo") return "Registered · Android push";
  return "Registered · in-app delivery while open";
}

export default function Settings() {
  const c = useColors();
  const qc = useQueryClient();
  const { pref, setPref } = useTheme();
  const { account, signOut } = useSession();
  const cfg = useConfig().data;
  const { totals } = useTotals();
  const [fp, setFp] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string>("Registering");
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [phraseErr, setPhraseErr] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [api, setApi] = useState(getApiBase());
  const alerts = useAlerts(account?.address);

  useEffect(() => {
    loadNotifyKey().then((k) => setFp(k ? fingerprint(k.publicKey) : null));
    if (account) registerForPush(account.address).then((r) => setRegistered(channelLabel(r)));
  }, [account?.address]);
  useEffect(() => {
    if (alerts.registration) setRegistered(channelLabel(alerts.registration));
  }, [alerts.registration]);

  if (!account) return null;
  const ext = <Icon name="ext" size={16} color={c.mu} />;

  return (
    <Screen>
      <AppBar title="Settings" showBack noAv />
      <Scroll contentStyle={{ paddingHorizontal: 20, paddingTop: 4, gap: 10 }} testID="settings.screen">
        <Lbl style={{ marginTop: 8 }}>Security</Lbl>
        <Card list>
          <SetRow icon="fp" title="Passkey" sub={`${DEV_TOOLS && devPasskeyActive() ? "Dev passkey simulator (dev build)" : Platform.OS === "web" ? "Synced passkey, or your phone via QR" : "Synced by Google Password Manager"} · ${RP_ID} · ${account.restored ? "restored" : "created"} ${dateShort(account.createdAt)}`} />
          <SetRow
            icon="phone"
            title={account.device ?? "This phone"}
            sub="Signed in · active now"
            right={
              <Press onPress={() => setConfirmSignOut(true)} testID="settings.signOut" hitSlop={8}>
                <T size={13} w={600} color="ac">
                  Sign out
                </T>
              </Press>
            }
          />
          <SetRow
            icon="key"
            testID="settings.notifyKey"
            title="Notification encryption key — derived from your passkey"
            sub={
              <View style={{ gap: 2 }}>
                <T size={12} color="mu">
                  X25519 · never signs transactions · {registered}
                </T>
                <T size={12} mono color="mu" testID="settings.notifyKey.fingerprint">
                  {fp ?? "Not on this device"}
                </T>
                <T size={11} color="mu">
                  Separate PRF namespace "{NS_NOTIFY_LABEL}" of your passkey, read in the same prompt. Never signs. Decrypts push and seals private follow notes.
                </T>
              </View>
            }
          />
          <SetRow
            icon="doc"
            title="Export recovery phrase"
            sub="Optional. Asks for your passkey. Anyone with the phrase controls your funds."
            onPress={async () => {
              setPhraseErr(null);
              try {
                setPhrase(await exportRecoveryPhrase());
              } catch (e) {
                const d = describeError(e);
                if (!d.cancelled) setPhraseErr(d.detail || d.title);
              }
            }}
            right={<Icon name="chev" size={18} color={c.mu} />}
            testID="settings.exportPhrase"
          />
        </Card>
        {phraseErr ? <Note tone="neg" icon="warn">{phraseErr}</Note> : null}

        <Lbl style={{ marginTop: 8 }}>Appearance</Lbl>
        <Card style={{ padding: 12 }}>
          <Seg<ThemePref>
            testIDPrefix="settings.theme"
            value={pref}
            onChange={setPref}
            options={[
              { key: "system", label: "System", icon: "phone" },
              { key: "light", label: "Light", icon: "sun" },
              { key: "dark", label: "Dark", icon: "moon" },
            ]}
          />
        </Card>

        <Lbl style={{ marginTop: 8 }}>Network</Lbl>
        <NetworkRows />
        <Lbl style={{ marginTop: 8 }}>Alerts</Lbl>
        <Card list>
          <SetRow
            icon="bell"
            title="Notifications"
            sub={alerts.on ? (alerts.permission === "denied" ? "On in Mirror · blocked in system settings" : "On · copies, blocked trades, stops") : "Off · asked only when you turn alerts on"}
            right={<Switch on={alerts.on} onChange={(v) => (v ? alerts.turnOn() : alerts.turnOff())} testID="settings.alerts.toggle" />}
          />
          <SetRow icon="lock" title="Alerts received" sub="Decrypted on this device only" onPress={() => router.push("/alerts")} right={<Icon name="chev" size={18} color={c.mu} />} testID="settings.alerts.list" />
          <SetRow icon="clock" title="Notification history" sub="Copies, blocked trades and account events" onPress={() => router.push("/notifications")} right={<Icon name="chev" size={18} color={c.mu} />} testID="settings.notifications" />
        </Card>
        <View testID="settings.alerts.privacy" style={{ gap: 4, paddingHorizontal: 4 }}>
          <T size={12} color="mu">
            {`Alerts are end-to-end encrypted to your notification key (passkey PRF namespace "${NS_NOTIFY_LABEL}"). Mirror's server only holds its public half and relays ciphertext; the push service sees only "Mirror: new activity".`}
          </T>
          <T size={12} color="mu" testID="settings.alerts.channel">
            {Platform.OS === "web"
              ? `${registered}. The browser shows "Mirror: new activity" because its service worker can't read the key; the details are decrypted when you open Mirror.`
              : `${registered}. Android shows "Mirror: new activity"; the details are decrypted on this phone.`}
          </T>
        </View>

        <Lbl style={{ marginTop: 8 }}>About</Lbl>
        <Card list>
          {(totals?.accounts ?? []).map((a) => (
            <SetRow key={a.account} icon="wallet" title={`Follow account · ${shortAddr(a.leader?.address)}`} sub={<T size={12} mono color="mu">{shortAddr(a.account)}</T>} right={ext} onPress={() => Linking.openURL(addressUrl(cfg, a.account))} />
          ))}
          {cfg?.contracts.factory ? <SetRow icon="doc" title="Account factory" sub={<T size={12} mono color="mu">{shortAddr(cfg.contracts.factory)}</T>} right={ext} onPress={() => Linking.openURL(addressUrl(cfg, cfg.contracts.factory!))} /> : null}
          <SetRow icon="doc" title="Fees" sub={`Mirror fee ${FEE_PCT} of opening size (Perpl builder ${BUILDER_ID}) · none on closes · gas sponsored`} right={ext} onPress={() => Linking.openURL(FEES_DOC_URL)} testID="settings.fees" />
          <SetRow icon="warn" title="Unaudited beta" sub="Deposits capped at 25 AUSD per follow account" />
          <SetRow icon="info" title={`Mirror ${VERSION_LABEL}`} sub="Balance in AUSD by Agora · Passkeys by Mera · Labels by Nansen" testID="settings.version" />
        </Card>

        {DEV_TOOLS ? (
        <>
        <Lbl style={{ marginTop: 8 }}>Developer</Lbl>
        <Card style={{ padding: 14, gap: 8 }}>
          <T size={12} color="mu">
            API base (default {DEFAULT_API_BASE})
          </T>
          <TextInput
            testID="settings.apiBase.input"
            value={api}
            onChangeText={setApi}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ fontFamily: fonts.mono, fontSize: 12, color: c.tx, padding: 10, borderRadius: 10, backgroundColor: c.sf2 }}
          />
          <Row gap={8}>
            <Button
              title="Save"
              size="sm"
              kind="ton"
              testID="settings.apiBase.save"
              onPress={async () => {
                await setApiBaseOverride(api.trim() === DEFAULT_API_BASE ? null : api.trim());
                qc.clear();
              }}
            />
            <Button
              title="Reset"
              size="sm"
              kind="out"
              onPress={async () => {
                await setApiBaseOverride(null);
                setApi(DEFAULT_API_BASE);
                qc.clear();
              }}
            />
          </Row>
        </Card>
        </>
        ) : null}
      </Scroll>

      <Dialog visible={!!phrase} onClose={() => setPhrase(null)} testID="settings.phrase">
        <T size={19} w={600}>
          Recovery phrase
        </T>
        <Note tone="warn" icon="warn">
          Write it down offline. Never type it into a website. Your passkey alone already restores this account.
        </Note>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {(phrase ?? []).map((w, i) => (
            <View key={i} style={{ width: "31%", flexDirection: "row", gap: 4, padding: 6, borderRadius: 8, backgroundColor: c.sf2 }}>
              <T size={11} mono color="mu">
                {i + 1}
              </T>
              <T size={12} mono>
                {w}
              </T>
            </View>
          ))}
        </View>
        <Button title="Hide" onPress={() => setPhrase(null)} testID="settings.phrase.hide" />
      </Dialog>
      <Dialog visible={confirmSignOut} onClose={() => setConfirmSignOut(false)}>
        <T size={19} w={600}>
          Sign out this phone?
        </T>
        <T size={13} color="mu">
          Your follows keep running onchain. Sign back in any time with your passkey.
        </T>
        <Row gap={8} justify="flex-end">
          <Button title="Cancel" kind="txt" size="md" onPress={() => setConfirmSignOut(false)} />
          <Button
            title="Sign out"
            kind="dng"
            size="md"
            testID="settings.signOut.confirm"
            onPress={async () => {
              setConfirmSignOut(false);
              await signOut();
              qc.clear();
              router.replace("/welcome");
            }}
          />
        </Row>
      </Dialog>
    </Screen>
  );
}
