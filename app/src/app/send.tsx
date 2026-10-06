import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useState } from "react";
import { TextInput, View } from "react-native";
import { isAddress } from "viem";
import { sendAusd } from "../lib/actions";
import { ApiError } from "../lib/api";
import { ausd, parseUnits, shortAddr } from "../lib/format";
import type { Address, RelayResult } from "../lib/types";
import { describeError } from "../lib/wallet";
import { useConfig, useWallet } from "../state/data";
import { useSession } from "../state/session";
import { AppBar } from "../ui/chrome";
import { openTx } from "../ui/feed";
import { Icon } from "../ui/icons";
import { Button, Card, Chip, CommitTrack, Field, KV, NumInput, Note, Row, Screen, Scroll, T, TxLink } from "../ui/kit";
import { fonts, useColors } from "../ui/theme";

export default function Send() {
  const c = useColors();
  const qc = useQueryClient();
  const { account: me } = useSession();
  const cfg = useConfig().data;
  const wallet = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<"form" | "busy" | "done">("form");
  const [res, setRes] = useState<RelayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const amt = parseUnits(amount, 6) ?? 0n;
  const valid = isAddress(to, { strict: false }) && to.toLowerCase() !== me.address.toLowerCase() && amt > 0n && amt <= wallet.cns;

  const go = async () => {
    if (!cfg) return;
    setPhase("busy");
    setError(null);
    try {
      const r = await sendAusd(cfg, me.address, to as Address, amt, () => {});
      setRes(r);
      setPhase("done");
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["owner"] });
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else {
        const d = describeError(e);
        if (!d.cancelled) setError(d.detail || d.title);
      }
      setPhase("form");
    }
  };

  if (phase === "done" && res) {
    return (
      <Screen>
        <AppBar showBack closeIcon noBal noAv onBack={() => router.back()} />
        <Scroll contentStyle={{ paddingHorizontal: 20, gap: 18, flexGrow: 1 }}>
          <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: c.posS, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 28 }}>
            <Icon name="check" size={28} color={c.posI} />
          </View>
          <T size={26} w={700} center testID="send.status">
            Sent
          </T>
          <T size={13} color="mu" center>
            {ausd(amt)} AUSD to {shortAddr(to)}
          </T>
          <Card>
            <View style={{ paddingHorizontal: 14 }}>
              <KV k="Status" v={<CommitTrack state={res.commitState ?? "finalized"} />} />
              <KV k="Network fee" v="0.00 MON · sponsored" />
              <KV k="Transaction" v={<TxLink hash={res.txHash} onPress={() => openTx(cfg, res.txHash)} />} last />
            </View>
          </Card>
          <View style={{ flex: 1 }} />
          <Button title="Done" onPress={() => router.back()} testID="send.done" />
        </Scroll>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar title="Send AUSD" showBack noAv />
      <Scroll contentStyle={{ paddingHorizontal: 20, paddingTop: 4, gap: 14, flexGrow: 1 }} testID="send.screen">
        <T size={12} w={500} color="mu" upper>
          To
        </T>
        <Row gap={8}>
          <TextInput
            testID="send.address.input"
            value={to}
            onChangeText={setTo}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="0x address on Monad"
            placeholderTextColor={c.mu}
            style={{ flex: 1, fontFamily: fonts.mono, fontSize: 13, color: c.tx, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: to && !isAddress(to, { strict: false }) ? c.neg : c.bd, backgroundColor: c.sf }}
          />
          <Button title="Paste" kind="ton" size="md" onPress={async () => setTo((await Clipboard.getStringAsync()).trim())} testID="send.paste" />
        </Row>
        <T size={12} w={500} color="mu" upper>
          Amount
        </T>
        <Field big>
          <NumInput testID="send.amount.input" value={amount} onChangeText={setAmount} size={24} placeholder="0.00" />
          <T size={13} w={500} color="mu" style={{ flex: 1 }}>
            AUSD
          </T>
          <Chip label={`Max ${ausd(wallet.cns)}`} onPress={() => setAmount(ausd(wallet.cns))} testID="send.max" height={30} />
        </Field>
        <T size={12} color="mu">
          From your wallet {shortAddr(me.address)} · {ausd(wallet.cns)} AUSD available. Funds inside your follows stay there; withdraw first to send them.
        </T>
        <Note tone="warn" icon="warn">
          Only send to an address on Monad that can receive AUSD. Transfers can't be reversed.
        </Note>
        {error ? <Note tone="neg" icon="warn" testID="send.error">{error}</Note> : null}
        <View style={{ flex: 1 }} />
        <Button title={phase === "busy" ? "Waiting for your passkey" : "Send with passkey"} icon="fp" disabled={!valid || phase === "busy"} onPress={go} testID="send.confirm" />
      </Scroll>
    </Screen>
  );
}
