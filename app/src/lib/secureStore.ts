// Device key-value store for the account record and the decrypt-only notification key.
// Android: expo-secure-store (Keystore-backed, this device only). Web: secureStore.web.ts.
import * as SecureStore from "expo-secure-store";

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export function getItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}
export function setItem(key: string, value: string): Promise<void> {
  return SecureStore.setItemAsync(key, value, OPTS);
}
export function deleteItem(key: string): Promise<void> {
  return SecureStore.deleteItemAsync(key);
}
