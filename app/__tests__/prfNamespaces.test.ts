import { decodeOutput, NS_NOTIFY, toBase64Url, withSecondSalt } from "../src/lib/prfNamespaces";

jest.mock("react-native-passkey", () => ({ Passkey: {} }));

const out = (n: number) => new Uint8Array(32).fill(n);

describe("withSecondSalt", () => {
  it("adds the notification salt as eval.second, in the same encoding as eval.first, and returns its output", async () => {
    const seen: any[] = [];
    const passkey: any = {
      getPlatformKey: async (req: any) => {
        seen.push(JSON.parse(JSON.stringify({ first: Array.from(req.extensions.prf.eval.first), second: Array.from(req.extensions.prf.eval.second) })));
        return { clientExtensionResults: { prf: { results: { first: toBase64Url(out(1)), second: toBase64Url(out(2)) } } } };
      },
    };
    const original = passkey.getPlatformKey;
    const { result, second } = await withSecondSalt(NS_NOTIFY, async () => passkey.getPlatformKey({ extensions: { prf: { eval: { first: out(9) } } } }), passkey);
    expect(seen[0].second).toEqual(Array.from(NS_NOTIFY));
    expect(second).toEqual(out(2));
    expect(result.clientExtensionResults.prf.results.first).toBe(toBase64Url(out(1)));
    expect(passkey.getPlatformKey).toBe(original); // restored afterwards
  });

  it("uses base64url for eval.second when eval.first is a string", async () => {
    let sent: unknown;
    const passkey: any = {
      createPlatformKey: async (req: any) => {
        sent = req.extensions.prf.eval.second;
        return { clientExtensionResults: { prf: { results: { first: "x" } } } };
      },
    };
    await withSecondSalt(NS_NOTIFY, () => passkey.createPlatformKey({ extensions: { prf: { eval: { first: "abc" } } } }), passkey);
    expect(sent).toBe(toBase64Url(NS_NOTIFY));
  });

  it("returns undefined when the provider ignores eval.second, so the caller can fall back", async () => {
    const passkey: any = { getPlatformKey: async () => ({ clientExtensionResults: { prf: { results: { first: toBase64Url(out(1)) } } } }) };
    const { second } = await withSecondSalt(NS_NOTIFY, () => passkey.getPlatformKey({ extensions: { prf: { eval: { first: out(9) } } } }), passkey);
    expect(second).toBeUndefined();
  });

  it("restores the native functions even when the ceremony throws", async () => {
    const passkey: any = { getPlatformKey: async () => { throw new Error("UserCancelled"); } };
    const original = passkey.getPlatformKey;
    await expect(withSecondSalt(NS_NOTIFY, () => passkey.getPlatformKey({ extensions: { prf: { eval: { first: out(9) } } } }), passkey)).rejects.toThrow("UserCancelled");
    expect(passkey.getPlatformKey).toBe(original);
  });
});

describe("decodeOutput", () => {
  it("accepts 32-byte base64url strings and byte arrays, rejects other lengths", () => {
    expect(decodeOutput(toBase64Url(out(7)))).toEqual(out(7));
    expect(decodeOutput(Array.from(out(3)))).toEqual(out(3));
    expect(decodeOutput(toBase64Url(new Uint8Array(16)))).toBeUndefined();
    expect(decodeOutput(undefined)).toBeUndefined();
  });
});
