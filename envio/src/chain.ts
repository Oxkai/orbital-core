/**
 * Chain access for the handlers.
 *
 * Every handler reads live engine state at its own block, because `TickCrossed`
 * only fires once a boundary has ALREADY been hit and is therefore useless as
 * an early warning. That is ~41 reads per log, so they go through multicall3
 * (deployed at the canonical address on Monad) and land as one request.
 */

import { createPublicClient, defineChain, http } from "viem";

export const WAD = 10n ** 18n;
export const BPS = 10_000n;

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://testnet.monadscan.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const client = createPublicClient({
  chain: monadTestnet,
  transport: http(process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz"),
});

/** Only the reads the handlers make, rather than the hook's whole ABI. */
export const hookAbi = [
  { type: "function", name: "N", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "fee", inputs: [], outputs: [{ type: "uint24" }], stateMutability: "view" },
  { type: "function", name: "assetAt", inputs: [{ type: "uint8" }], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "scaleOf", inputs: [{ type: "uint8" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "virtualReserve", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "reserves", inputs: [{ type: "uint8" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "feesAccrued", inputs: [{ type: "uint8" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "numTicks", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "slot0",
    inputs: [],
    outputs: [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ticks",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bool" }],
    stateMutability: "view",
  },
] as const;

export const erc20Abi = [
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

/**
 * Integer square root, Newton's method. Mirrors SphereMath.sqrt in the hook.
 *
 * Needed because `sqrtN` is `internal immutable` in OrbitalHook and therefore
 * not callable, yet every boundary comparison the engine makes is normalised
 * by it. Recomputing it here is the only way to reproduce the engine's own
 * crossing condition rather than approximate it.
 */
export function bigSqrt(n: bigint): bigint {
  if (n <= 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Clamp to the int32 range the schema's `Int!` fields hold. */
export function toInt(v: bigint): number {
  if (v > 2147483647n) return 2147483647;
  if (v < -2147483648n) return -2147483648;
  return Number(v);
}
