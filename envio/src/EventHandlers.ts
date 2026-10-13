/**
 * Orbital handlers.
 *
 * Ported from the Graph subgraph's `src/mapping.ts`, with the same contract:
 * raw logs say what happened, and the state read alongside each one says how
 * near the book is to happening again.
 */

import { indexer } from "envio";
import type { EvmOnEventContext, Pool } from "envio";

import { BPS, WAD, bigSqrt, toInt } from "./chain";
import { engineState, poolConfig } from "./effects";

const CHAIN_NAMES: Record<number, string> = {
  10143: "monad-testnet",
};

const tickId = (poolId: string, idx: bigint) => `${poolId}-${idx}`;
const assetId = (poolId: string, i: number) => `${poolId}-${i}`;

type Ev = {
  chainId: number;
  srcAddress: string;
  logIndex: number;
  block: { number: number; timestamp: number };
  transaction: { hash: string };
};

/**
 * Load the pool, creating it on first sight.
 *
 * The basket is read once, through the cached `poolConfig` effect: `N`, the
 * asset addresses, decimals and scales are immutable in the hook, so
 * re-reading them per log would be wasted calls for values that cannot change.
 */
async function loadPool(event: Ev, context: EvmOnEventContext): Promise<Pool> {
  const id = event.srcAddress.toLowerCase();
  const existing = await context.Pool.get(id);
  if (existing) return existing;

  const cfg = await context.effect(poolConfig, { hook: id });

  const pool: Pool = {
    id,
    chainId: event.chainId,
    network: CHAIN_NAMES[event.chainId] ?? String(event.chainId),
    assetCount: cfg.assetCount,
    feeBps: cfg.feeBps,
    sumX: 0n,
    alphaNorm: 0n,
    alphaParity: 0n,
    sumXSq: 0n,
    rInt: 0n,
    kBound: 0n,
    sBound: 0n,
    tickCount: 0,
    interiorTickCount: 0,
    frozen: false,
    virtualReserveWad: 0n,
    swapCount: 0n,
    crossCount: 0n,
    volumeWad: 0n,
    feesWad: 0n,
    lastUpdatedBlock: BigInt(event.block.number),
    lastUpdatedAt: BigInt(event.block.timestamp),
  };
  context.Pool.set(pool);

  cfg.assets.forEach((a, i) => {
    context.Asset.set({
      id: assetId(id, i),
      pool_id: id,
      index: i,
      token: a.token,
      symbol: a.symbol,
      decimals: a.decimals,
      scale: a.scale,
      reserveWad: 0n,
      realReserveWad: 0n,
      feesAccruedWad: 0n,
    });
  });

  return pool;
}

/**
 * Pull live engine state and recompute every tick's distance to its boundary.
 *
 * This is the reason an indexer is worth more than a log scan. `TickCrossed`
 * only fires once a boundary has ALREADY been hit, which is useless as an
 * early warning. Reading `slot0` and `ticks` at each event turns the feed into
 * a leading indicator: how much slack is left, and in which tick.
 *
 * Returns the pool with live state applied, so callers can record the state a
 * swap or crossing left behind without re-reading it.
 */
