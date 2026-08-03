# Orbital Hook — engine

A Uniswap v4 hook implementing the Orbital N-asset stableswap from [Paradigm (2025)](https://www.paradigm.xyz/2025/06/orbital).

The hook ([`src/OrbitalHook.sol`](src/OrbitalHook.sol)) holds the abstract Orbital state (the sphere reserve vector, the LP ticks, the fees) and replaces Uniswap's swap curve inside `beforeSwap`. Token custody stays in v4's `PoolManager` — the hook only holds matching ERC-6909 claim tokens. Each of the $\tfrac{N(N-1)}{2}$ pairs among the registered assets is a separate v4 pool, all pointing at this one hook and sharing one engine state.

For the project overview and the frontend, see the [root README](../README.md).

---

## How the engine works

The hook keeps the pool as a point on an N-sphere and consolidates every LP tick into a single torus it can solve in O(1) per swap. A whole basket of stablecoins lives in one shared pool.

- **Sphere.** Reserves $\mathbf{x}$ satisfy $\|\mathbf{r} - \mathbf{x}\|^2 = r^2$, centred at $\mathbf{r} = (r, \dots, r)$. At the equal-price point $x_i = r\left(1 - \tfrac{1}{\sqrt{N}}\right)$ every coin trades 1:1; the curve only bends as the basket drifts off peg. ([`SphereMath.sol`](src/libraries/SphereMath.sol))
- **Ticks.** Each LP position is a plane $\sum_i x_i = k$ that cuts the sphere at a depeg bound — concentrated liquidity in the band near \$1. A tick stays *interior* while the pool holds above its bound and snaps to its *boundary* if price crosses it, so a depegging coin's tick exits without draining the rest. ([`TickLib.sol`](src/libraries/TickLib.sol))
- **Torus (`slot0`).** Instead of iterating ticks on every swap, the hook tracks five running sums — `sumX, sumXSq, rInt, kBound, sBound` — that fold all interior + boundary ticks into one torus. A swap reads and writes only these, so cost is independent of how many ticks or coins exist. ([`TorusMath.sol`](src/libraries/TorusMath.sol))
- **Segmenting solver.** `beforeSwap` walks the trade segment by segment: solve the within-tick quartic by Newton's method up to the next tick boundary, cross that tick (flip it interior↔boundary and update `slot0`), then continue until the input is consumed. The result is returned as a `BeforeSwapDelta`. ([`QuadraticSolver.sol`](src/libraries/QuadraticSolver.sol), in [`OrbitalHook.sol`](src/OrbitalHook.sol))

---

## Why it matters

- **No liquidity fragmentation.** A basket of stablecoins would normally need a separate pool per pair, each shallow. Here every pair is a view onto one shared reserve vector, so a USDC/FRAX trade taps the same depth as USDC/USDT.
- **Deep, shared liquidity.** All LP capital lands in one book instead of being split across pools — more depth behind every quote.
- **Capital efficiency via virtual reserves.** A tick removes the curve below its depeg bound, so a small amount of real capital behaves like a much larger reserve near peg (Uniswap v3's virtual-liquidity idea, generalized to the N-sphere).
- **Low slippage near peg.** Concentrating depth in the band where stablecoins actually trade keeps quotes close to 1:1 for ordinary size.
- **Depeg isolation.** When one coin breaks peg its tick snaps to the boundary and exits; the remaining coins keep trading 1:1 instead of the bad coin draining the pool.
- **O(1) regardless of scale.** The torus `slot0` means swap cost doesn't grow with the number of coins or ticks.

---

## Status

v1 — research artifact, not audited, not production. Working end-to-end (121 tests) and live on Monad testnet.

**Engine**
- [x] Asset registry — N tokens per pool, sorted, unique, immutable
- [x] Decimal scaling for ≤18-decimal tokens (6dp USDC/USDT supported; >18 rejected)
- [x] `beforeSwap` full segmenting solver (within-tick + tick crossings)
- [x] Per-tick fee growth + per-position checkpoints (v3-style)

**Liquidity**
- [x] `addLiquidity` — `unlock` → settle N tokens → mint ERC-6909
- [x] `addLiquidityViaPermit2` — signature-based LP deposit
- [x] `removeLiquidity` — `unlock` → take N tokens → burn ERC-6909
- [x] `collect` — per-asset accrued fees
- [x] Soulbound LP shares (`transfer` / `transferFrom` revert)
- [x] Native v4 `modifyLiquidity` blocked by `beforeAddLiquidity` / `beforeRemoveLiquidity`

**Safety & ops**
- [x] Admin pause — Ownable2Step + Pausable
- [x] Deploy + seed + simulation scripts; CREATE2-mined hook
- [x] Live + seeded on Monad testnet (121 tests passing)

**Deferred to v2**
- [ ] Exit during a depeg (burns are blocked while any tick is on boundary — symmetric with mints — pending per-tick reserve attribution; positions withdraw once the coin re-pegs and the tick recovers to interior)
- [ ] TWAP oracle
- [ ] Native ETH support
- [ ] ERC-721 positions (transferable)
- [ ] Protocol fee
- [ ] External audit + hook-level fuzzing

---

## Build & test

```bash
forge build
forge test          # 121 passing
```

`via_ir = true` (solc 0.8.30) is required — the `TorusMath` library hits stack-too-deep without it. We implemented the complete Orbital math from the paper — the sphere invariant, tick planes, torus consolidation, and the segmenting quartic solver. The same engine backs our standalone (non-v4) Orbital AMM; this hook adapts it to the v4 surface.

---

## Project layout

```
src/
├── OrbitalHook.sol          one contract: storage + v4 hook + LP entry + engine
└── libraries/               math (SphereMath, TorusMath, TickLib, QuadraticSolver)
    ├── FullMath.sol         512-bit mulDiv — full-precision intermediate products
    ├── SphereMath.sol       sphere invariant, radius, equal-price point
    ├── TorusMath.sol        folds all ticks into the torus running sums
    ├── TickLib.sol          tick = depeg-bound plane; kFromDepegPrice, kMin/kMax
    └── PositionLib.sol      LP position struct + fee-checkpoint accounting

test/
├── OrbitalHook.t.sol           constructor / hooks / LP / swap / crossing / admin
├── Solvency.invariant.t.sol    stateful invariant: pool never owes more than it holds
├── SphereMath.t.sol
├── TickLib.t.sol
├── TorusMath.t.sol
├── QuadraticSolver.t.sol       fuzzed solver residual / bounds / stability
└── Benchmark.t.sol             capital-efficiency / depth checks

script/
├── Deploy.s.sol             mock tokens → CREATE2-mined hook → 6 pools → tiered seed
├── DeployPeriphery.s.sol    v4 SwapRouter + Quoter against an existing PoolManager
└── SeedActivity.s.sol       exercises the live pool — swaps across pairs + adds a tick
```

---

## Hook permissions

The hook address is CREATE2-mined so its low bits encode these flags:

`beforeInitialize` · `beforeAddLiquidity` · `beforeRemoveLiquidity` · `beforeSwap` · `beforeSwapReturnDelta`

`beforeSwap` + `beforeSwapReturnDelta` is the pair that lets the hook return a `BeforeSwapDelta` that fully specifies the trade, so the PoolManager's default constant-product math is bypassed. The two `before*Liquidity` flags exist only to revert native v4 liquidity — the hook's own `addLiquidity` is the only LP path.

---

## Constructor

```solidity
constructor(
    IPoolManager poolManager,
    IAllowanceTransfer permit2,  // canonical Permit2, for the signature LP path
    Currency[] memory assets,    // N tokens, ascending by address, unique, ≤ 18 decimals
    uint24 fee,                  // hundredths of a bip (e.g. 100 = 1 bp)
    address admin                // Ownable2Step owner; can pause/unpause
)
```

After deployment, each pair `(assets[i], assets[j])` is registered as a v4 pool via `PoolManager.initialize` with `PoolKey.hooks = address(orbitalHook)` and `PoolKey.lpFee = 0`. Tokens with fewer than 18 decimals (e.g. 6dp USDC) are scaled to WAD internally; assets with more than 18 decimals revert at construction.

---

## LP interface

LPs call the hook directly (not the PoolManager):

```solidity
addLiquidity(uint256 kWad, uint256 rWad, uint256[] maxAmounts)           // → tickIdx, mints ERC-6909
addLiquidityViaPermit2(uint256 kWad, uint256 rWad, uint256[] maxAmounts) // same, Permit2-funded
removeLiquidity(uint256 tickIdx, uint256 rWad, uint256[] minAmounts)     // burns ERC-6909
collect(uint256 tickIdx)                                                 // → per-asset fees
```

`tokenId = tickIdx`; the hook is the ERC-6909 issuer. Shares are soulbound in v1 (`transfer` / `transferFrom` revert). Per-position fee checkpoints live in engine storage keyed by `(owner, tickIdx)`.

---

## Key design decisions

- **One contract, internal library code.** Engine logic is inlined as internal functions rather than a separate contract — no cross-contract overhead, and the deployed bytecode stays under the 24KB limit.
- **PoolManager holds tokens, hook holds claim tokens.** The hook tracks the abstract reserve vector $\mathbf{x}$; real ERC-20s sit in `PoolManager`, and the hook holds matching ERC-6909 claim tokens. Settlement uses the OZ `CurrencySettler` helper inside `unlock`.
- **Pair-view model.** $\tfrac{N(N-1)}{2}$ separate v4 `PoolKey`s all point at this hook; price coherence is guaranteed because every `beforeSwap` reads and writes the single shared engine state.
- **Native v4 liquidity disabled.** `beforeAddLiquidity` / `beforeRemoveLiquidity` revert; the hook's own `addLiquidity` is the only entry.
- **`via_ir = true`** — `TorusMath` hits stack-too-deep without it.

---

## Deploy

```bash
forge script script/Deploy.s.sol \
  --rpc-url monad_testnet --broadcast --slow \
  --private-key $PRIVATE_KEY
```

`Deploy.s.sol` mines the hook address (`HookMiner` from `lib/uniswap-hooks`), deploys the four mock tokens, initializes the 6 pair pools, and seeds tiered liquidity across depeg bounds 0.999 / 0.995 / 0.99 / 0.98. It resolves the `PoolManager` per chain: canonical v4 on Monad mainnet, the existing self-deployed instance on Monad testnet, and a fresh one on local anvil.

---

## Deployed — Monad testnet (chainId 10143)

Monad testnet has no canonical Uniswap v4, so the stack self-deploys a `PoolManager` (via hookmate) plus a v4 `SwapRouter` and `V4Quoter` pointed at it. On Monad mainnet the same script picks up the canonical v4 `PoolManager` instead.

| Contract | Address |
|---|---|
| OrbitalHook | [`0x63deB95aFa4EED08271831750059CD4e42e76A88`](https://testnet.monadscan.com/address/0x63deB95aFa4EED08271831750059CD4e42e76A88) |
| PoolManager (v4, self-deployed) | `0x9BEACCac4e0358Cc276703dcE7341B9B9fEfd5f7` |
| V4Quoter | `0x3f53c9ae1ae5D34D8A89986ea456da8e69916725` |
| SwapRouter (v4) | `0xC30819b8ac12B5d12751b83cFfebD6F0bFa0b53E` |
| Permit2 (canonical) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| USDC (mock) | `0xD69710c36246972e8e0543ACeb397209f75E8298` |
| USDT (mock) | `0x6ba8eD116B34AD23E8Ad936cf60A7BAa33F8FD1F` |
| DAI (mock) | `0xA105c458C0e88d88eE3C55B2cae711C13631d67e` |
| FRAX (mock) | `0x94B5be428FCC1000FdBbc556fE468310f556126d` |
| Admin / owner | `0xb29e1ddDfc73E00dEE3EaA7EA102990ADca78b39` |

Four mock 18-decimal stablecoins → 6 pair pools registered against the hook → tiered seed across 4 tiers (depeg bounds 0.999 / 0.995 / 0.99 / 0.98). Live state: **~$20M of real capital across 5 ticks, all interior, kBound = 0**, supporting an interior radius of **2.252e9** — about 154x what the same capital buys full-range. The hook address suffix `...6A88` encodes its permission flags (CREATE2-mined).
