// Pure key derivation from a passkey PRF output (no platform modules, unit-tested).
import { createSecp256k1SigningSession, getEvmAddress, type Secp256k1SigningSession } from "@category-labs/mera";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { Address } from "./types";

export const DERIVATION_PATH = "m/44'/60'/0'/0/0";

/** PRF output (32 bytes) -> BIP-39 mnemonic -> seed -> m/44'/60'/0'/0/0, as in the Mera probe. */
export function sessionFromPrf(prfOutput: Uint8Array): { session: Secp256k1SigningSession; address: Address } {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(DERIVATION_PATH);
  if (!node.privateKey) throw new Error("derivation produced no key");
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  seed.fill(0);
  node.wipePrivateData();
  return { session, address: getEvmAddress(session.publicKey) as Address };
}

export function addressFromPrf(prfOutput: Uint8Array): Address {
  const { session, address } = sessionFromPrf(prfOutput);
  session.end();
  return address;
}

export function mnemonicFromPrf(prfOutput: Uint8Array): string {
  return entropyToMnemonic(prfOutput, wordlist);
}
