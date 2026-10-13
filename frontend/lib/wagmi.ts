import { createConfig, http, fallback, type Config } from "wagmi";
import { defineChain } from "viem";
import { arbitrumSepolia, sepolia, baseSepolia } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

// Monad testnet. Not in viem's chain list, so defined here by hand.
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://testnet.monadscan.com" } },
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

// Explorer links are per chain: use `explorerTx` / `explorerAddress` from
// `lib/crosschain`, which read each deployment's own explorer.

// Robinhood Chain testnet is the primary deployment; Arbitrum Sepolia, Base
// Sepolia and Ethereum Sepolia carry the same hook. All are same-chain only.
export { arbitrumSepolia, sepolia, baseSepolia };

export function createWagmiConfig(): Config {
  return createConfig({
    chains: [robinhoodTestnet, arbitrumSepolia, baseSepolia, sepolia, monadTestnet],
    connectors: [injected(), coinbaseWallet({ appName: "Orbital" })],
    transports: {
      [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
      [robinhoodTestnet.id]: http("https://rpc.testnet.chain.robinhood.com"),
      [baseSepolia.id]: http("https://base-sepolia-rpc.publicnode.com"),
      [sepolia.id]: http("https://sepolia.drpc.org"),
      [monadTestnet.id]: http("https://testnet-rpc.monad.xyz"),
    },
  });
}

export type WagmiConfig = ReturnType<typeof createWagmiConfig>;

declare module "wagmi" {
  interface Register {
    config: WagmiConfig;
  }
}
