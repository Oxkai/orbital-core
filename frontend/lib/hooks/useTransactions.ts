"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type Address, type AbiEvent } from "viem";
import { POOL_ADDRESSES, TOKEN_META, DEPLOY_BLOCK } from "@/lib/contracts";

// Monad's public RPC rejects any eth_getLogs wider than a 100-block range, so
// 100 is the safe default. A dedicated endpoint usually allows far more — set
// NEXT_PUBLIC_LOG_CHUNK to widen it and the scan gets proportionally faster.
const CHUNK = BigInt(process.env.NEXT_PUBLIC_LOG_CHUNK ?? 100);

// Monad produces ~0.4s blocks, so a 100-block window is only ~40s of chain
// time and any real history needs a lot of windows. Walking them one at a time
// costs ~0.8s each; issuing them in waves collapses a 40-chunk scan from ~32s
// to ~4s. Kept modest so a burst doesn't trip the public node's rate limit.
const WAVE = 10;

// Blocks covered per scan. `loadMore` continues from the returned cursor.
const MAX_CHUNKS_PER_SCAN = 120;

const PAGE_SIZE = 20;
const POLL_MS = 15_000;
const TS_BATCH = 8;

const WAD = 1e18;
const fmt = (raw: bigint) => (Number(raw) / WAD).toFixed(2);

const HOOK = POOL_ADDRESSES[0] as Address;

export type TxType = "Swap" | "Add" | "Remove" | "Collect";

export interface TxRecord {
  type: TxType;
  hash: `0x${string}`;
  blockNumber: bigint;
  timestamp: number; // unix seconds
  actor: Address;
  amountIn: string;
  amountOut: string;
}
type RawTx = Omit<TxRecord, "timestamp">;

const SWAP = parseAbiItem("event Swap(address indexed sender, uint8 assetIn, uint8 assetOut, uint256 amountIn, uint256 amountOut)") as AbiEvent;
const MINT = parseAbiItem("event Mint(address indexed recipient, uint256 indexed tickIdx, uint256 kWad, uint256 rWad, uint256[] amounts)") as AbiEvent;
const BURN = parseAbiItem("event Burn(address indexed owner, uint256 indexed tickIdx, uint256 rWad, uint256[] amounts)") as AbiEvent;
const COLLECT = parseAbiItem("event Collect(address indexed owner, uint256 indexed tickIdx, uint256[] fees)") as AbiEvent;

// timestamps are immutable, so cache across renders/pages
const tsCache = new Map<bigint, number>();

// Session snapshot: keeps the scanned page alive across route changes so
// revisiting the transactions page is instant — only the new tail is polled.
// Lives outside React, so unmount/remount doesn't discard it. Cleared on a
// full page reload.
let snapshot: { records: TxRecord[]; backCursor: bigint | null; headBlock: bigint; hasMore: boolean } | null = null;

type Client = NonNullable<ReturnType<typeof usePublicClient>>;

async function fetchTimestamps(client: Client, blocks: bigint[]): Promise<Map<bigint, number>> {
  const unique = [...new Set(blocks)].filter((n) => !tsCache.has(n));
  for (let i = 0; i < unique.length; i += TS_BATCH) {
    const batch = unique.slice(i, i + TS_BATCH);
    const res = await Promise.all(batch.map((n) => client.getBlock({ blockNumber: n })));
    res.forEach((b) => { if (b.timestamp) tsCache.set(b.number!, Number(b.timestamp)); });
  }
  const map = new Map<bigint, number>();
  blocks.forEach((n) => { const t = tsCache.get(n); if (t) map.set(n, t); });
  return map;
}

// One ≤CHUNK-block window. viem's `events` option builds a single topic-OR
// filter and decodes for us, so all four event types cost one request instead
// of four. That matters more than it looks: the public node rate-limits per
// request, and four-per-chunk was the main source of the partial failures.
async function fetchChunk(client: Client, from: bigint, to: bigint, sym: (i: number) => string): Promise<RawTx[]> {
  const logs = await client.getLogs({
    address: HOOK,
    events: [SWAP, MINT, BURN, COLLECT],
    fromBlock: from,
    toBlock: to,
  });

  const out: RawTx[] = [];
  for (const log of logs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (log as any).args ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const name = (log as any).eventName as string | undefined;
    const base = { hash: log.transactionHash!, blockNumber: log.blockNumber! };

    switch (name) {
      case "Swap":
        out.push({ ...base, type: "Swap", actor: a.sender,
          amountIn: `${fmt(a.amountIn)} ${sym(Number(a.assetIn))}`,
          amountOut: `${fmt(a.amountOut)} ${sym(Number(a.assetOut))}` });
        break;
      case "Mint":
        out.push({ ...base, type: "Add", actor: a.recipient, amountIn: `$${fmt(a.rWad)}`, amountOut: "" });
        break;
      case "Burn":
        out.push({ ...base, type: "Remove", actor: a.owner, amountIn: `$${fmt(a.rWad)} tick #${a.tickIdx}`, amountOut: "" });
        break;
      case "Collect":
        out.push({ ...base, type: "Collect", actor: a.owner, amountIn: `tick #${a.tickIdx}`, amountOut: "" });
        break;
    }
  }
  return out;
}

/** Window boundaries for `count` chunks walking backward from `startTo`. */
function windowsBack(startTo: bigint, count: number): { from: bigint; to: bigint }[] {
  const out: { from: bigint; to: bigint }[] = [];
  let to = startTo;
  for (let i = 0; i < count && to >= DEPLOY_BLOCK; i++) {
    const from = to - CHUNK + 1n < DEPLOY_BLOCK ? DEPLOY_BLOCK : to - CHUNK + 1n;
    out.push({ from, to });
    if (from === DEPLOY_BLOCK) break;
    to = from - 1n;
  }
  return out;
}

