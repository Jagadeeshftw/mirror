import { useEffect, useState } from "react";
import { Button, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  createAccount,
  describeError,
  restoreAccount,
  rpId,
  selfTest,
  signAndVerify,
  walletFromPrf,
} from "./src/wallet";

type W = ReturnType<typeof walletFromPrf> & { credentialId: string };

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [wallet, setWallet] = useState<W | null>(null);
  const add = (s: string) => {
    console.log("[meraprobe]", s);
    setLog((l) => [...l, s]);
  };

  useEffect(() => {
    add(`rpId=${rpId} platform=${Platform.OS} ${Platform.Version}`);
    selfTest()
      .then((r) => add(`SELFTEST ok=${r.ok} addr=${r.address} ms=${r.ms} sig=${r.signature.slice(0, 20)}...`))
      .catch((e) => add(`SELFTEST FAIL ${describeError(e)}`));
  }, []);

  const run = (label: string, fn: () => Promise<W>) => async () => {
    add(`${label}...`);
    try {
      const w = await fn();
      wallet?.session.end();
      setWallet(w);
      add(`${label} OK address=${w.address} cred=${w.credentialId.slice(0, 12)}...`);
    } catch (e) {
      add(`${label} FAIL ${describeError(e)}`);
    }
  };

  const sign = async () => {
    if (!wallet) return add("no wallet");
    try {
      const r = await signAndVerify(wallet.account);
      add(`EIP712 ok=${r.ok} sig=${r.signature}`);
    } catch (e) {
      add(`EIP712 FAIL ${describeError(e)}`);
    }
  };

  return (
    <View style={s.root}>
      <Text style={s.h}>meraprobe</Text>
      <Text testID="address">{wallet ? wallet.address : "no account"}</Text>
      <View style={s.row}>
        <Button title="Create passkey" onPress={run("CREATE", createAccount)} />
        <Button title="Restore" onPress={run("RESTORE", restoreAccount)} />
        <Button title="Sign 712" onPress={sign} />
      </View>
      <ScrollView style={s.log}>
        {log.map((l, i) => (
          <Text key={i} style={s.line}>{l}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: 60, paddingHorizontal: 16, backgroundColor: "#fff" },
  h: { fontSize: 22, fontWeight: "600", marginBottom: 8 },
  row: { flexDirection: "row", gap: 8, marginVertical: 12, flexWrap: "wrap" },
  log: { flex: 1 },
  line: { fontFamily: "monospace", fontSize: 11, marginBottom: 6 },
});
