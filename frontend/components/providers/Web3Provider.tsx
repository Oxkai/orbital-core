"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createWagmiConfig } from "@/lib/wagmi";
import { PrivyWeb3Provider } from "./PrivyWeb3Provider";

/// Privy is used when an app id is configured, and the app falls back to plain
/// wagmi connectors when it is not.
///
/// The fallback is deliberate rather than defensive: the deployment should not
/// depend on a third-party key being present to render a quote. A fork, a CI
/// build or a local checkout without the key gets the ordinary
/// injected-wallet flow and every page still works.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

function WagmiOnlyProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [config] = useState(() => createWagmiConfig());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function Web3Provider({ children }: { children: React.ReactNode }) {
  if (PRIVY_APP_ID) {
    return (
      <PrivyWeb3Provider appId={PRIVY_APP_ID}>{children}</PrivyWeb3Provider>
    );
  }
  return <WagmiOnlyProvider>{children}</WagmiOnlyProvider>;
}
