import { type Address } from "viem";

// ─── Deployed addresses (Monad testnet, chainId 10143) ────────────────────────
// Monad testnet has no canonical Uniswap v4 deployment, so Deploy.s.sol brings
// its own PoolManager (via hookmate) alongside the hook and the four mock
// stablecoins. DeployPeriphery.s.sol then adds the v4 SwapRouter and V4Quoter
// pointed at that PoolManager. Permit2 is the canonical singleton, already
// present on Monad testnet at the same address as every other chain.

export const HOOK_ADDRESS    = "0x4676D3dec853B518110702d90E5f43CF803C2a88" as Address; // OrbitalHook (USDC/USDT/DAI/FRAX)
export const POOL_MANAGER    = "0x9BEACCac4e0358Cc276703dcE7341B9B9fEfd5f7" as Address; // self-deployed v4 PoolManager
export const SWAP_ROUTER     = "0xC30819b8ac12B5d12751b83cFfebD6F0bFa0b53E" as Address; // v4Router04
export const QUOTER_ADDRESS  = "0x3f53c9ae1ae5D34D8A89986ea456da8e69916725" as Address; // V4Quoter
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address; // canonical

// The OrbitalHook is both the "pool" (engine state + LP surface) and the swap
// target. LP positions are soulbound ERC-6909 shares on the hook (tokenId =
// tickIdx) — the Positions/LP pages read & write the hook directly via
// HOOK_LP_ABI; there is no separate PositionManager.
export const POOL_ADDRESS    = HOOK_ADDRESS;
export const POOL_ADDRESSES  = [HOOK_ADDRESS] as const;
export const ROUTER_ADDRESS  = SWAP_ROUTER;

// Registered assets, named by symbol. The hook internally stores them
// sorted-ascending by address; the frontend looks them up via TOKEN_META.
export const TOKEN_ADDRESSES = {
  USDC: "0xa854E3ee9eFa1936034dE51CCD6e6fB66F4309cF" as Address,
  USDT: "0xaF9Bc1C4a47860D970BD20472776EFE24526660d" as Address,
  DAI:  "0xbBd1DD6CEA4E7D114439DB527a99d0Aae789203b" as Address,
  FRAX: "0x081588D70E9cC742Ab99bb80c2370f501E791531" as Address,
} as const;

// Pool fee in hundredths of a bip (matches the hook's immutable `fee`).
export const POOL_FEE: number = 100;
export const POOL_TICK_SPACING: number = 1;
export const POOL_KEY_LP_FEE: number = 0;

// Block the OrbitalHook was deployed at on Monad testnet — event scanners
// start here instead of genesis.
export const DEPLOY_BLOCK = 50191823n;

// ─── Token metadata (static) ──────────────────────────────────────────────────
// Keys are lowercased token addresses; values are display metadata.

export const TOKEN_META: Record<string, { symbol: string; name: string; color: string; decimals: number }> = {
  "0xa854e3ee9efa1936034de51ccd6e6fb66f4309cf": { symbol: "USDC", name: "USD Coin",       color: "#2775CA", decimals: 18 },
  "0xaf9bc1c4a47860d970bd20472776efe24526660d": { symbol: "USDT", name: "Tether USD",     color: "#26A17B", decimals: 18 },
  "0xbbd1dd6cea4e7d114439db527a99d0aae789203b": { symbol: "DAI",  name: "Dai Stablecoin",  color: "#F5AC37", decimals: 18 },
  "0x081588d70e9cc742ab99bb80c2370f501e791531": { symbol: "FRAX", name: "Frax",            color: "#BFBFBF", decimals: 18 },
};

// ─── PoolKey ──────────────────────────────────────────────────────────────────

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/// Build the canonical v4 PoolKey for a pair, plus the swap direction.
/// `zeroForOne` is true when the input token is currency0 (the lower address).
export function buildPoolKey(tokenIn: Address, tokenOut: Address): { key: PoolKey; zeroForOne: boolean } {
  const inLower = tokenIn.toLowerCase();
  const outLower = tokenOut.toLowerCase();
  const zeroForOne = inLower < outLower;
  const [currency0, currency1] = zeroForOne ? [tokenIn, tokenOut] : [tokenOut, tokenIn];
  return {
    key: { currency0, currency1, fee: POOL_KEY_LP_FEE, tickSpacing: POOL_TICK_SPACING, hooks: HOOK_ADDRESS },
    zeroForOne,
  };
}