export function useTransactions(poolTokens: { symbol: string; address: string }[]) {
  const client = usePublicClient();
  const [txs, setTxs] = useState<TxRecord[]>(() => snapshot?.records ?? []);
  const [isLoading, setIsLoading] = useState(!snapshot);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(snapshot?.hasMore ?? true);
  const [error, setError] = useState<string | null>(null);

  const backCursor = useRef<bigint | null>(snapshot?.backCursor ?? null); // next toBlock to scan downward
  const headBlock = useRef<bigint>(snapshot?.headBlock ?? 0n); // highest block already covered (for tail poll)

  const sym = useCallback((idx: number) =>
    poolTokens[idx]?.symbol ?? TOKEN_META[poolTokens[idx]?.address?.toLowerCase() ?? ""]?.symbol ?? `Asset#${idx}`,
  [poolTokens]);

  const withTs = useCallback(async (raw: RawTx[]): Promise<TxRecord[]> => {
    const tsMap = await fetchTimestamps(client!, raw.map((r) => r.blockNumber));
    return raw.map((r) => ({ ...r, timestamp: tsMap.get(r.blockNumber) ?? 0 }));
  }, [client]);

  // Scan backward from `startTo` in CHUNK windows until ≥ limit records or deploy.
  const scanBack = useCallback(async (startTo: bigint, limit: number) => {
    const windows = windowsBack(startTo, MAX_CHUNKS_PER_SCAN);
    const acc: RawTx[] = [];
    let covered = 0;

    // Walk the windows in parallel waves. Stop as soon as a wave has produced
    // enough records — the pool is usually quiet, so most scans run the whole
    // budget and the wave is what keeps that to a few seconds instead of ~90.
    for (let i = 0; i < windows.length; i += WAVE) {
      const wave = windows.slice(i, i + WAVE);
      const results = await Promise.all(
        wave.map(w => fetchChunk(client!, w.from, w.to, sym).catch(() => [] as RawTx[])),
      );
      results.forEach(r => acc.push(...r));
      covered = i + wave.length;
      if (acc.length >= limit) break;
    }

    acc.sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1));

    // Resume below the deepest window actually scanned.
    const last = windows[covered - 1];
    const nextCursor = last && last.from > DEPLOY_BLOCK ? last.from - 1n : null;
    return { records: await withTs(acc), nextCursor };
  }, [client, sym, withTs]);

  // Initial load + tail-only poll (only fetches blocks newer than headBlock).
  useEffect(() => {
    if (!client || poolTokens.length === 0) return;
    let cancelled = false;

    async function init() {
      // Already scanned this session → show instantly, just refresh the tail.
      if (snapshot && snapshot.records.length) { setIsLoading(false); await poll(); return; }
      setIsLoading(true);
      setError(null);
      try {
        const latest = await client!.getBlockNumber();
        const { records, nextCursor } = await scanBack(latest, PAGE_SIZE);
        if (cancelled) return;
        setTxs(records);
        backCursor.current = nextCursor;
        headBlock.current = latest;
        setHasMore(nextCursor !== null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    async function poll() {
      if (cancelled) return;
      try {
        const latest = await client!.getBlockNumber();
        if (latest <= headBlock.current) return;
        // Build the tail windows up front, then fetch them in waves. A tab left
        // idle can fall thousands of blocks behind on Monad, and walking that
        // back one window at a time would stall every poll.
        const tail: { from: bigint; to: bigint }[] = [];
        for (let from = headBlock.current + 1n; from <= latest; ) {
          const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
          tail.push({ from, to });
          from = to + 1n;
        }
        const fresh: RawTx[] = [];
        for (let i = 0; i < tail.length; i += WAVE) {
          const results = await Promise.all(
            tail.slice(i, i + WAVE).map(w => fetchChunk(client!, w.from, w.to, sym).catch(() => [] as RawTx[])),
          );
          results.forEach(r => fresh.push(...r));
        }
        headBlock.current = latest;
        if (fresh.length === 0 || cancelled) return;
        const withTime = await withTs(fresh);
        setTxs((prev) => {
          const seen = new Set(prev.map((t) => `${t.hash}-${t.blockNumber}`));
          const merged = [...withTime.filter((t) => !seen.has(`${t.hash}-${t.blockNumber}`)), ...prev];
          merged.sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1));
          return merged;
        });
      } catch {
        // ignore transient poll errors
      }
    }

    init();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, poolTokens.length]);

  // Keep the session snapshot current so revisiting the route is instant.
  useEffect(() => {
    if (txs.length) snapshot = { records: txs, backCursor: backCursor.current, headBlock: headBlock.current, hasMore };
  }, [txs, hasMore]);

  const loadMore = useCallback(async () => {
    if (backCursor.current === null || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const { records, nextCursor } = await scanBack(backCursor.current, PAGE_SIZE);
      setTxs((prev) => [...prev, ...records]);
      backCursor.current = nextCursor;
      setHasMore(nextCursor !== null);
    } catch {
      // ignore
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, scanBack]);

  const refetch = useCallback(async () => {
    if (!client || poolTokens.length === 0) return;
    try {
      const latest = await client.getBlockNumber();
      const { records, nextCursor } = await scanBack(latest, PAGE_SIZE);
      setTxs(records);
      backCursor.current = nextCursor;
      headBlock.current = latest;
      setHasMore(nextCursor !== null);
    } catch {
      // ignore
    }
  }, [client, poolTokens.length, scanBack]);

  return { txs, isLoading, isLoadingMore, hasMore, loadMore, error, refetch };
}
