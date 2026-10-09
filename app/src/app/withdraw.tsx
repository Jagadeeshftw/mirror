import { useQueryClient } from "@tanstack/react-query";
import { useRelayGate } from "../state/conn";
import { RelayNote, relayBlocked } from "../ui/serviceDown";
import { router } from "expo-router";
import React, { useState } from "react";
import { TextInput, View } from "react-native";
import { isAddress } from "viem";
import { withdrawTo } from "../lib/actions";
import { ApiError } from "../lib/api";
import { ausd, ausdExact, parseUnits, shortAddr, toBig } from "../lib/format";
import type { Address, RelayResult } from "../lib/types";
import { describeError } from "../lib/wallet";
import { useConfig, useTotals } from "../state/data";
import { useSession } from "../state/session";
import { AppBar } from "../ui/chrome";
import { openTx } from "../ui/feed";
import { Icon } from "../ui/icons";
import { BrandMark, Button, Card, Checklist, Chip, CommitTrack, KV, Note, Press, Row, Screen, Scroll, Sheet, T, TxLink } from "../ui/kit";
import { fonts, useColors } from "../ui/theme";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "x"];

export default function Withdraw() {
  const c = useColors();
  const qc = useQueryClient();
  const { account: me } = useSession();
  const gate = useRelayGate();
  const cfg = useConfig().data;
  const { totals } = useTotals();
  const accts = totals?.accounts ?? [];
  const [sel, setSel] = useState<string | undefined>();
  const acct = accts.find((a) => a.account === sel) ?? [...accts].sort((a, b) => Number(toBig(b.withdrawableCNS) - toBig(a.withdrawableCNS)))[0];
  const withdrawable = toBig(acct?.withdrawableCNS);
  const [amount, setAmount] = useState("5.00");
  const [to, setTo] = useState<string>(me?.address ?? "");
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState<"form" | "busy" | "done" | "error">("form");
  const [res, setRes] = useState<{ withdraw: RelayResult; transfer: RelayResult | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  if (!me) return null;
  const amt = parseUnits(amount, 6) ?? 0n;
  const toValid = isAddress(to, { strict: false });
  const forward = toValid && to.toLowerCase() !== me.address.toLowerCase();
  const invalid = amt === 0n || amt > withdrawable || !toValid;

  const press = (k: string) => {
    setAmount((a) => {
      if (k === "x") return a.slice(0, -1);
      if (k === "." && a.includes(".")) return a;
      const n = a === "0" && k !== "." ? k : a + k;
      return /^\d*(\.\d{0,6})?$/.test(n) ? n : a;
    });
  };

  const go = async () => {
    if (!cfg || !acct) return;
    setPhase("busy");
    setError(null);
    setStartedAt(Date.now());
    try {
      const r = await withdrawTo(cfg, me.address, acct, amt, to as Address, () => {});
      setRes(r);
      setPhase("done");
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ["owner"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else {
        const d = describeError(e);
        if (d.cancelled) return setPhase("form");
        setError(d.detail || d.title);
      }
      setPhase("error");
    }
  };

  if (phase === "done" && res) {
    const final = res.withdraw.commitState === "finalized" || !res.withdraw.commitState;
    const pending = !final && Date.now() - startedAt > 60_000;
    return (
      <Screen>
        <AppBar showBack closeIcon noBal noAv onBack={() => router.replace("/home")} />
        <Scroll contentStyle={{ paddingHorizontal: 20, gap: 18, flexGrow: 1 }}>
          <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: pending ? c.wrnS : c.posS, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 28 }}>
            <Icon name={pending ? "hourglass" : "check"} size={28} color={pending ? c.wrnI : c.posI} />
          </View>
          <T size={26} w={700} center>
            <T size={26} w={700} mono>
              {ausd(amt)}
            </T>{" "}
            AUSD sent
          </T>
          <T testID="withdraw.status" size={13} w={600} center color={pending ? "wrnI" : "posI"}>
            {pending ? "Pending" : res.transfer ? "Sent" : "Confirmed"}
          </T>
          <T size={13} color="mu" center>
            {forward ? `Withdrawn to your wallet, then sent to ${shortAddr(to)}.` : `It's in your wallet ${shortAddr(me.address)} now.`}
          </T>
          <Card>
            <View style={{ paddingHorizontal: 14 }}>
              <KV k="Status" v={<CommitTrack state={res.withdraw.commitState ?? "finalized"} />} />
              <KV k="Confirmed in" v={`${((res.withdraw.latencyMs ?? 800) / 1000).toFixed(2)} s`} />
              <KV k="Network fee" v="0.00 MON · sponsored" />
              <KV k="Withdrawal" v={<TxLink hash={res.withdraw.txHash} onPress={() => openTx(cfg, res.withdraw.txHash)} testID="withdraw.tx" />} last={!res.transfer} />
              {res.transfer ? <KV k="Transfer" v={<TxLink hash={res.transfer.txHash} onPress={() => openTx(cfg, res.transfer!.txHash)} />} last /> : null}
            </View>
          </Card>
          <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
            <Row>
              <T size={13} style={{ flex: 1 }}>
                AUSD balance
              </T>
              <T size={14} w={600} mono>
                {ausd(totals?.balance ?? 0n)} AUSD
              </T>
            </Row>
          </Card>
          <View style={{ flex: 1 }} />
          <Button title="Done" onPress={() => router.replace("/home")} testID="withdraw.done" />
        </Scroll>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar title="Withdraw" showBack noAv />
      <Scroll contentStyle={{ paddingHorizontal: 20, paddingTop: 4, gap: 14, flexGrow: 1 }} testID="withdraw.screen">
        {accts.length > 1 ? (
          <Row gap={8} style={{ flexWrap: "wrap" }}>
            {accts.map((a) => (
              <Chip key={a.account} label={`${shortAddr(a.leader?.address ?? a.account)} · ${ausd(a.withdrawableCNS)}`} mono on={a.account === acct?.account} onPress={() => setSel(a.account)} testID={`withdraw.account.${a.account}`} />
            ))}
          </Row>
        ) : null}
        <View style={{ gap: 6, alignItems: "center" }}>
          <T size={12} w={500} color="mu" upper>
            Amount
          </T>
          <Row gap={6} align="flex-end" justify="center">
            <TextInput
              testID="withdraw.amount.input"
              value={amount}
              onChangeText={(t) => /^\d*(\.\d{0,6})?$/.test(t) && setAmount(t)}
              showSoftInputOnFocus={false}
              keyboardType="decimal-pad"
              cursorColor={c.ac}
              style={{ fontFamily: fonts.monoMedium, fontSize: 52, color: c.tx, padding: 0, letterSpacing: -2, textAlign: "center", minWidth: 60 }}
            />
            <T size={16} w={500} color="mu" style={{ marginBottom: 10 }}>
              AUSD
            </T>
          </Row>
          <Row gap={6}>
            <Chip label="25%" onPress={() => setAmount(ausd(withdrawable / 4n))} testID="withdraw.pct.25" />
            <Chip label="50%" onPress={() => setAmount(ausd(withdrawable / 2n))} testID="withdraw.pct.50" />
            <Chip label={`Max ${ausd(withdrawable)}`} on={amt === withdrawable} onPress={() => setAmount(ausdExact(withdrawable))} testID="withdraw.max" />
          </Row>
        </View>
        <Card style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          <Row gap={12} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.bd }}>
            <BrandMark size={20} />
            <View style={{ flex: 1 }}>
              <T size={13}>From your follow of {shortAddr(acct?.leader?.address)}</T>
              <T size={12} mono color="mu">
                Withdrawable {ausd(withdrawable)} AUSD
              </T>
            </View>
          </Row>
          <View style={{ paddingVertical: 10, gap: 6 }}>
            <Row gap={12}>
              <Icon name="wallet" size={20} color={c.mu} />
              <T size={13} style={{ flex: 1 }}>
                {forward ? "To another address" : "To your wallet"}
              </T>
              {forward ? (
                <Press onPress={() => setTo(me.address)} testID="withdraw.toMine">
                  <T size={12} w={600} color="ac">
                    Use my wallet
                  </T>
                </Press>
              ) : (
                <T size={12} color="mu">
                  Default
                </T>
              )}
            </Row>
            <TextInput
              testID="withdraw.address.input"
              value={to}
              onChangeText={setTo}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="0x…"
              placeholderTextColor={c.mu}
              style={{ fontFamily: fonts.mono, fontSize: 12, color: toValid ? c.tx : c.neg, padding: 10, borderRadius: 10, backgroundColor: c.sf2 }}
            />
          </View>
        </Card>
        <T size={12} color="mu">
          The contract only pays out to your own wallet. {forward ? "Sending on to another address is a second, gasless transfer signed in the same passkey prompt. " : ""}Withdrawable excludes margin held by open positions ({ausd(acct?.marginCNS)}).
        </T>
        {amt > withdrawable ? <Note tone="warn" icon="warn">More than the withdrawable amount.</Note> : null}
        {error && !confirm ? <Note tone="neg" icon="warn" testID="withdraw.error">{error}</Note> : null}
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -8 }}>
          {KEYS.map((k) => (
            <Press key={k} testID={`withdraw.key.${k}`} onPress={() => press(k)} style={{ width: "33.33%", height: 54, alignItems: "center", justifyContent: "center", borderRadius: 14 }} pressedStyle={{ backgroundColor: c.sf2 }}>
              {k === "x" ? <Icon name="bksp" size={22} color={c.tx} /> : <T size={24} w={500} mono>{k}</T>}
            </Press>
          ))}
        </View>
        <Button title="Continue" onPress={() => setConfirm(true)} disabled={invalid} testID="withdraw.continue" />
      </Scroll>
      <Sheet visible={confirm} onClose={() => phase !== "busy" && setConfirm(false)} testID="withdraw.sheet">
        <View style={{ gap: 14 }}>
          <T size={12} w={500} color="mu" upper center>
            Withdraw
          </T>
          <Row gap={6} align="flex-end" justify="center">
            <T size={52} w={500} mono lh={56} style={{ letterSpacing: -2 }}>
              {ausd(amt)}
            </T>
            <T size={16} w={500} color="mu" style={{ marginBottom: 8 }}>
              AUSD
            </T>
          </Row>
          <View>
            <KV k="To" v={forward ? shortAddr(to) : `Your wallet ${shortAddr(me.address)}`} />
            <KV k="Network fee" v={<T size={13} mono><T size={13} w={600} mono color="posI">0.00 MON</T> · sponsored</T>} />
            <KV k="You receive" v={`${ausd(amt)} AUSD`} />
            <KV k="AUSD balance after" v={`${ausd((totals?.balance ?? 0n) - (forward ? amt : 0n))} AUSD`} last />
          </View>
          <Note tone="ac" icon="fp">
            {forward ? "One passkey prompt signs the withdrawal and the transfer. Mirror pays the network fees; you never need MON." : "Gasless: you sign with your passkey and Mirror pays the network fee. You never need MON."}
          </Note>
          {phase === "busy" ? <Checklist items={[{ key: "sign", title: "Waiting for your passkey", state: "now" }]} /> : null}
          {error ? <Note tone="neg" icon="warn">{error}</Note> : null}
          <RelayNote gate={gate} testID="withdraw.notLive" />
          <Button title={phase === "busy" ? "Confirming" : "Confirm with passkey"} icon="fp" onPress={go} disabled={phase === "busy" || relayBlocked(gate)} testID="withdraw.confirm" />
        </View>
      </Sheet>
    </Screen>
  );
}
