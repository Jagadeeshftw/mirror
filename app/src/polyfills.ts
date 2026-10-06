import { getRandomValues } from "expo-crypto";

// Hermes has no CSPRNG; Mera and @noble need crypto.getRandomValues.
if (typeof globalThis.crypto?.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { ...globalThis.crypto, getRandomValues },
  });
}
