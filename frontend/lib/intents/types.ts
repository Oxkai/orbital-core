/**
 * NEAR Intents types, narrowed to what the arrival quote needs.
 *
 * Mirrors the 1Click API rather than importing from the SDK: the SDK's own
 * types travel with a runner, a wallet connector and a signing stack, none of
 * which a quote needs. A dry quote is one POST.
 */

/** A token 1Click can route, as the service lists it. */
export type IntentsToken = {
  /** Opaque routing id, e.g. `nep141:arb-0xaf88….omft.near`. Never constructed by hand. */
  assetId: string;
  /** Lowercase chain slug: `arb`, `base`, `near`, `sol`, `btc`. */
  blockchain: string;
  symbol: string;
  decimals: number;
  /** Absent for a chain's native asset. */
  contractAddress?: string;
  /** USD reference price, for showing what a route costs. */
  price?: number;
};

export type IntentsQuoteRequest = {
  originAssetId: string;
  destinationAssetId: string;
  /** Atomic units of the origin asset. */
  amount: string;
  /** Basis points. */
  slippageBps?: number;
};

/**
 * What a dry quote answers: what arrives, what it costs, how long it takes.
 *
 * Deliberately no deposit address and no signing payload — a dry quote has
 * neither, which is the point. Nothing here commits the user to anything.
 */
export type IntentsQuote = {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd?: string;
  /** Post-slippage floor the route guarantees. */
  minAmountOut: string;
  /** Seconds, as estimated by the solver network. */
  timeEstimate?: number;
  /** Atomic units of the destination asset, both charged by the service. */
  refundFee?: string;
  withdrawFee?: string;
};

export type IntentsQuoteResult =
  | { ok: true; quote: IntentsQuote }
  | { ok: false; error: string };

/** Chain slugs 1Click uses, mapped to names worth showing a user. */
export const CHAIN_LABELS: Record<string, string> = {
  eth: "Ethereum",
  arb: "Arbitrum",
  base: "Base",
  op: "Optimism",
  pol: "Polygon",
  bsc: "BNB Chain",
  avax: "Avalanche",
  gnosis: "Gnosis",
  scroll: "Scroll",
  xlayer: "X Layer",
  bera: "Berachain",
  monad: "Monad",
  hood: "Robinhood Chain",
  plasma: "Plasma",
  aurora: "Aurora",
  near: "NEAR",
  sol: "Solana",
  btc: "Bitcoin",
  doge: "Dogecoin",
  ltc: "Litecoin",
  bch: "Bitcoin Cash",
  dash: "Dash",
  zec: "Zcash",
  xrp: "XRP",
  ton: "TON",
  tron: "Tron",
  sui: "Sui",
  aptos: "Aptos",
  stellar: "Stellar",
  cardano: "Cardano",
  starknet: "Starknet",
  aleo: "Aleo",
  movement: "Movement",
  hypercore: "Hyperliquid",
  fogo: "Fogo",
  adi: "ADI",
  qtc: "Quantum",
  miden: "Miden",
  abs: "Abstract",
};

export function chainLabel(slug: string): string {
  return CHAIN_LABELS[slug] ?? slug;
}
