jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: {} } }));
import { bundledConfig, resolveNetwork, serviceDownLine, serviceName } from "../src/lib/network";
import { explorerBase, normalizeConfig } from "../src/lib/config";

describe("EXPO_PUBLIC_NETWORK", () => {
  it("accepts mainnet, testnet and localnet; anything else is mainnet", () => {
    expect(resolveNetwork("testnet")).toBe("testnet");
    expect(resolveNetwork(" Localnet ")).toBe("localnet");
    expect(resolveNetwork("mainnet")).toBe("mainnet");
    expect(resolveNetwork(undefined)).toBe("mainnet");
    expect(resolveNetwork("")).toBe("mainnet");
    expect(resolveNetwork("devnet")).toBe("mainnet");
  });
});

describe("bundledConfig", () => {
  it("testnet: RPC, contracts, markets 16/32/48/64, explorer and the demo follower", () => {
    const c = bundledConfig("testnet", null);
    expect(c.chainId).toBe(10143);
    expect(c.rpc).toBe("https://testnet-rpc.monad.xyz");
    expect(c.contracts.factory).toBe("0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39");
    expect(c.contracts.implementation).toBe("0x648e35cdfD4Aca744Ed33c69A0089A5621A76316");
    expect(c.contracts.keeperRegistry).toBe("0x394B12D4355bE5B54DBCaa989cf44F8966195E41");
    expect(c.contracts.deployBlock).toBe(69083005);
    expect(c.contracts.collateral).toBe("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
    expect(c.markets.map((m) => m.perpId)).toEqual([16, 32, 48, 64]);
    expect(c.explorerTx).toBe("https://testnet.monadvision.com/tx/");
    expect(c.explorerAddress).toBe("https://testnet.monadvision.com/address/");
    expect(c.teamRun.demoFollowerAccount).toBe("0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896");
    expect(c.teamRun.demoLeaderAddress).toBe("0x299E77E58DD37607e4890C761924D829F8ACe82C");
    expect(c.minAccountOpenCNS).toBe("100000000");
    expect(c.depositCapCNS).toBe("200000000");
  });
  it("deposit cap and Perpl's minimum open come from the bundled network, not the old 25 / 10 defaults", () => {
    const m = bundledConfig("mainnet", null);
    expect(m.depositCapCNS).toBe("25000000");
    expect(m.minAccountOpenCNS).toBe("10000000");
    const t = bundledConfig("testnet", null);
    expect([t.depositCapCNS, t.minAccountOpenCNS]).toEqual(["200000000", "100000000"]);
    expect(bundledConfig("localnet", JSON.stringify({ depositCapCNS: "200000000" })).depositCapCNS).toBe("200000000");
  });
  it("mainnet: chain 143, mainnet explorer and markets, no Mirror contracts yet", () => {
    const c = bundledConfig("mainnet", null);
    expect(c.chainId).toBe(143);
    expect(c.rpc).toBe("https://rpc.monad.xyz");
    expect(c.explorerTx).toBe("https://monadvision.com/tx/");
    expect(c.markets.map((m) => m.symbol)).toContain("BTC");
    expect(c.markets[0].perpId).toBe(1);
    expect(c.contracts.factory).toBeNull();
    expect(c.teamRun.demoFollowerAccount).toBeNull();
  });
  it("localnet: chain 1337 on 127.0.0.1:8546, addresses from EXPO_PUBLIC_NETWORK_CONFIG", () => {
    const bare = bundledConfig("localnet", null);
    expect(bare.chainId).toBe(1337);
    expect(bare.rpc).toBe("http://127.0.0.1:8546");
    expect(bare.contracts.factory).toBeNull();
    const o = JSON.stringify({ contracts: { factory: "0x82B769500E34362a76DF81150e12C746093D954F", implementation: "0xBE6566b6d79dF8EA95b2619478019333aA758BE8", collateral: "0x5FbDB2315678afecb367f032d93F642f64180aa3" }, teamRun: { demoFollowerAccount: "0x00000000000000000000000000000000000000d1" }, markets: [{ perpId: 1, symbol: "BTC", lotDecimals: 5, priceDecimals: 1 }] });
    const c = bundledConfig("localnet", o);
    expect(c.contracts.factory).toBe("0x82B769500E34362a76DF81150e12C746093D954F");
    expect(c.teamRun.demoFollowerAccount).toBe("0x00000000000000000000000000000000000000d1");
    expect(c.markets).toHaveLength(1);
  });
  it("a bad override is ignored", () => {
    expect(bundledConfig("testnet", "{not json").chainId).toBe(10143);
  });
  it("names the service for the network", () => {
    expect(serviceName("testnet")).toBe("Mirror's testnet service");
    expect(serviceDownLine("testnet")).toBe("Mirror's testnet service isn't live yet");
    expect(serviceDownLine("mainnet")).toBe("Mirror's service isn't reachable right now");
  });
});

describe("explorer defaults", () => {
  it("picks testnet.monadvision.com for chain 10143 when /v1/config names no explorer", () => {
    expect(explorerBase(10143)).toBe("https://testnet.monadvision.com");
    expect(explorerBase(143)).toBe("https://monadvision.com");
    expect(normalizeConfig({ chainId: 10143, rpc: "x", contracts: {} }).explorerTx).toBe("https://testnet.monadvision.com/tx/");
    expect(normalizeConfig({ chainId: 143, rpc: "x", contracts: {}, explorerTx: "https://e/tx/" }).explorerTx).toBe("https://e/tx/");
  });
});

describe("fallbacks follow the build's network", () => {
  const load = (net: string | undefined) => {
    let mods: any;
    jest.isolateModules(() => {
      if (net === undefined) delete process.env.EXPO_PUBLIC_NETWORK;
      else process.env.EXPO_PUBLIC_NETWORK = net;
      mods = { cache: require("../src/state/configCache"), chain: require("../src/lib/chain"), net: require("../src/lib/network") };
    });
    delete process.env.EXPO_PUBLIC_NETWORK;
    return mods;
  };
  it("testnet build, fresh device, Mirror down: rpcConfig, explorer links and markets are testnet", () => {
    const { cache, chain, net } = load("testnet");
    expect(net.NETWORK).toBe("testnet");
    expect(cache.cachedConfig()).toBeNull();
    const rc = cache.rpcConfig(undefined);
    expect(rc.rpc).toBe("https://testnet-rpc.monad.xyz");
    expect(rc.chainId).toBe(10143);
    expect(rc.contracts.factory).toBe("0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39");
    expect(rc.teamRun.demoFollowerAccount).toBe("0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896");
    expect(rc.markets.map((m: any) => m.perpId)).toEqual([16, 32, 48, 64]);
    expect(rc.depositCapCNS).toBe("200000000");
    expect(rc.minAccountOpenCNS).toBe("100000000");
    expect(chain.txUrl(null, "0xabc")).toBe("https://testnet.monadvision.com/tx/0xabc");
    expect(chain.addressUrl(undefined, "0xdef")).toBe("https://testnet.monadvision.com/address/0xdef");
  });
  it("default build is mainnet", () => {
    const { cache, chain, net } = load(undefined);
    expect(net.NETWORK).toBe("mainnet");
    expect(cache.rpcConfig(null).rpc).toBe("https://rpc.monad.xyz");
    expect(chain.txUrl(null, "0x1")).toBe("https://monadvision.com/tx/0x1");
  });
  it("live or cached config always wins over the bundled one", () => {
    const { cache, chain } = load("testnet");
    const live = normalizeConfig({ chainId: 1337, rpc: "http://127.0.0.1:8546", contracts: {}, explorerTx: "https://x/tx/" });
    expect(cache.rpcConfig(live).rpc).toBe("http://127.0.0.1:8546");
    expect(chain.txUrl(live, "0x2")).toBe("https://x/tx/0x2");
    cache.saveConfigCache(live);
    expect(cache.rpcConfig(undefined).chainId).toBe(1337);
  });
});