async function refreshState(
  pool: Pool,
  event: Ev,
  context: EvmOnEventContext,
): Promise<Pool> {
  const st = await context.effect(engineState, {
    hook: pool.id,
    blockNumber: event.block.number,
    assetCount: pool.assetCount,
  });

  // Frozen only when every band with liquidity is pinned: no interior radius
  // is left to trade against or to deposit beside. One pinned band
  // (kBound != 0 alone) leaves swaps, deposits and withdrawals running.
  const frozen = st.rInt === 0n && st.kBound !== 0n;

  for (let i = 0; i < pool.assetCount; i++) {
    const asset = await context.Asset.get(assetId(pool.id, i));
    if (!asset) continue;
    const reserveWad = st.reserves[i] ?? 0n;
    context.Asset.set({
      ...asset,
      reserveWad,
      // The hook guarantees reserves never fall below the virtual floor; the
      // guard only keeps a failed read from underflowing.
      realReserveWad:
        reserveWad > st.virtualReserveWad ? reserveWad - st.virtualReserveWad : 0n,
      feesAccruedWad: st.feesAccrued[i] ?? 0n,
    });
  }

  // Reproduce the engine's own normalised projection.
  //
  //   sqrtN     = sqrt(N * WAD^2)
  //   alphaTot  = sumX * WAD / sqrtN
  //   alphaInt  = max(alphaTot - kBound, 0)
  //   alphaNorm = alphaInt * WAD / rInt
  //
  // This is what `_detectCrossing` compares against each tick's kNorm. Using
  // `sumX - k` instead is neither the right quantity nor the right units:
  // `sumX` is an absolute reserve sum while `k` is a per-tick plane constant,
  // so the two are not comparable at all.
  const sqrtN = bigSqrt(BigInt(pool.assetCount) * WAD * WAD);
  const alphaParity = sqrtN > WAD ? sqrtN - WAD : 0n;

  let alphaNorm = 0n;
  if (sqrtN > 0n && st.rInt > 0n) {
    const alphaTot = (st.sumX * WAD) / sqrtN;
    const alphaInt = alphaTot > st.kBound ? alphaTot - st.kBound : 0n;
    alphaNorm = (alphaInt * WAD) / st.rInt;
  }

  let live = 0;
  let interior = 0;
  let minDist: bigint | undefined;
  let nearest: string | undefined;
  let maxProgress = 0;

  for (let i = 0; i < st.numTicks; i++) {
    const idx = BigInt(i);
    const raw = st.ticks[i];
    if (!raw) continue;

    const id = tickId(pool.id, idx);
    const prev = await context.Tick.get(id);
    // A band nobody has deposited into is not a tick of this pool.
    if (!prev && raw.r === 0n) continue;
    if (raw.r > 0n) live += 1;

    // kNorm = k*WAD/r is the value the engine tests alphaNorm against.
    const kNorm = raw.r > 0n ? (raw.k * WAD) / raw.r : undefined;

    let distanceToBoundaryWad: bigint | undefined;
    let boundaryProgressBps = 10000;
    let shareOfRIntBps = 0;

    if (raw.isInterior) {
      interior += 1;

      // Slack in normalised units. A tick crosses when alphaNorm RISES to meet
      // kNorm, so positive means interior with room left. The sign is kept: a
      // negative value means the tick sits past its own plane, which is an
      // anomaly worth surfacing rather than clamping away.
      if (kNorm !== undefined) {
        distanceToBoundaryWad = kNorm - alphaNorm;
        if (minDist === undefined || distanceToBoundaryWad < minDist) {
          minDist = distanceToBoundaryWad;
          nearest = id;
        }

        // Progress from parity to THIS tick's bound, in bps.
        //
        // Normalising by each tick's own span is what makes a 0.97 tick and a
        // 0.80 tick comparable: they sit at different distances by
        // construction, so a raw gap says nothing about which is nearer to
        // giving way.
        const span = kNorm - alphaParity;
        const travelled = alphaNorm - alphaParity;
        if (span > 0n) {
          const rawBps = toInt((travelled * BPS) / span);
          boundaryProgressBps = rawBps < 0 ? 0 : rawBps > 10000 ? 10000 : rawBps;
        } else {
          // span <= 0: the tick's bound is at or behind parity, so it has no
          // forward journey left. Treat as fully progressed.
          boundaryProgressBps = 10000;
        }
      } else {
        boundaryProgressBps = 0;
      }
      if (boundaryProgressBps > maxProgress) maxProgress = boundaryProgressBps;

      shareOfRIntBps = st.rInt === 0n ? 0 : toInt((raw.r * BPS) / st.rInt);
    }
    // A boundary tick contributes nothing and has no meaningful slack, so it
    // keeps the defaults above: no distance, fully progressed, no share.

    context.Tick.set({
      id,
      pool_id: pool.id,
      tickIdx: idx,
      k: raw.k,
      r: raw.r,
      isInterior: raw.isInterior,
      kNorm,
      distanceToBoundaryWad,
      boundaryProgressBps,
      shareOfRIntBps,
      // A tick seen by state refresh before its own Mint log was handled gets
      // provisional provenance, which `Mint` then corrects.
      crossCount: prev?.crossCount ?? 0n,
      lastCrossedAt: prev?.lastCrossedAt,
      createdAt: prev?.createdAt ?? BigInt(event.block.timestamp),
      createdBlock: prev?.createdBlock ?? BigInt(event.block.number),
      creator: prev?.creator ?? `0x${"0".repeat(40)}`,
    });
  }

  const next: Pool = {
    ...pool,
    sumX: st.sumX,
    sumXSq: st.sumXSq,
    rInt: st.rInt,
    kBound: st.kBound,
    sBound: st.sBound,
    frozen,
    virtualReserveWad: st.virtualReserveWad,
    alphaNorm,
    alphaParity,
    tickCount: live,
    interiorTickCount: interior,
    lastUpdatedBlock: BigInt(event.block.number),
    lastUpdatedAt: BigInt(event.block.timestamp),
  };
  context.Pool.set(next);

  context.PoolSnapshot.set({
    id: `${pool.id}-${event.block.number}-${event.logIndex}`,
    pool_id: pool.id,
    sumX: st.sumX,
    rInt: st.rInt,
    kBound: st.kBound,
    frozen,
    interiorTickCount: interior,
    alphaNorm,
    minDistanceToBoundaryWad: minDist,
    maxBoundaryProgressBps: maxProgress,
    nearestTick: nearest,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
  });

  return next;
}