// ─── ABIs ─────────────────────────────────────────────────────────────────────

// OrbitalHook (the "pool" engine). Note v4 naming: N(), assetAt(), 5-field slot0.
export const POOL_ABI = [
  { type: "function", name: "N",        inputs: [], outputs: [{ type: "uint8"   }], stateMutability: "view" },
  { type: "function", name: "fee",      inputs: [], outputs: [{ type: "uint24"  }], stateMutability: "view" },
  { type: "function", name: "numTicks", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function", name: "slot0", inputs: [],
    outputs: [
      { name: "sumX",   type: "uint256" },
      { name: "sumXSq", type: "uint256" },
      { name: "rInt",   type: "uint256" },
      { name: "kBound", type: "uint256" },
      { name: "sBound", type: "uint256" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "assetAt",  inputs: [{ name: "", type: "uint8"   }], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "reserves", inputs: [{ name: "", type: "uint8"   }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function", name: "ticks", inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "k",               type: "uint256" },
      { name: "r",               type: "uint256" },
      { name: "isInterior",      type: "bool"    },
      { name: "feeGrowthInside", type: "uint256" },
      { name: "liquidityGross",  type: "uint128" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "feeGrowthGlobal", inputs: [{ name: "", type: "uint8" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve",   inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "decimals",  inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "symbol",    inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
] as const;

export const MOCK_ERC20_ABI = [
  ...ERC20_ABI,
  { type: "function", name: "mint", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

const POOL_KEY_COMPONENTS = [
  { name: "currency0",   type: "address" },
  { name: "currency1",   type: "address" },
  { name: "fee",         type: "uint24"  },
  { name: "tickSpacing", type: "int24"   },
  { name: "hooks",       type: "address" },
] as const;

// V4Quoter — quoteExactInputSingle is `nonpayable` on-chain but read-only via
// eth_call (it reverts internally and returns the decoded result). We type it
// `view` so the frontend can read it with `useReadContract` (a plain eth_call,
// no connected wallet required) instead of `useSimulateContract`.
export const QUOTER_ABI = [
  {
    type: "function", name: "quoteExactInputSingle",
    inputs: [{
      name: "params", type: "tuple",
      components: [
        { name: "poolKey",     type: "tuple", components: POOL_KEY_COMPONENTS },
        { name: "zeroForOne",  type: "bool"    },
        { name: "exactAmount", type: "uint128" },
        { name: "hookData",    type: "bytes"   },
      ],
    }],
    outputs: [
      { name: "amountOut",   type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

// OrbitalHook LP surface: ERC-6909 share balance + direct LP entry points.
// Positions live as soulbound ERC-6909 shares (tokenId = tickIdx) on the hook.
export const HOOK_LP_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ name: "owner", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function", name: "addLiquidity",
    inputs: [
      { name: "kWad", type: "uint256" },
      { name: "rWad", type: "uint256" },
      { name: "maxAmounts", type: "uint256[]" },
    ],
    outputs: [{ name: "tickIdx", type: "uint256" }, { name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "removeLiquidity",
    inputs: [
      { name: "tickIdx", type: "uint256" },
      { name: "rWad", type: "uint256" },
      { name: "minAmounts", type: "uint256[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "collect",
    inputs: [{ name: "tickIdx", type: "uint256" }],
    outputs: [{ name: "fees", type: "uint256[]" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event", name: "Mint",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "tickIdx",   type: "uint256", indexed: true },
      { name: "kWad",      type: "uint256", indexed: false },
      { name: "rWad",      type: "uint256", indexed: false },
      { name: "amounts",   type: "uint256[]", indexed: false },
    ],
  },
] as const;

// v4 single-pool swap router (hookmate IUniswapV4Router04).
export const ROUTER_ABI = [
  {
    type: "function", name: "swapExactTokensForTokens",
    inputs: [
      { name: "amountIn",     type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "zeroForOne",   type: "bool"    },
      { name: "poolKey",      type: "tuple", components: POOL_KEY_COMPONENTS },
      { name: "hookData",     type: "bytes"   },
      { name: "receiver",     type: "address" },
      { name: "deadline",     type: "uint256" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
    stateMutability: "payable",
  },
] as const;
