// EIP-712 encoding must match MirrorAccount exactly. Reference values were produced by
// (1) deploying the compiled MirrorAccountFactory + clone on a local, non-forked anvil
//     (chainId 143) and calling MirrorAccount.actionDigest / Factory.predictAccount, and
// (2) `cast abi-encode` / `cast keccak` / `cast wallet sign --data` (Foundry 1.5.0).
// See app/scripts/eip712-reference.sh for the exact commands.
import { createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { hashTypedData, keccak256, recoverTypedDataAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ACTION,
  ACTION_TYPES,
  MATCH_NOW_REF,
  actionDigest,
  actionTypedData,
  encodeCloseAll,
  encodeFollow,
  encodePaused,
  encodeWithdraw,
  followSalt,
  permitTypedData,
  predictAccount,
  receiveAuthTypedData,
  splitSignature,
  transferAuthTypedData,
} from "../src/lib/contracts";
import type { MirrorOrderJson, Policy } from "../src/lib/types";

const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a" as const;

const POLICY: Policy = {
  maxLeverageHdths: 500,
  maxSlippageBps: 50,
  dailyLossBps: 1000,
  drawdownBps: 1500,
  expiry: 1798761600,
  leaders: [{ accountId: 1043, ratioBps: 25 }],
  markets: [
    { perpId: 1, maxNotionalCNS: "12000000" },
    { perpId: 20, maxNotionalCNS: "12000000" },
  ],
};
const ORDERS: MirrorOrderJson[] = [
  {
    leaderAccountId: 1043,
    perpId: 1,
    orderType: 0,
    lotLNS: "15",
    pricePNS: "1196000",
    leverageHdths: 500,
    maxMatches: 100,
    leaderRef: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
];
// cast abi-encode "f((uint16,uint16,uint16,uint16,uint40,(uint32,uint32)[],(uint32,uint64)[]),(uint32,uint32,uint8,uint64,uint64,uint16,uint16,bytes32)[])"
const FOLLOW_DATA =
  "0x0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000022000000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000005dc000000000000000000000000000000000000000000000000000000006b36ec8000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000004130000000000000000000000000000000000000000000000000000000000000019000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000b71b0000000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000b71b000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000041300000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f0000000000000000000000000000000000000000000000000000000000123fe000000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000000000";

describe("ACTION_FOLLOW data = abi.encode(Policy, MirrorOrder[])", () => {
  it("matches cast abi-encode byte for byte", () => {
    expect(encodeFollow(POLICY, ORDERS)).toBe(FOLLOW_DATA);
  });
  it("encodes the simple action payloads like abi.encode", () => {
    expect(encodePaused(true)).toBe("0x0000000000000000000000000000000000000000000000000000000000000001");
    expect(encodeCloseAll(100)).toBe("0x0000000000000000000000000000000000000000000000000000000000000064");
    expect(encodeWithdraw(5_000_000n)).toBe("0x00000000000000000000000000000000000000000000000000000000004c4b40");
  });
  it("MATCH_NOW_REF = keccak256('MIRROR_MATCH_NOW')", () => {
    expect(MATCH_NOW_REF).toBe("0xba0016f6adaf21b42d77802a90dc5029b55fb1e05349c9553b7e1c7ed60e7d12");
  });
});

describe("Action EIP-712 digest", () => {
  it("uses the contract's ACTION_TYPEHASH", () => {
    expect(keccak256(toHex("Action(uint8 kind,bytes data,uint256 nonce,uint256 deadline)"))).toBe(
      "0x885f645c29faf27afaf15c5033143f91c13c44ded4b7399c9b0f5d79c6378f1c",
    );
    expect(ACTION_TYPES.Action.map((f) => `${f.type} ${f.name}`).join(",")).toBe("uint8 kind,bytes data,uint256 nonce,uint256 deadline");
  });

  it("equals MirrorAccount.actionDigest() from the deployed contract (local anvil, chainId 143)", () => {
    const account = "0x08C32B99837a9daC73Aa5F3b4a26dCFD366d3519";
    const d = actionDigest(account, 143, { kind: ACTION.FOLLOW, data: FOLLOW_DATA, nonce: 3n, deadline: 1798000000n });
    expect(d).toBe("0xe06a0c10e49b01f7beb09ef00bea48883e5cf4e4ab868cee197a363969e8381d");
  });

  it("equals the manual keccak(0x1901 || domainSeparator || structHash) computed with cast", () => {
    const account = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const d = actionDigest(account, 143, { kind: 7, data: FOLLOW_DATA, nonce: 3n, deadline: 1798000000n });
    expect(d).toBe("0xd6caf7b282399248808d7b90e11c0edbca9817873c332c8861afb5b9184a8df0");
  });

  it("signature equals `cast wallet sign --data` and recovers to the owner", async () => {
    const account = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const td = actionTypedData(account, 143, { kind: 7, data: FOLLOW_DATA, nonce: 3n, deadline: 1798000000n });
    const sig = await privateKeyToAccount(PK).signTypedData(td);
    expect(sig).toBe(
      "0x3e2ee5ce6cfb975e2c7f4ad0d1d2b3f053136e297848b5d5c64543b5a481f3381986d76a7745ed787e72a5d4e5b63db754f47c9cfb9998175630876db41a1a7c1b",
    );
    expect(await recoverTypedDataAddress({ ...td, signature: sig })).toBe(OWNER);
  });

  it("a Mera signing session (the app's signer) produces the same signature", async () => {
    const pk = Uint8Array.from(Buffer.from(PK.slice(2), "hex"));
    const session = createSecp256k1SigningSession({ privateKey: pk });
    try {
      expect(getEvmAddress(session.publicKey)).toBe(OWNER);
      const account = toViemAccount(session);
      const td = actionTypedData("0x5FbDB2315678afecb367f032d93F642f64180aa3", 143, {
        kind: 7,
        data: FOLLOW_DATA,
        nonce: 3n,
        deadline: 1798000000n,
      });
      const sig = await account.signTypedData(td);
      expect(sig).toBe(
        "0x3e2ee5ce6cfb975e2c7f4ad0d1d2b3f053136e297848b5d5c64543b5a481f3381986d76a7745ed787e72a5d4e5b63db754f47c9cfb9998175630876db41a1a7c1b",
      );
    } finally {
      session.end();
    }
  });
});

describe("AUSD permit (EIP-2612) and ERC-3009", () => {
  const spender = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
  const signer = privateKeyToAccount(PK);
  it("domain separator equals MockAUSD.DOMAIN_SEPARATOR() ('Agora Dollar', '1', chainId 143)", () => {
    const td = permitTypedData(spender, 143, { owner: OWNER, spender, value: 1n, nonce: 0n, deadline: 1n });
    // hashDomain via viem: digest of an empty-struct trick is not exposed, so recompute via hashTypedData parts.
    const { domain } = td;
    expect(domain).toEqual({ name: "Agora Dollar", version: "1", chainId: 143, verifyingContract: spender });
    const ds = keccak256(
      ("0x" +
        [
          keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")).slice(2),
          keccak256(toHex("Agora Dollar")).slice(2),
          keccak256(toHex("1")).slice(2),
          (143).toString(16).padStart(64, "0"),
          spender.slice(2).toLowerCase().padStart(64, "0"),
        ].join("")) as `0x${string}`,
    );
    expect(ds).toBe("0x9e18c0656755e03a9e4b45bc169143361895fa665b5c7241aa1c4b8d6ac282ea");
  });
  it("permit signature equals cast", async () => {
    const sig = await signer.signTypedData(permitTypedData(AUSD, 143, { owner: OWNER, spender, value: 12_000_000n, nonce: 0n, deadline: 1798000000n }));
    expect(sig).toBe(
      "0xd9b95f29c0d2a5e192de41b4427ac4cee24226d300ab45d985b1c335077c9d47163de758d54d8d00e302d1290eaf153b6b7ff8e3237ae3356d1daa4b8c18a07f1b",
    );
    const { v, r, s } = splitSignature(sig);
    expect(v).toBe(27);
    expect(r).toBe("0xd9b95f29c0d2a5e192de41b4427ac4cee24226d300ab45d985b1c335077c9d47");
    expect(s).toBe("0x163de758d54d8d00e302d1290eaf153b6b7ff8e3237ae3356d1daa4b8c18a07f");
  });
  const m = {
    from: OWNER,
    to: spender,
    value: 12_000_000n,
    validAfter: 0n,
    validBefore: 1798000000n,
    nonce: "0x1111111111111111111111111111111111111111111111111111111111111111" as const,
  };
  it("receiveWithAuthorization signature equals cast", async () => {
    expect(await signer.signTypedData(receiveAuthTypedData(AUSD, 143, m))).toBe(
      "0x0f25be102bf6c0e618e82e435f5d36974affeacb7b0d8028daa1a4714b33a3593ede1181b84ea852c61928a0a62e4d30dd22b0935099907c6855e5e5ce708a5c1b",
    );
  });
  it("transferWithAuthorization signature equals cast", async () => {
    const sig = await signer.signTypedData(transferAuthTypedData(AUSD, 143, m));
    expect(sig).toBe(
      "0xe5f87cfa8c759bdce4344f9e8ca4e28480ba91f0fd275e4f9b849d40856229242227a768321558392e773c71beff9cc1cd498651c6f5a08da5f11f589f489c9a1c",
    );
    expect(splitSignature(sig).v).toBe(28);
  });
  it("digest is stable through viem hashTypedData", () => {
    expect(hashTypedData(transferAuthTypedData(AUSD, 143, m))).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("account prediction (EIP-1167 clone, CREATE2)", () => {
  it("equals MirrorAccountFactory.predictAccount() from the deployed factory", () => {
    const a = predictAccount(
      "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
      "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81",
      OWNER,
      followSalt(2),
    );
    expect(a).toBe("0x08C32B99837a9daC73Aa5F3b4a26dCFD366d3519");
  });
  it("equals cast create2", () => {
    const a = predictAccount(
      "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
      OWNER,
      followSalt(2),
    );
    expect(a).toBe("0xF74de71a0c28C51F03EC65377A8174FFa37a2e0d");
  });
});
