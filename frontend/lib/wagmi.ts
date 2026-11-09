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

// Explorer links are per chain: use `explorerTx` / `explorerAddress` from
// `lib/crosschain`, which read each deployment's own explorer.

// Robinhood Chain testnet is the primary deployment; Arbitrum Sepolia, Base
// Sepolia and Ethereum Sepolia carry the same hook. All are same-chain only.
export { arbitrumSepolia, baseSepolia };

export function createWagmiConfig(): Config {
  return createConfig({
    chains: [auroraTestnet, robinhoodTestnet, baseSepolia, arbitrumSepolia],
    connectors: [injected(), coinbaseWallet({ appName: "Orbital" })],
    transports: {
      [auroraTestnet.id]: http("https://testnet.aurora.dev"),
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
