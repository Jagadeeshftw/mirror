import { NS_NOTIFY, decodeOutput, withSecondSalt } from "../src/lib/prfNamespaces.web";

const out = (n: number) => new Uint8Array(32).fill(n);

describe("withSecondSalt (web)", () => {
  it("adds eval.second to the same navigator.credentials call and returns both outputs", async () => {
    const seen: any[] = [];
    const creds: any = {
      get: async (opts: any) => {
        seen.push(opts.publicKey.extensions.prf.eval);
        return { getClientExtensionResults: () => ({ prf: { results: { first: out(1).buffer, second: out(2).buffer } } }) };
      },
      create: async () => null,
    };
    const original = creds.get;
    const { result, second } = await withSecondSalt(NS_NOTIFY, () => creds.get({ publicKey: { extensions: { prf: { eval: { first: out(9) } } } } }), creds);
    expect(seen).toHaveLength(1);
    expect(new Uint8Array(seen[0].second)).toEqual(NS_NOTIFY);
    expect(new Uint8Array(result.getClientExtensionResults().prf.results.first)).toEqual(out(1));
    expect(second).toEqual(out(2));
    expect(creds.get).toBe(original);
  });

  it("returns no second output when the browser ignores it", async () => {
    const creds: any = { create: async () => ({ getClientExtensionResults: () => ({ prf: { enabled: true } }) }), get: async () => null };
    const { second } = await withSecondSalt(NS_NOTIFY, () => creds.create({ publicKey: { extensions: { prf: { eval: { first: out(9) } } } } }), creds);
    expect(second).toBeUndefined();
  });

  it("restores prototype methods by removing the shadowing property", async () => {
    class Container {
      create() {
        return Promise.resolve(null);
      }
      get() {
        return Promise.resolve(null);
      }
    }
    const creds: any = new Container();
    await withSecondSalt(NS_NOTIFY, async () => creds.get({}), creds);
    expect(Object.prototype.hasOwnProperty.call(creds, "get")).toBe(false);
  });

  it("decodes ArrayBuffer and typed-array outputs", () => {
    expect(decodeOutput(out(3).buffer)).toEqual(out(3));
    expect(decodeOutput(out(4))).toEqual(out(4));
    expect(decodeOutput(new Uint8Array(16))).toBeUndefined();
  });
});
