"use client";

/**
 * Privy-backed wallet provider.
 *
 * Orbital's access problem is the first ninety seconds: before anyone sees a
 * quote they need a browser wallet, then native gas from a faucet, then minted
 * test stablecoins. The wallet is the step that loses people who do not already
 * have one, and it is the one step that is not actually about the AMM.
 *
 * Privy removes it. Log in with email or a social account and an embedded
 * wallet is provisioned; an existing wallet still connects exactly as before.
 * Either way the app downstream is unchanged, because Privy's `WagmiProvider`
 * is a drop-in for wagmi's own and every `useAccount` / `useWriteContract` in
 * the app keeps working against the same hooks.
 *
 * This file is mounted ONLY when `NEXT_PUBLIC_PRIVY_APP_ID` is set, so a build
 * without the key falls back to the plain wagmi provider rather than failing.
 * See `Web3Provider`.
 */

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import {
  SUPPORTED_CHAINS,
  SUPPORTED_TRANSPORTS,
  monadTestnet,
} from "@/lib/wagmi";

/**
 * No `connectors` here, unlike the plain config: Privy owns connector
 * lifecycle, and declaring our own alongside it means two systems racing to
 * set the active wallet.
 */
function createPrivyWagmiConfig() {
  return createConfig({
    chains: SUPPORTED_CHAINS,
    transports: SUPPORTED_TRANSPORTS,
  });
}

export function PrivyWeb3Provider({
  appId,
  children,
}: {
  appId: string;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const [config] = useState(() => createPrivyWagmiConfig());

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "wallet", "google"],
        // Monad first, matching the swap widget's default, so a new user lands
        // on the chain the app opens on instead of switching immediately.
        defaultChain: monadTestnet,
        supportedChains: [...SUPPORTED_CHAINS],
        embeddedWallets: {
          // Anyone arriving with a wallet keeps using it; only the people who
          // would otherwise be blocked get one created.
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        appearance: {
          theme: "dark",
          walletChainType: "ethereum-only",
          logo: "/icon.svg",
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
