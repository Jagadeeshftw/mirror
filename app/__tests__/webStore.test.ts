import { PREFIX, createWebStore } from "../src/lib/webStore";

function memory() {
  const m = new Map<string, string>();
  return { m, kv: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };
}

describe("web store", () => {
  const key = () => globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) as Promise<CryptoKey>;

  it("round-trips and keeps only ciphertext in storage", async () => {
    const k = await key();
    const { m, kv } = memory();
    const s = createWebStore(async () => k, kv);
    await s.setItem("mirror.account.v1", JSON.stringify({ address: "0xabc" }));
    const raw = m.get(PREFIX + "mirror.account.v1")!;
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("0xabc");
    expect(await s.getItem("mirror.account.v1")).toBe('{"address":"0xabc"}');
    await s.deleteItem("mirror.account.v1");
    expect(await s.getItem("mirror.account.v1")).toBeNull();
  });

  it("binds each value to its key name and to the device key", async () => {
    const k = await key();
    const { m, kv } = memory();
    const s = createWebStore(async () => k, kv);
    await s.setItem("a", "secret");
    m.set(PREFIX + "b", m.get(PREFIX + "a")!);
    expect(await s.getItem("b")).toBeNull();
    const other = createWebStore(key, kv);
    expect(await other.getItem("a")).toBeNull();
  });
});
