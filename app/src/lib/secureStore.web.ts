// Web build of secureStore.ts: encrypted localStorage under a non-extractable IndexedDB key (webStore.ts).
import { browserKey, createWebStore } from "./webStore";

const store = createWebStore(browserKey, globalThis.localStorage);

export const getItem = (key: string) => store.getItem(key);
export const setItem = (key: string, value: string) => store.setItem(key, value);
export const deleteItem = (key: string) => store.deleteItem(key);
