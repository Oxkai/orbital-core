"use client";

import { useRef } from "react";
import { useReadContracts } from "wagmi";
import { type Address } from "viem";
import { ERC20_ABI } from "@/lib/contracts";
import { monadTestnet } from "@/lib/wagmi";

const WAD = 10n ** 18n;

function wadToNumber(raw: bigint): number {
  // Divide bigint first to avoid float precision loss on large values
  return Number(raw / WAD) + Number(raw % WAD) / 1e18;
}

export function useTokenBalances(tokenAddresses: Address[], account: Address | undefined) {
  const { data, isLoading, refetch } = useReadContracts({
    contracts: tokenAddresses.map(addr => ({
      address: addr,
      chainId: monadTestnet.id,
      abi: ERC20_ABI,
      functionName: "balanceOf" as const,
      args: [account ?? "0x0000000000000000000000000000000000000000"] as const,
    })),
    query: { enabled: !!account && tokenAddresses.length > 0 },
  });

  // A failed read is not a zero balance. The public RPC drops calls under load,
  // and rendering 0 both misleads and disables the swap button — so the last
  // value that actually resolved is retained until a fresh one arrives.
  const lastGood = useRef<Record<string, number>>({});
  let anyResolved = false;

  const balances = tokenAddresses.map((addr, i) => {
    const raw = data?.[i]?.result as bigint | undefined;
    const key = addr.toLowerCase();
    if (raw !== undefined) {
      anyResolved = true;
      const v = wadToNumber(raw);
      lastGood.current[key] = v;
      return v;
    }
    return lastGood.current[key] ?? 0;
  });

  // True once every requested balance has resolved at least once, so callers
  // can tell "still loading" apart from "genuinely holds nothing".
  const isReady =
    tokenAddresses.length > 0 &&
    tokenAddresses.every(a => lastGood.current[a.toLowerCase()] !== undefined);

  return { balances, isLoading, isReady, anyResolved, refetch };
}

export function useTokenAllowances(
  tokenAddresses: Address[],
  owner: Address | undefined,
  spender: Address,
) {
  const { data, isLoading, refetch } = useReadContracts({
    contracts: tokenAddresses.map(addr => ({
      address: addr,
      chainId: monadTestnet.id,
      abi: ERC20_ABI,
      functionName: "allowance" as const,
      args: [owner ?? "0x0000000000000000000000000000000000000000", spender] as const,
    })),
    query: { enabled: !!owner && tokenAddresses.length > 0 },
  });

  const allowances = tokenAddresses.map((_, i) => {
    const raw = data?.[i]?.result as bigint | undefined;
    return raw ?? 0n;
  });

  return { allowances, isLoading, refetch };
}
