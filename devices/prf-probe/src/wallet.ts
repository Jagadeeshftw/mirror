import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
} from "@category-labs/mera";
import { reactNativeWebAuthnClient } from "@category-labs/mera/react-native-webauthn-client";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import Constants from "expo-constants";
import { recoverTypedDataAddress } from "viem";

export const rpId: string = Constants.expoConfig?.extra?.rpId;

/** PRF output (32 bytes) -> BIP-39 mnemonic -> seed -> m/44'/60'/0'/0/0. */
export function walletFromPrf(prfOutput: Uint8Array) {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!node.privateKey) throw new Error("derivation produced no key");
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  seed.fill(0);
  return {
    session,
    address: getEvmAddress(session.publicKey),
    account: toViemAccount(session),
  };
}

export async function createAccount() {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId, name: "meraprobe" },
    user: { name: "probe", displayName: `Probe ${new Date().toISOString()}` },
    webAuthnClient: reactNativeWebAuthnClient,
  });
  return { credentialId: created.credentialId, ...walletFromPrf(created.prfOutput) };
}

/** Restore on any device: discoverable get, no stored credential ID. */
export async function restoreAccount() {
  const got = await getPasskeyPrfOutput({
    rpId,
    webAuthnClient: reactNativeWebAuthnClient,
  });
  return { credentialId: got.credentialId, ...walletFromPrf(got.prfOutput) };
}

export const typedData = {
  domain: { name: "meraprobe", version: "1", chainId: 10143 },
  types: {
    Mail: [
      { name: "from", type: "address" },
      { name: "contents", type: "string" },
    ],
  },
  primaryType: "Mail",
  message: {
    from: "0x0000000000000000000000000000000000000001",
    contents: "hello monad",
  },
} as const;

export async function signAndVerify(account: ReturnType<typeof walletFromPrf>["account"]) {
  const signature = await account.signTypedData(typedData);
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });
  const msgSig = await account.signMessage({ message: "hello monad" });
  return { signature, recovered, ok: recovered === account.address, msgSig };
}

/** No-passkey self test: proves derivation + EIP-712 signing run on Hermes. */
export async function selfTest() {
  const prf = new Uint8Array(32).fill(7);
  const t0 = Date.now();
  const w = walletFromPrf(prf);
  const r = await signAndVerify(w.account);
  w.session.end();
  return { address: w.address, ...r, ms: Date.now() - t0 };
}

export function describeError(e: unknown): string {
  if (isMeraError(e)) {
    const c = (e.cause ?? {}) as { error?: string; message?: string };
    return `MeraError ${e.code}: ${e.message}${c.error ? ` | cause.error=${c.error}` : ""}${c.message ? ` | cause.message=${c.message}` : ""}`;
  }
  return e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e);
}
