import { createConfig, http, fallback, type Config } from "wagmi";
import { defineChain } from "viem";
import { injected, coinbaseWallet } from "wagmi/connectors";

const MONAD_TESTNET_RPC = "https://testnet-rpc.monad.xyz";

// Monad testnet — the Orbital stack (PoolManager, hook, router, quoter) is
// deployed here. Monad has no canonical v4 yet, so Deploy.s.sol brings its own
// PoolManager; see the root README for addresses.
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [MONAD_TESTNET_RPC] },
  },
  blockExplorers: {
    default: {
      name: "MonadScan",
      url: "https://testnet.monadscan.com",
    },
  },
  testnet: true,
});

// Canonical block-explorer URL builders. Use these from components instead of
// hard-coding the explorer base.
export const EXPLORER_BASE = monadTestnet.blockExplorers.default.url;
export const explorerAddressUrl = (address: string) => `${EXPLORER_BASE}/address/${address}`;
export const explorerTxUrl      = (hash: string)    => `${EXPLORER_BASE}/tx/${hash}`;

export function createWagmiConfig(): Config {
  const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;
  return createConfig({
    chains: [monadTestnet],
    connectors: [injected(), coinbaseWallet({ appName: "Orbital" })],
    transports: {
      [monadTestnet.id]: RPC_URL
        ? fallback([http(RPC_URL), http(MONAD_TESTNET_RPC)])
        : http(MONAD_TESTNET_RPC),
    },
  });
}

export type WagmiConfig = ReturnType<typeof createWagmiConfig>;

declare module "wagmi" {
  interface Register {
    config: WagmiConfig;
  }
}
