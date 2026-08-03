<img src="frontend/public/logo.svg" width="76" height="76" alt="Orbital logo" />

# Orbital Hook

A Uniswap v4 hook that turns a single pool into an N-asset stablecoin AMM. All the stablecoins (USDC, USDT, DAI, FRAX) share one reserve book inside the hook, which swaps them on the Orbital sphere/torus curve instead of Uniswap's constant-product math. The result is concentrated liquidity for a whole basket of dollars, running on top of v4.

> **Impermanent loss and yield.** Orbital is built to reduce impermanent loss for stablecoin LPs. Liquidity concentrated near the peg keeps IL close to zero while earning more fees per dollar, and if a coin breaks its peg the pool fences it off automatically, capping the tail loss that drains Curve-style stable LPs.

Live on **Monad testnet** (chainId 10143) · 121 tests passing

**App → <https://orbital-hook.vercel.app/>**  ·  **Hook → [`0x63deB95a…6A88`](https://testnet.monadscan.com/address/0x63deB95aFa4EED08271831750059CD4e42e76A88)**

> **Provenance.** The core hook and math libraries were originally built by us for UHI9 ([Oxkai/Orbital.Hook](https://github.com/Oxkai/Orbital.Hook), May to June 2026). This repo is the Monad line of work: chain-aware deployment, the live Monad testnet stack, and everything that follows.

---

## The Orbital concept (Paradigm)

Stablecoins all target $1, but AMMs make you choose. Curve holds many stablecoins together yet spreads liquidity flatly across the whole curve. Uniswap v3 concentrates liquidity but only for two tokens. Orbital ([Paradigm, 2025](https://www.paradigm.xyz/2025/06/orbital)) does both at once.

It comes down to the shape of the curve. Uniswap prices two tokens on a hyperbola; Orbital prices N tokens on a sphere:

$$x \cdot y = k \quad \longrightarrow \quad \|\mathbf{r} - \mathbf{x}\|^2 = \sum_{i=1}^{n}(r - x_i)^2 = r^2$$

- **Sphere.** The reserve vector $\mathbf{x} = (x_1, \dots, x_n)$ is a point on an N-sphere of radius $r$ centred at $\mathbf{r} = (r, \dots, r)$. The peg is the equal-price point $x_i = r\left(1 - \tfrac{1}{\sqrt{n}}\right)$, where every coin trades exactly 1:1. The curve only starts to bend as the basket drifts off peg.
- **Ticks.** Each LP picks a plane $\sum_i x_i = k$ that cuts the sphere at a depeg bound, for example "provide liquidity only while the price holds above \$0.95". This is the concentration: capital sits in the narrow band near peg where stablecoins actually trade, rather than being spread across prices that never happen.
- **Torus.** Stacked ticks fold into a single torus that the pool tracks with two running sums, $\sum x_i$ and $\sum x_i^2$. A swap stays O(1) however many coins or ticks exist.

That combination is the whole point, and it lines up directly with the hackathon theme: **less impermanent loss for stablecoin LPs.** Many stablecoins sit in one capital-efficient pool, and depeg isolation handles the tail risk. When one coin breaks peg its tick exits to the boundary and the rest keep trading 1:1, so a single broken coin can't drain the LPs who supplied the others.

---

## What we built

We ported the full Orbital math from the paper (the N-sphere invariant, the per-tick depeg planes, the torus consolidation, and the quartic tick-crossing solver) and run it inside a v4 hook. On every swap, `beforeSwap` evaluates that engine and hands back the trade, so any pair prices on the Orbital curve instead of constant-product. v4 still does the custody, settlement, and accounting.

There is one catch: a v4 pool is always exactly two tokens. To fit four stablecoins into a single book, we register the $\binom{4}{2} = 6$ pairs as six separate v4 pools and point every `PoolKey.hooks` at the same hook. Those pairs are only views; behind all of them the hook keeps one shared reserve vector. A trade on USDC/USDT and a trade on DAI/FRAX move the same reserves and the same price.

---

## Architecture

The six pairs are `PoolKey`s that live inside the one PoolManager, and every key's `hooks` field points at the same contract, [`OrbitalHook.sol`](orbitalHook/src/OrbitalHook.sol). The PoolManager holds all the tokens and the lock; the hook holds the curve and the shared reserves.

![Orbital architecture: Trader/LP, the v4 PoolManager holding the 6 PoolKeys, and the OrbitalHook](frontend/public/archi.png)

**Three actors:**

- **PoolManager** is the v4 singleton. It owns the lock, custody of every real ERC-20, and the deferred-delta ("flash") accounting. The six `PoolKey`s are entries in this one contract, not separate deployments.
- **OrbitalHook** is our code. It holds the abstract state: the reserve vector $\mathbf{x}$ (the sphere), the ticks, the accrued fees, and the ERC-6909 LP shares it issues. It provides the curve and the LP entry points, but it never custodies real tokens.
- **Trader and LP.** A trader reaches the pool through any v4 router (`unlock`, then `swap`). An LP calls the hook directly (`addLiquidity`, `removeLiquidity`, `collect`), and the hook runs the `unlock` on their behalf.

### Token custody: flash accounting and two claim ledgers

This is the part that's easy to get wrong, so it's worth being precise. There are two separate ERC-6909 ledgers, and they mean different things.

1. **PoolManager claim tokens, held by the hook.** Real ERC-20s always sit in the PoolManager. When value flows into the pool, the hook turns its positive balance-delta into PoolManager *claim tokens* (`poolManager.mint(address(this), …)`), a redeemable IOU against the singleton's custody. So the hook's "ownership" of the pooled liquidity is just a claim-token balance; it never holds raw ERC-20. To pay value out it burns those claim tokens (`settle(..., claims=true)`) and the PoolManager releases the underlying to the recipient (`take(..., claims=false)`).
2. **OrbitalHook LP shares, held by the LP.** The hook is also an ERC-6909 in its own right, with `tokenId = tickIdx`. Adding liquidity mints you a share of your tick (`_mint(you, tickIdx, rWad)`). These shares are soulbound in v1 (`transfer` and `transferFrom` revert) and are how the hook tracks who owns what, along with per-position fee checkpoints.

All of this happens inside a single `unlock` frame. The PoolManager hands control to the callback, balances move only as deltas in transient storage, and `unlock` refuses to return until every currency delta nets to zero. No tokens move until the books balance.

### LP path: `addLiquidity`

```
LP ─► hook.addLiquidity(k, r, maxAmounts)         (LP calls the hook, not the PoolManager)
        └─ poolManager.unlock(MINT, …)
             └─ unlockCallback (only callable by PoolManager):
                  • deposit = xBase(r) − xMin(r, k)     (real, what the LP pays)
                    credit  = xBase(r)                  (virtual, what the curve sees)
                  • reserves += deposit ; virtualOffset += xMin
                  • update sumX / sumXSq / rInt from the credit  (the torus)
                  • for each asset:
                       settle()  ← pull the LP's ERC-20 into the PoolManager
                       mint()    → convert the +delta into claim tokens held by the hook
                  • check the sphere invariant (revert if broken)
                  • _mint(LP, tickIdx, rWad)   → issue the ERC-6909 LP share
        unlock returns only once every delta == 0
```

`removeLiquidity` and `collect` run the same flow in reverse. `take(..., claims=false)` sends real ERC-20 out of the PoolManager to the LP, the hook burns the matching claim tokens with `settle(..., claims=true)`, and the LP's shares are burned (for `collect`, only the accrued fees are paid). Pausing the pool never blocks either path, so LPs can always exit.

---

## Runtime: one swap

A trader never calls `swap` directly. A router calls `unlock`, the PoolManager calls back, and the swap plus settlement happen inside that locked frame. No tokens move until the deltas net to zero.

```
caller.unlock(data)
└─ PoolManager unlocks, calls back ────────────────┐
   unlockCallback(data):                           │  runs inside the lock
     swap(poolKey, params)                         │
       ├─ beforeSwap → Orbital BeforeSwapDelta      │  (default x·y math bypassed)
       └─ records currency deltas (no tokens move) │
     settle()  ← trader pays input  (hook takes it as claim tokens)
     take()    ← trader pulls output (hook burns claim tokens to cover it)
└─ unlock returns ─────────────────────────────────┘
   PoolManager asserts every delta == 0  (else revert)
```

Inside `beforeSwap` the hook runs the Orbital engine and returns a `BeforeSwapDelta` that fully specifies the trade, so the PoolManager's default `x·y` math is bypassed. It takes the trader's input as claim tokens and burns claim tokens to release the output. Two invariants hold the whole time: `swap` moves no tokens (it only writes deltas to transient storage), and `unlock` won't return until every currency delta is zero.

---

## Why it matters

- **No liquidity fragmentation.** Four stablecoins would normally need six separate pools, each with its own shallow depth. Here the six pairs share one book, so a USDC/FRAX trade draws on the same liquidity as USDC/USDT. One deep pool instead of six thin ones.
- **Capital efficiency from virtual reserves.** A tick removes the curve below its depeg bound, so a small amount of real capital behaves like a much larger reserve near peg. It is Uniswap v3's virtual liquidity, generalized to the N-sphere.
- **N coins, not 2.** A single pool prices a whole basket of dollars off one sphere, so you can add another stablecoin without standing up a new market.
- **Depeg isolation contains impermanent loss.** When a coin breaks peg, its tick exits to the boundary and the rest keep trading 1:1, so the broken coin doesn't drain the pool. This is exactly the tail IL that wrecks flat stable LPs, where a depeg dumps the whole pool into the broken coin. Orbital caps it by construction.
- **Built on v4, not beside it.** The hook only supplies the curve; custody, accounting, and the unlock/settle flow are all v4's, so the pools are reachable by any v4 router or aggregator.

---

## How it compares

| Property | Uniswap V3 | Curve Stable | Balancer | Orbital |
|---|---|---|---|---|
| Assets per pool | 2 | 2–8 (fixed) | 2–8 (fixed) | N (≥ 2) |
| Concentrated liquidity | Yes | No | No | Yes |
| Per-LP depeg range | n/a | No | No | Yes |
| Depeg drains pool | n/a | Yes | Yes | Isolated |
| Capital efficiency at peg | High (pair) | ~1–2× flat | ~1–2× flat | ~154× flat, N=5 |
| TWAP oracle | Yes | No | Yes | Roadmap |
| LP position type | NFT (721) | LP token | LP token | ERC-6909 |
| Venue | Standalone | Standalone | Standalone | Uniswap v4 hook |

---

## Walkthrough

<table>
<tr>
<td width="50%" valign="middle">

**Swap**

Trade any two of the four stablecoins from one shared pool at close to 1:1. Every pair routes through the same liquidity, and if one coin depegs the rest keep trading while the bad leg is fenced off.

</td>
<td width="50%"><img src="frontend/public/screens/swap.png" width="100%" alt="Swap" /></td>
</tr>

<tr>
<td width="50%" valign="middle">

**Pools**

All four stablecoins live in a single shared book. Every pair is a view onto the same reserves, so liquidity never fragments and depth compounds across the whole basket.

</td>
<td width="50%"><img src="frontend/public/screens/pools.png" width="100%" alt="Pools" /></td>
</tr>

<tr>
<td width="50%" valign="middle">

**Liquidity depth**

Depth concentrates against the $1 peg where stablecoins actually trade, instead of spreading flat across prices that never happen. That concentration is where the capital efficiency comes from.

</td>
<td width="50%"><img src="frontend/public/screens/pool-depth.png" width="100%" alt="Liquidity depth chart" /></td>
</tr>

<tr>
<td width="50%" valign="middle">

**Add liquidity: range**

Pick a depeg threshold and your capital concentrates above it. A tighter range earns more fees but pauses sooner if a coin depegs; a wider range is a safer backstop. Every LP sets their own.

</td>
<td width="50%"><img src="frontend/public/screens/add-range.png" width="100%" alt="Add liquidity: range" /></td>
</tr>

<tr>
<td width="50%" valign="middle">

**Add liquidity: amount**

Your deposit splits across all four tokens at the current pool ratio, so you take balanced exposure to the whole basket in one step, with no rebalancing across pairs.

</td>
<td width="50%"><img src="frontend/public/screens/add-amount.png" width="100%" alt="Add liquidity: amount" /></td>
</tr>

<tr>
<td width="50%" valign="middle">

**Add liquidity: review**

Check the full breakdown (tokens, depeg threshold, fee tier, slippage) and confirm. It settles on-chain in one transaction as an ERC-6909 position the hook issues against your tick.

</td>
<td width="50%"><img src="frontend/public/screens/add-review.png" width="100%" alt="Add liquidity: review" /></td>
</tr>

<tr>
<td width="50%" valign="middle">

**Positions**

Manage everything in one place. Each tick you hold is its own ERC-6909 share that earns fees independently, and you can increase, decrease, collect, or burn it anytime.

</td>
<td width="50%"><img src="frontend/public/screens/positions.png" width="100%" alt="Positions" /></td>
</tr>
</table>

---

## Repo layout

```
UHI/
├── orbitalHook/        Solidity: the v4 hook (see orbitalHook/README.md)
└── frontend/           Next.js app: swap, pools, positions, sim (see frontend/README.md)
```

---

## Deployed on Monad testnet (chainId 10143)

Monad has no canonical Uniswap v4 deployment yet, so the script deploys its own `PoolManager` via hookmate and registers the six pair pools against it. On Monad mainnet (chainId 143) the same script picks up the canonical v4 `PoolManager` at `0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e` instead.

**Network**

| | |
|---|---|
| Chain ID | `10143` |
| RPC | <https://testnet-rpc.monad.xyz> |
| Explorer | <https://testnet.monadscan.com> |
| Currency | MON |
| Faucet | <https://faucet.monad.xyz> |

**Contracts** — every address links to MonadScan.

| Contract | Address |
|---|---|
| [OrbitalHook](orbitalHook/src/OrbitalHook.sol) | [`0x63deB95aFa4EED08271831750059CD4e42e76A88`](https://testnet.monadscan.com/address/0x63deB95aFa4EED08271831750059CD4e42e76A88) |
| PoolManager (v4, self-deployed) | [`0x9BEACCac4e0358Cc276703dcE7341B9B9fEfd5f7`](https://testnet.monadscan.com/address/0x9BEACCac4e0358Cc276703dcE7341B9B9fEfd5f7) |
| SwapRouter (v4Router04) | [`0xC30819b8ac12B5d12751b83cFfebD6F0bFa0b53E`](https://testnet.monadscan.com/address/0xC30819b8ac12B5d12751b83cFfebD6F0bFa0b53E) |
| V4Quoter | [`0x3f53c9ae1ae5D34D8A89986ea456da8e69916725`](https://testnet.monadscan.com/address/0x3f53c9ae1ae5D34D8A89986ea456da8e69916725) |
| Permit2 (canonical) | [`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://testnet.monadscan.com/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |
| USDC (mock) | [`0xD69710c36246972e8e0543ACeb397209f75E8298`](https://testnet.monadscan.com/address/0xD69710c36246972e8e0543ACeb397209f75E8298) |
| USDT (mock) | [`0x6ba8eD116B34AD23E8Ad936cf60A7BAa33F8FD1F`](https://testnet.monadscan.com/address/0x6ba8eD116B34AD23E8Ad936cf60A7BAa33F8FD1F) |
| DAI (mock) | [`0xA105c458C0e88d88eE3C55B2cae711C13631d67e`](https://testnet.monadscan.com/address/0xA105c458C0e88d88eE3C55B2cae711C13631d67e) |
| FRAX (mock) | [`0x94B5be428FCC1000FdBbc556fE468310f556126d`](https://testnet.monadscan.com/address/0x94B5be428FCC1000FdBbc556fE468310f556126d) |
| Admin / owner | [`0xb29e1ddDfc73E00dEE3EaA7EA102990ADca78b39`](https://testnet.monadscan.com/address/0xb29e1ddDfc73E00dEE3EaA7EA102990ADca78b39) |

Seeded with **~$20M of real capital** at depeg bounds 0.999 / 0.995 / 0.99 / 0.98, then exercised by [`SeedActivity.s.sol`](orbitalHook/script/SeedActivity.s.sol), which runs a swap wave and adds a fifth tick. Live state: **5 ticks, all interior (`kBound = 0`)**, interior radius **2.252e9** against ~5.08M of real reserves per asset — a `virtualOffset` of ~1.12e9 per asset carries the difference. That is roughly **154x** what the same capital would buy full-range.

### Measured slippage (live, via V4Quoter)

| swap in | slippage | full-range equivalent |
|---|---|---|
| 1,000 | 0.0100% | 0.020% |
| 10,000 | 0.0104% | 0.200% |
| 100,000 | **0.0145%** | 1.961% |
| 1,000,000 | **0.0545%** | 16.667% |

The 0.0100% floor is the 1bp pool fee. Pure price impact on a $100k swap is 0.0045%.

**How the concentration works.** An LP funds only `xBase - xMin`: the reserves between the equal-price point and the level where their tick hits its depeg bound. The curve is credited the full `xBase`, and `virtualOffset` carries the difference. The unfunded portion is never callable, because the tick crosses to boundary at `xMin` and stops trading — the same virtual-reserve argument behind Uniswap v3. `reserves[]` remains the real, custodied balance, so pool solvency is unaffected. All six pair pools (`USDC/USDT`, `USDC/DAI`, `USDC/FRAX`, `USDT/DAI`, `USDT/FRAX`, `DAI/FRAX`) share the one engine state.

Redeploy with:

```bash
cd orbitalHook
forge script script/Deploy.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast --slow
```

---

## Getting started

```bash
# Contracts
cd orbitalHook
forge test                       # 121 passing

# Frontend
cd frontend
npm install && npm run dev       # http://localhost:3000
```

Foundry uses `via_ir = true` (required by the Orbital math libraries). Clone with `--recurse-submodules`, or run `git submodule update --init --recursive` afterwards.

---

## References

- Paradigm Orbital paper: <https://www.paradigm.xyz/2025/06/orbital>
- Uniswap v4 docs: <https://docs.uniswap.org/contracts/v4/overview>
- Original UHI9 build of the hook and math libraries: <https://github.com/Oxkai/Orbital.Hook>