indexer.onEvent(
  { contract: "OrbitalHook", event: "Swap" },
  async ({ event, context }) => {
  const pool = await loadPool(event, context);

  const inIdx = Number(event.params.assetIn);
  const outIdx = Number(event.params.assetOut);
  const inId = assetId(pool.id, inIdx);
  const outId = assetId(pool.id, outIdx);

  const aIn = await context.Asset.get(inId);
  const aOut = await context.Asset.get(outId);

  // Mixed decimals are the norm here (USDC/USDT 6dp, DAI/FRAX 18dp), so the
  // two legs are not comparable in raw units. Scale both to WAD before doing
  // any arithmetic across them; comparing raw amounts is how a 6dp asset ends
  // up looking like a 1e12 slippage event.
  const amountInWad = event.params.amountIn * (aIn?.scale ?? 1n);
  const amountOutWad = event.params.amountOut * (aOut?.scale ?? 1n);

  const after = await refreshState(pool, event, context);

  context.Swap.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    pool_id: pool.id,
    sender: event.params.sender.toLowerCase(),
    assetInIndex: inIdx,
    assetOutIndex: outIdx,
    assetIn_id: inId,
    assetOut_id: outId,
    amountIn: event.params.amountIn,
    amountOut: event.params.amountOut,
    amountInWad,
    amountOutWad,
    // These are same-peg assets, so 1:1 IS the fair price and everything
    // missing from the output is fee plus curve slippage.
    slippageBps:
      amountInWad === 0n
        ? 0
        : toInt(((amountInWad - amountOutWad) * BPS) / amountInWad),
    rIntAfter: after.rInt,
    frozenAfter: after.frozen,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });

  context.Pool.set({
    ...after,
    swapCount: after.swapCount + 1n,
    volumeWad: after.volumeWad + amountInWad,
    // Fee is charged on input, in hundredths of a bip.
    feesWad: after.feesWad + (amountInWad * after.feeBps) / 1_000_000n,
  });
});

