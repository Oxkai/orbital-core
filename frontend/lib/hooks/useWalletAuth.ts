"use client";

/**
 * One sign-in surface over two wallet backends.
 *
 * With `NEXT_PUBLIC_PRIVY_APP_ID` set, signing in opens Privy's modal: email,
 * a social account, or an existing wallet, with an embedded wallet provisioned
 * for anyone who arrives without one. Without the key, it falls back to the
 * injected connector exactly as before.
 *
 * Callers get the same four values either way and never branch on which
 * backend is live.
 *
 * The implementation is chosen at module scope, not per render. `usePrivy`
 * throws outside a `PrivyProvider`, so it cannot be called behind a runtime
 * condition — but the app id is a build-time constant, so the branch is fixed
 * for the lifetime of the bundle and hook order is stable.
 */

import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useConnect, useConnectors, useDisconnect } from "wagmi";

export type WalletAuth = {
  address?: `0x${string}`;
  isConnected: boolean;
  /** False until the backend has restored any existing session. */
  isReady: boolean;
  isPending: boolean;
  signIn: () => void;
  signOut: () => void;
};

function useWagmiAuth(): WalletAuth {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const connectors = useConnectors();
  const { disconnect } = useDisconnect();

  return {
    address,
    isConnected,
    isReady: true,
    isPending,
    signIn: () => {
      const connector =
        connectors.find((c) => c.type === "injected") ?? connectors[0];
      if (connector) connect({ connector });
    },
    signOut: () => disconnect(),
  };
}

function usePrivyAuth(): WalletAuth {
  const { ready, authenticated, login, logout } = usePrivy();
  // wagmi still reports the address: Privy's WagmiProvider syncs the active
  // wallet into wagmi, so everything downstream keeps reading `useAccount`.
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  return {
    address,
    isConnected: authenticated && isConnected,
    isReady: ready,
    isPending: !ready,
    signIn: () => login(),
    signOut: () => {
      // Drop the wagmi connection as well, or the address lingers in the UI
      // after Privy has ended the session.
      disconnect();
      void logout();
    },
  };
}

export const useWalletAuth: () => WalletAuth = process.env
  .NEXT_PUBLIC_PRIVY_APP_ID
  ? usePrivyAuth
  : useWagmiAuth;
