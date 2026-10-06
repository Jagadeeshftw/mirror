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
import { createWithTwoNamespaces, deriveEncryptKey, NS_ENCRYPT } from "./src/namespaces";
import { bytesToHex } from "@noble/hashes/utils.js";

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

  const twoNs = async () => {
    add("CREATE2NS...");
    try {
      const r = await createWithTwoNamespaces();
      const w = { credentialId: r.created.credentialId, ...walletFromPrf(r.created.prfOutput) };
      wallet?.session.end();
      setWallet(w);
      add(`CREATE2NS OK address=${w.address} x25519=${r.encrypt ? r.encrypt.publicKeyHex : "second-not-returned"}`);
    } catch (e) {
      add(`CREATE2NS FAIL ${describeError(e)}`);
    }
  };

  const encKey = async () => {
    add(`NSENC... salt=${bytesToHex(NS_ENCRYPT).slice(0, 16)}`);
    try {
      const r = await deriveEncryptKey(wallet?.credentialId);
      add(`NSENC OK cred=${r.credentialId.slice(0, 12)}... x25519=${r.publicKeyHex}`);
    } catch (e) {
      add(`NSENC FAIL ${describeError(e)}`);
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
      <Text style={s.h}>Mirror PRF probe</Text>
      <Text testID="address">{wallet ? wallet.address : "no account"}</Text>
      <View style={s.row}>
        <Button title="Create passkey" onPress={run("CREATE", createAccount)} />
        <Button title="Restore" onPress={run("RESTORE", restoreAccount)} />
        <Button title="Sign 712" onPress={sign} />
        <Button title="Create 2NS" onPress={twoNs} />
        <Button title="Encrypt key" onPress={encKey} />
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
