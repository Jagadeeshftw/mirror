import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Share, View } from "react-native";
import { deposit, type StepState } from "../lib/actions";
import { ApiError } from "../lib/api";
import { ausd, groupedAddress, parseUnits, shortAddr, toBig } from "../lib/format";
import { followLimits } from "../lib/policy";
import type { RelayResult } from "../lib/types";
import { describeError } from "../lib/wallet";
import { useConfig, useTotals } from "../state/data";
import { useSession } from "../state/session";
import { AppBar } from "../ui/chrome";
import { QR } from "../ui/charts";
import { openTx } from "../ui/feed";
import { Icon } from "../ui/icons";
import { BrandMark, Button, Card, Chip, ChipS, Coin, CommitTrack, Field, Hint, Identicon, KV, Meter, NumInput, Note, Row, Screen, Scroll, Steps2, T, TxLink } from "../ui/kit";
import { useColors } from "../ui/theme";

export default function AddFunds() {
  const c = useColors();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ account?: string; step?: string }>();
  const { account: me } = useSession();
  const cfg = useConfig().data;
  const BETA_CAP_CNS = followLimits(cfg).capCNS;
  const { totals } = useTotals();
  const [step, setStep] = useState<0 | 1>(params.step === "1" ? 1 : 0);
  const [copied, setCopied] = useState(false);
  const accounts = totals?.accounts ?? [];
  const [target, setTarget] = useState<string | undefined>(params.account ?? accounts.find((a) => toBig(a.netDepositsCNS) < BETA_CAP_CNS)?.account);
  const acct = accounts.find((a) => a.account === target) ?? accounts[0];
  const room = acct ? BETA_CAP_CNS - toBig(acct.netDepositsCNS) : 0n;
  const wallet = totals?.wallet ?? 0n;
  const maxDep = wallet < room ? wallet : room;
  const [amount, setAmount] = useState<string>("");
  const amt = parseUnits(amount || ausd(maxDep), 6) ?? 0n;
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [result, setResult] = useState<RelayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;

  const doDeposit = async () => {
    if (!cfg || !acct) return;
    setStatus("busy");
    setError(null);
    try {
      const r = await deposit(cfg, me.address, acct.account, amt, (_k: string, _s: StepState) => {});
      setResult(r);
      setStatus("done");
      qc.invalidateQueries({ queryKey: ["owner"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else {
        const d = describeError(e);
        if (d.cancelled) return setStatus("idle");
        setError(d.detail || d.title);
      }
      setStatus("error");
    }
  };

  return (
    <Screen>
      <AppBar title="Add funds" showBack noAv />
      <Scroll contentStyle={{ paddingHorizontal: 20, paddingTop: 4, gap: 16, flexGrow: 1 }} testID="funds.scroll">
        <Row gap={8}>
          <View style={{ flex: 1 }}>
            <Chip label="1  Receive AUSD" on={step === 0} onPress={() => setStep(0)} testID="funds.step.receive" />
          </View>
          <View style={{ flex: 1 }}>
            <Chip label="2  Deposit to Mirror" on={step === 1} onPress={() => setStep(1)} testID="funds.step.deposit" />
          </View>
        </Row>
        {step === 0 ? (
          <>
            <Card style={{ padding: 20, alignItems: "center", gap: 12 }} testID="funds.receive">
              <QR value={me.address} testID="funds.qr" />
              <Row gap={6}>
                <ChipS label="AUSD" />
                <ChipS label="Monad" icon="globe" />
              </Row>
              <T size={12} w={500} color="mu" upper>
                Your wallet address
              </T>
              <T testID="funds.address" size={14} mono center lh={22} selectable style={{ maxWidth: 260 }}>
                {groupedAddress(me.address)}
              </T>
              <Row gap={10} style={{ alignSelf: "stretch" }}>
                <Button
                  title={copied ? "Copied" : "Copy address"}
                  icon={copied ? "check" : "copy"}
                  kind="ton"
                  size="md"
                  flex
                  testID="funds.copy"
                  onPress={async () => {
                    await Clipboard.setStringAsync(me.address);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                />
                <Button title="Share" icon="share" kind="out" size="md" flex testID="funds.share" onPress={() => Share.share({ message: me.address })} />
              </Row>
            </Card>
            <Note tone="warn" icon="warn">
              Send only AUSD on Monad. Tokens sent on other networks won't arrive.
            </Note>
            <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
              <Row gap={12}>
                <Coin />
                <View style={{ flex: 1 }}>
                  <T size={14} w={600} mono testID="funds.wallet.balance">
                    {ausd(wallet)} AUSD in your wallet
                  </T>
                  <T size={12} color="mu">
                    Updates within a second of arriving
                  </T>
                </View>
                <Button title="Deposit" size="sm" onPress={() => setStep(1)} disabled={wallet === 0n} testID="funds.toDeposit" />
              </Row>
            </Card>
          </>
        ) : accounts.length === 0 ? (
          <>
            <Card style={{ padding: 20, gap: 10, alignItems: "center" }}>
              <T size={17} w={600} center>
                Deposits happen when you follow
              </T>
              <T size={13} color="mu" center>
                Each follow gets its own account. Choose a leader and set an allocation of 10 to 25 AUSD; the deposit is part of the same passkey approval.
              </T>
              <Button title="Browse leaders" onPress={() => router.push("/leaders")} style={{ alignSelf: "stretch" }} />
            </Card>
          </>
        ) : status === "done" && result ? (
          <>
            <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: c.posS, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 24 }}>
              <Icon name="check" size={28} color={c.posI} />
            </View>
            <T size={26} w={700} center testID="funds.status">
              Deposited
            </T>
            <Card>
              <View style={{ paddingHorizontal: 14 }}>
                <KV k="Amount" v={`${ausd(amt)} AUSD`} />
                <KV k="Status" v={<CommitTrack state={result.commitState ?? "finalized"} />} />
                <KV k="Network fee" v="0.00 MON · sponsored" />
                <KV k="Transaction" v={<TxLink hash={result.txHash} onPress={() => openTx(cfg, result.txHash)} />} last />
              </View>
            </Card>
            <View style={{ flex: 1 }} />
            <Button title="Done" onPress={() => router.back()} testID="funds.done" />
          </>
        ) : (
          <>
            {accounts.length > 1 ? (
              <View style={{ gap: 8 }}>
                <T size={12} w={500} color="mu" upper>
                  Into
                </T>
                <Row gap={8} style={{ flexWrap: "wrap" }}>
                  {accounts.map((a) => (
                    <Chip key={a.account} label={shortAddr(a.leader?.address ?? a.account)} mono on={a.account === acct?.account} onPress={() => setTarget(a.account)} testID={`funds.account.${a.account}`} />
                  ))}
                </Row>
              </View>
            ) : null}
            <View style={{ gap: 6, alignItems: "center", paddingTop: 6 }}>
              <T size={12} w={500} color="mu" upper>
                Amount
              </T>
              <Field style={{ borderWidth: 0, backgroundColor: "transparent" }}>
                <NumInput testID="funds.amount.input" value={amount || ausd(maxDep)} onChangeText={setAmount} size={52} />
                <T size={16} w={500} color="mu">
                  AUSD
                </T>
              </Field>
              <Row gap={6}>
                <Chip label={`Max · wallet ${ausd(wallet)}`} on={amt === maxDep} onPress={() => setAmount(ausd(maxDep))} />
                <Chip label={`Cap room ${ausd(room)}`} onPress={() => setAmount(ausd(room))} />
              </Row>
            </View>
            <Card style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
              <Row gap={12} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.bd }}>
                <Icon name="wallet" size={20} color={c.mu} />
                <View style={{ flex: 1 }}>
                  <T size={13}>From your wallet</T>
                  <T size={12} mono color="mu">
                    {shortAddr(me.address)}
                  </T>
                </View>
                <T size={13} mono>
                  {ausd(wallet)} → {ausd(wallet - amt > 0n ? wallet - amt : 0n)}
                </T>
              </Row>
              <Row gap={12} style={{ paddingVertical: 12 }}>
                <BrandMark size={20} />
                <View style={{ flex: 1 }}>
                  <T size={13}>To your follow of {shortAddr(acct?.leader?.address)}</T>
                  <T size={12} color="mu">
                    AUSD balance
                  </T>
                </View>
                <T size={13} mono>
                  {ausd(acct?.balanceCNS)} → {ausd(toBig(acct?.balanceCNS) + amt)}
                </T>
              </Row>
            </Card>
            <Card style={{ padding: 14, gap: 10 }} testID="funds.cap">
              <Row>
                <T size={13} w={600}>
                  Beta deposit limit
                </T>
                <T size={13} mono style={{ flex: 1, textAlign: "right" }}>
                  {ausd(toBig(acct?.netDepositsCNS) + amt)} / 25.00 AUSD
                </T>
              </Row>
              <Meter
                parts={[
                  { frac: Number(toBig(acct?.netDepositsCNS)) / Number(BETA_CAP_CNS), color: c.ac },
                  { frac: Number(amt) / Number(BETA_CAP_CNS), color: c.ac, opacity: 0.45 },
                ]}
              />
              <Row gap={6}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.ac }} />
                <T size={12} color="mu">
                  Deposited {ausd(acct?.netDepositsCNS)}
                </T>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.ac, opacity: 0.45, marginLeft: 6 }} />
                <T size={12} color="mu">
                  This deposit {ausd(amt)}
                </T>
              </Row>
              <T size={12} color="mu">
                The contracts are unaudited, so each follow's account can hold at most 25 AUSD during beta.
              </T>
            </Card>
            <View>
              <KV k="Signature" v="One passkey permit" vMono={false} />
              <KV k="Approval transaction" v="Not needed" vMono={false} />
              <KV k="Network fee" v={<T size={13}><T size={13} w={600} color="posI">Free</T> · sponsored</T>} last />
            </View>
            {amt > room ? <Hint warn>Over the 25 AUSD beta limit for this follow.</Hint> : amt > wallet ? <Hint warn>More than your wallet balance.</Hint> : null}
            {error ? <Note tone="neg" icon="warn">{error}</Note> : null}
            <View style={{ flex: 1 }} />
            <Button title={status === "busy" ? "Waiting for your passkey" : "Deposit with passkey"} icon="fp" onPress={doDeposit} disabled={status === "busy" || amt === 0n || amt > room || amt > wallet} testID="funds.confirm" />
          </>
        )}
      </Scroll>
    </Screen>
  );
}
