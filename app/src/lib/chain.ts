// Monad RPC reads (no writes, no transactions are ever sent from the app: the relayer submits).
import { createPublicClient, defineChain, http, parseAbi, type PublicClient } from "viem";
import shared from "./shared-config.json";
import { networkConfig } from "./network";
import type { Address, AppConfig } from "./types";

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
]);
const FACTORY_ABI = parseAbi(["function predictAccount(address owner, bytes32 salt) view returns (address)"]);
const ACCOUNT_ABI = parseAbi(["function actionNonce() view returns (uint256)", "function netDeposits() view returns (uint256)"]);

let client: PublicClient | null = null;
let clientRpc = "";

export function monad(rpc: string, chainId = 143) {
  const explorer = chainId === 10143 ? "https://testnet.monadvision.com" : "https://monadvision.com";
  return defineChain({
    id: chainId,
    name: "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "MonadVision", url: explorer } },
  });
}

export function publicClient(cfg: Pick<AppConfig, "rpc" | "chainId">): PublicClient {
  if (!client || clientRpc !== cfg.rpc) {
    client = createPublicClient({ chain: monad(cfg.rpc, cfg.chainId), transport: http(cfg.rpc, { timeout: 10000 }) }) as PublicClient;
    clientRpc = cfg.rpc;
  }
  return client;
}

export async function ausdBalance(cfg: AppConfig, owner: Address): Promise<bigint> {
  return publicClient(cfg).readContract({ address: cfg.contracts.collateral, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
}

export async function permitNonce(cfg: AppConfig, owner: Address): Promise<bigint> {
  return publicClient(cfg).readContract({ address: cfg.contracts.collateral, abi: ERC20_ABI, functionName: "nonces", args: [owner] });
}

export async function actionNonce(cfg: AppConfig, account: Address): Promise<bigint> {
  return publicClient(cfg).readContract({ address: account, abi: ACCOUNT_ABI, functionName: "actionNonce" });
}

/** MirrorAccountFactory.predictAccount, for deployments whose /v1/config doesn't name the implementation. */
export async function predictAccountOnchain(cfg: AppConfig, owner: Address, salt: `0x${string}`): Promise<Address | null> {
  if (!cfg.contracts.factory) return null;
  return (await publicClient(cfg).readContract({ address: cfg.contracts.factory, abi: FACTORY_ABI, functionName: "predictAccount", args: [owner, salt] })) as Address;
}

export async function blockNumber(cfg: AppConfig): Promise<{ block: bigint; ms: number }> {
  const t0 = Date.now();
  const block = await publicClient(cfg).getBlockNumber({ cacheTime: 0 });
  return { block, ms: Date.now() - t0 };
}

export const SHARED = shared;
export const MAINNET = shared.networks.mainnet;

/** Explorer links: the live config's explorer, else the one for this build's network (EXPO_PUBLIC_NETWORK). */
export function txUrl(cfg: Pick<AppConfig, "explorerTx"> | null | undefined, hash: string): string {
  return (cfg?.explorerTx || networkConfig().explorerTx) + hash;
}
export function addressUrl(cfg: Pick<AppConfig, "explorerAddress"> | null | undefined, a: string): string {
  return (cfg?.explorerAddress || networkConfig().explorerAddress) + a;
}
