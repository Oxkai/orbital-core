"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type AbiEvent } from "viem";
import { POOL_ADDRESS, DEPLOY_BLOCK } from "@/lib/contracts";

const WAD = 1e18;

const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, uint8 assetIn, uint8 assetOut, uint256 amountIn, uint256 amountOut)"
) as AbiEvent;

export function useVolume24h(fee: number) {
  const client = usePublicClient();
  const [volume24h, setVolume24h] = useState(0);
  const [fees24h,   setFees24h]   = useState(0);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    async function load() {
      try {
        const latest = await client!.getBlockNumber();

        // The public RPC caps getLogs at 100 blocks, and Monad's ~0.4s blocks
        // mean 100 blocks is only ~40s of chain time — so this is recent
        // volume, not a true 24h figure. Windows are fetched in parallel waves
        // rather than one at a time, which is what makes a wider span
        // affordable: 12k blocks is roughly 80 minutes of history.
        const RECENT_BLOCKS = 12_000n;
        const CHUNK = 100n;
        const WAVE = 10;
        const start = latest - RECENT_BLOCKS > DEPLOY_BLOCK ? latest - RECENT_BLOCKS : DEPLOY_BLOCK;

        const windows: { from: bigint; to: bigint }[] = [];
        for (let from = start; from <= latest; from += CHUNK) {
          windows.push({ from, to: from + CHUNK - 1n < latest ? from + CHUNK - 1n : latest });
        }

        let vol = 0;
        for (let i = 0; i < windows.length; i += WAVE) {
          if (cancelled) return;
          const batches = await Promise.all(
            windows.slice(i, i + WAVE).map(w =>
              client!.getLogs({ address: POOL_ADDRESS, event: SWAP_EVENT, fromBlock: w.from, toBlock: w.to })
                .catch(() => []),
            ),
          );
          for (const logs of batches) {
            for (const log of logs) {
              const { amountIn } = log.args as { amountIn: bigint };
              vol += Number(amountIn) / WAD;
            }
          }
        }

        if (cancelled) return;
        setVolume24h(vol);
        setFees24h(vol * fee / 1_000_000);
      } catch (e) {
        console.warn("[useVolume24h]", e);
      }
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [client, fee]);

  return { volume24h, fees24h };
}
