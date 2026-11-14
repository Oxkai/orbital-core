import { createConfig, http, fallback, type Config } from "wagmi";
import { defineChain } from "viem";
import { arbitrumSepolia, baseSepolia } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";


// Aurora testnet: the EVM that runs on NEAR. Not in viem's chain list.
//
// Aurora has no EIP-1559, so anything that signs here must send legacy
// transactions. viem negotiates that from the chain's own fee responses;
// forge does not, and needs --legacy passed explicitly.
export const auroraTestnet = defineChain({
  id: 1313161555,
  name: "Aurora Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.aurora.dev"] } },
  blockExplorers: {
    default: { name: "Aurora Explorer", url: "https://explorer.testnet.aurora.dev" },
  },
  testnet: true,
});

// Robinhood Chain testnet (an Arbitrum Orbit L2). Not in viem's chain list, so
// defined here by hand.
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

// Monad testnet. Not in viem's chain list.
//
// Monad charges the full gas LIMIT rather than gas used, and `eth_estimateGas`
// is unreliable here, so anything that signs against this chain should send an
// explicit limit rather than trust an estimate.
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://testnet.monadscan.com" },
  },
  testnet: true,
});

// Explorer links are per chain: use `explorerTx` / `explorerAddress` from
// `lib/crosschain`, which read each deployment's own explorer.

// Aurora is the primary deployment (see `PRIMARY_CHAIN_ID`); Monad, Robinhood
// Chain, Base Sepolia and Arbitrum Sepolia carry the same hook. Aurora,
// Arbitrum and Base are peered for cross-chain intents; Monad and Robinhood
// have no settler, so they are same-chain only.
export { arbitrumSepolia, baseSepolia };

export function createWagmiConfig(): Config {
  return createConfig({
    chains: [auroraTestnet, monadTestnet, robinhoodTestnet, baseSepolia, arbitrumSepolia],
    connectors: [injected(), coinbaseWallet({ appName: "Orbital" })],
    transports: {
      [auroraTestnet.id]: http("https://testnet.aurora.dev"),
      [monadTestnet.id]: http("https://testnet-rpc.monad.xyz"),
      [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
      [robinhoodTestnet.id]: http("https://rpc.testnet.chain.robinhood.com"),
      [baseSepolia.id]: http("https://base-sepolia-rpc.publicnode.com"),
    },
  });
}

export type WagmiConfig = ReturnType<typeof createWagmiConfig>;

declare module "wagmi" {
  interface Register {
    config: WagmiConfig;
  }
}