indexer.onEvent(
  { contract: "OrbitalHook", event: "Mint" },
  async ({ event, context }) => {
  const pool = await loadPool(event, context);
  const id = tickId(pool.id, event.params.tickIdx);

  const prev = await context.Tick.get(id);
  context.Tick.set({
    id,
    pool_id: pool.id,
    tickIdx: event.params.tickIdx,
    k: prev?.k ?? event.params.kWad,
    r: prev?.r ?? event.params.rWad,
    isInterior: prev?.isInterior ?? true,
    kNorm: prev?.kNorm,
    distanceToBoundaryWad: prev?.distanceToBoundaryWad,
    boundaryProgressBps: prev?.boundaryProgressBps ?? 0,
    shareOfRIntBps: prev?.shareOfRIntBps ?? 0,
    crossCount: prev?.crossCount ?? 0n,
    lastCrossedAt: prev?.lastCrossedAt,
    createdAt: prev?.createdAt ?? BigInt(event.block.timestamp),
    createdBlock: prev?.createdBlock ?? BigInt(event.block.number),
    // `creator` is set on every Mint so a tick discovered by refreshState
    // before its log arrives does not keep the zero address.
    creator: event.params.recipient.toLowerCase(),
  });

  context.LiquidityEvent.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    pool_id: pool.id,
    tick_id: id,
    action: "MINT",
    account: event.params.recipient.toLowerCase(),
    rWad: event.params.rWad,
    kWad: event.params.kWad,
    amounts: [...event.params.amounts],
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });

  await refreshState(pool, event, context);
});

indexer.onEvent(
  { contract: "OrbitalHook", event: "Burn" },
  async ({ event, context }) => {
  const pool = await loadPool(event, context);
  const id = tickId(pool.id, event.params.tickIdx);
  await refreshState(pool, event, context);

  if (!(await context.Tick.get(id))) {
    context.log.warn(`Burn for unknown tick ${id}`);
    return;
  }

  context.LiquidityEvent.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    pool_id: pool.id,
    tick_id: id,
    action: "BURN",
    account: event.params.owner.toLowerCase(),
    rWad: event.params.rWad,
    kWad: undefined,
    amounts: [...event.params.amounts],
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
});

indexer.onEvent(
  { contract: "OrbitalHook", event: "Collect" },
  async ({ event, context }) => {
  const pool = await loadPool(event, context);
  const id = tickId(pool.id, event.params.tickIdx);
  await refreshState(pool, event, context);

  if (!(await context.Tick.get(id))) {
    context.log.warn(`Collect for unknown tick ${id}`);
    return;
  }

  context.LiquidityEvent.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    pool_id: pool.id,
    tick_id: id,
    action: "COLLECT",
    account: event.params.owner.toLowerCase(),
    rWad: 0n,
    kWad: undefined,
    amounts: [...event.params.fees],
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
});

indexer.onEvent(
  { contract: "OrbitalHook", event: "TickCrossed" },
  async ({ event, context }) => {
  const pool = await loadPool(event, context);
  const id = tickId(pool.id, event.params.tickIdx);

  const after = await refreshState(pool, event, context);

  const tick = await context.Tick.get(id);
  if (!tick) {
    context.log.warn(`TickCrossed for unknown tick ${id}`);
    return;
  }
  context.Tick.set({
    ...tick,
    crossCount: tick.crossCount + 1n,
    lastCrossedAt: BigInt(event.block.timestamp),
  });

  context.TickCross.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    pool_id: pool.id,
    tick_id: id,
    nowInterior: event.params.nowInterior,
    rIntAfter: after.rInt,
    // Recorded from state read AFTER the crossing, so this is the real answer
    // to "did this crossing freeze mint and burn for everyone", not a guess.
    causedFreeze: after.frozen,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });

  context.Pool.set({ ...after, crossCount: after.crossCount + 1n });
});
