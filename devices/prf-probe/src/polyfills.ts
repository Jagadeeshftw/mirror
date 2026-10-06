import { getRandomValues } from "expo-crypto";

// Hermes has no CSPRNG; mera needs crypto.getRandomValues. Import first.
if (typeof globalThis.crypto?.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { ...globalThis.crypto, getRandomValues },
  });
}
