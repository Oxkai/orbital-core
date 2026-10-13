/**
 * Contract reads, as Envio effects.
 *
 * Two of them, deliberately coarse. An effect per `ticks(i)` call would give
 * the indexer 31 cache entries to manage per block for values that are only
 * ever read together; batching them means a handful of multicalls and one
 * cache entry.
 *
 * Both are cached. `poolConfig` is keyed by the hook alone because `N`, the
 * asset addresses, their decimals and scales are immutable in the hook.
 * `engineState` is keyed by hook AND block, which is what makes it safe to
 * cache at all: the same block always has the same state, so a restart or a
 * re-index replays from cache instead of re-reading the chain.
 *
 * The reads are grouped one `functionName` at a time rather than as a single
 * heterogeneous batch: viem infers the contracts array's element type across
 * the whole literal, so mixing `slot0` with a spread of `reserves` calls
 * collapses the union and the call stops type-checking.
 */

import { createEffect, S } from "envio";
import { client, erc20Abi, hookAbi } from "./chain";

export const poolConfig = createEffect(
  {
    name: "poolConfig",
    input: S.schema({ hook: S.string }),
    output: S.schema({
      assetCount: S.int32,
      feeBps: S.bigint,
      assets: S.array(
        S.schema({
          token: S.string,
          symbol: S.string,
          decimals: S.int32,
          scale: S.bigint,
        }),
      ),
    }),
    // Immutable values behind a cache, so this runs once per deployment.
    rateLimit: false,
    cache: true,
  },
  async ({ input }) => {
    const address = input.hook as `0x${string}`;

    const [nRes, feeRes] = await client.multicall({
      contracts: [
        { address, abi: hookAbi, functionName: "N" },
        { address, abi: hookAbi, functionName: "fee" },
      ],
    });

    const assetCount = nRes?.status === "success" ? Number(nRes.result) : 0;
    const feeBps = feeRes?.status === "success" ? BigInt(feeRes.result) : 0n;
    const idx = Array.from({ length: assetCount }, (_, i) => i);

    const addrRes = await client.multicall({
      contracts: idx.map((i) => ({
        address,
        abi: hookAbi,
        functionName: "assetAt" as const,
        args: [i] as const,
      })),
    });
    const scaleRes = await client.multicall({
      contracts: idx.map((i) => ({
        address,
        abi: hookAbi,
        functionName: "scaleOf" as const,
        args: [i] as const,
      })),
    });

    const tokens = idx.map((i) => {
      const r = addrRes[i];
      return r?.status === "success" ? String(r.result).toLowerCase() : "";
    });

    // Symbol and decimals come from the token, not the hook, so they are two
    // more batches keyed on the addresses the first one returned.
    const known = tokens.filter((t) => t !== "") as `0x${string}`[];
    const symRes = await client.multicall({
      contracts: known.map((t) => ({
        address: t,
        abi: erc20Abi,
        functionName: "symbol" as const,
      })),
    });
    const decRes = await client.multicall({
      contracts: known.map((t) => ({
        address: t,
        abi: erc20Abi,
        functionName: "decimals" as const,
      })),
    });

    const assets = idx.map((i) => {
      const token = tokens[i] ?? "";
      const at = known.indexOf(token as `0x${string}`);
      const sym = at === -1 ? undefined : symRes[at];
      const dec = at === -1 ? undefined : decRes[at];
      const sc = scaleRes[i];
      return {
        token,
        symbol: sym?.status === "success" ? String(sym.result) : "?",
        decimals: dec?.status === "success" ? Number(dec.result) : 18,
        scale: sc?.status === "success" ? BigInt(sc.result) : 1n,
      };
    });

    return { assetCount, feeBps, assets };
  },
);

export const engineState = createEffect(
  {
    name: "engineState",
    input: S.schema({
      hook: S.string,
      blockNumber: S.int32,
      assetCount: S.int32,
    }),
    output: S.schema({
      sumX: S.bigint,
      sumXSq: S.bigint,
      rInt: S.bigint,
      kBound: S.bigint,
      sBound: S.bigint,
      virtualReserveWad: S.bigint,
      reserves: S.array(S.bigint),
      feesAccrued: S.array(S.bigint),
      numTicks: S.int32,
      ticks: S.array(
        S.schema({ k: S.bigint, r: S.bigint, isInterior: S.boolean }),
      ),
    }),
    // Monad's public RPC is the backstop for a backfill that reads state at
    // every log, so the effect caps itself rather than relying on the node.
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input }) => {
    const address = input.hook as `0x${string}`;
    const blockNumber = BigInt(input.blockNumber);
    const idx = Array.from({ length: input.assetCount }, (_, i) => i);

    const head = await client.multicall({
      contracts: [
        { address, abi: hookAbi, functionName: "slot0" },
        { address, abi: hookAbi, functionName: "virtualReserve" },
        { address, abi: hookAbi, functionName: "numTicks" },
      ],
      blockNumber,
    });

    const slot0 = head[0];
    const s = slot0?.status === "success" ? slot0.result : undefined;
    const vr = head[1];
    const nt = head[2];
    const numTicks = nt?.status === "success" ? Number(nt.result) : 0;

    const resRes = await client.multicall({
      contracts: idx.map((i) => ({
        address,
        abi: hookAbi,
        functionName: "reserves" as const,
        args: [i] as const,
      })),
      blockNumber,
    });
    const feeRes = await client.multicall({
      contracts: idx.map((i) => ({
        address,
        abi: hookAbi,
        functionName: "feesAccrued" as const,
        args: [i] as const,
      })),
      blockNumber,
    });
    const tickRes = await client.multicall({
      contracts: Array.from({ length: numTicks }, (_, i) => ({
        address,
        abi: hookAbi,
        functionName: "ticks" as const,
        args: [BigInt(i)] as const,
      })),
      blockNumber,
    });

    return {
      sumX: s?.[0] ?? 0n,
      sumXSq: s?.[1] ?? 0n,
      rInt: s?.[2] ?? 0n,
      kBound: s?.[3] ?? 0n,
      sBound: s?.[4] ?? 0n,
      virtualReserveWad: vr?.status === "success" ? BigInt(vr.result) : 0n,
      reserves: idx.map((i) => {
        const r = resRes[i];
        return r?.status === "success" ? BigInt(r.result) : 0n;
      }),
      feesAccrued: idx.map((i) => {
        const r = feeRes[i];
        return r?.status === "success" ? BigInt(r.result) : 0n;
      }),
      numTicks,
      ticks: Array.from({ length: numTicks }, (_, i) => {
        const r = tickRes[i];
        if (r?.status !== "success") return { k: 0n, r: 0n, isInterior: false };
        const [k, radius, isInterior] = r.result;
        return { k, r: radius, isInterior };
      }),
    };
  },
);
