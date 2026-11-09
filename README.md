<img src="frontend/public/orbital-mark.svg" width="80" height="80" alt="Orbital" />

# Orbital Hook

**One pool for every stablecoin.** A Uniswap v4 hook that replaces constant-product math with the Orbital sphere/torus curve, so USDC, USDT, DAI and FRAX all trade out of a single shared reserve book instead of six shallow pairs.

[**Live app**](https://orbital-hook.vercel.app/) · Aurora (NEAR) · Robinhood Chain · Base Sepolia · Arbitrum Sepolia · 205 tests

---

## On NEAR

Orbital's primary deployment is **Aurora**, the EVM that runs on NEAR. The hook
is Solidity, and NEAR itself runs Rust/WASM, so Aurora is how an N-asset
stablecoin book runs on NEAR at all.

| | |
|---|---|
| OrbitalHook | [`0xdb5b8f2078e28a50e1e9f068b9aa00c560702a88`](https://explorer.testnet.aurora.dev/address/0xdb5b8f2078e28a50e1e9f068b9aa00c560702a88) |
| Chain | Aurora testnet `1313161555` |
| Pool | USDC · USDT · DAI · FRAX, 1bp, 31 bands, $5M seeded |

Two integrations, both live:

**The pool itself.** Full Uniswap v4 core deployed to Aurora — PoolManager,
router, quoter, Permit2 — because none is canonical there. Addresses in
[`orbitalHook/README.md`](orbitalHook/README.md#aurora-testnet-1313161555).

**NEAR Intents, for arrival.** Orbital prices the swap; NEAR Intents prices the
journey. A trader holding USDT on Tron does not care what either leg costs, they
care what arrives. [`/app/arrive`](https://orbital-hook.vercel.app/app/arrive)
quotes both: Intents over 216 assets on 39 chains, then Orbital's own V4Quoter
on the Aurora pool.

```
1000 USDC on Arbitrum  ──Intents──►  999.80 USDC on NEAR   (25s)
                       ──Orbital──►  998.90 DAI on Aurora
                                     all-in ≈ 11 bps
```

Both numbers come from the systems that would execute them. Nothing is modelled
by the app.

**Intents quotes are `dry`.** They are priced by the same solver network as a
real route, but mint no deposit address and request no signature, so nothing in
the app can move funds. NEAR Intents has no testnet — mainnet with dry quotes is
the documented way to develop against it.

**The seam, stated plainly.** Intents settles to NEAR and to EVM mainnets, and
does not list Aurora as a destination. So the last hop from NEAR to the Aurora
pool is NEAR's own bridge and is not part of the Intents quote. The two legs are
quoted separately because they execute separately.

### Try it

No login, no keys, no allowlist. Everything below runs from a fresh clone —
nothing here depends on the hosted site being current.

**1. The Orbital quote. Zero setup — reads the live Aurora pool:**

```sh
cast call 0x1D49545CccDA551d5f5b2Ec95Fc53C34432016cF \
  'quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))(uint256,uint256)' \
  '((0x18c315d33339fd9604d80825ae770b5726a8f361,0x602e7b42515d3e93a04e176c09a24eaf9f617c88,0,1,0xdb5b8f2078e28a50e1e9f068b9aa00c560702a88),false,999000000,0x)' \
  --rpc-url https://testnet.aurora.dev
```

Expect roughly `998899829198497118768` — about 998.89 DAI out for 999 USDC in,
fee included.

**2. The NEAR Intents quote. Start the app, then ask it for a route:**

```sh
cd frontend && npm install && npm run dev
```

```sh
curl -s -X POST http://localhost:3000/api/intents \
  -H 'content-type: application/json' \
  -d '{"originAssetId":"nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
       "destinationAssetId":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
       "amount":"1000000000"}'
```

Expect `amountOut` near `999804440` (999.80 USDC) and a `timeEstimate` around
25 seconds. That is a live route priced by the NEAR Intents solver network, not
a fixture — `GET /api/intents` returns the 216 assets it can route across 39
chains.

**3. The contracts:**

```sh
cd orbitalHook && forge test        # 205 tests, including a two-chain fork suite
```

**4. In the browser**, at `http://localhost:3000`:

- `/app/arrive` — pick a chain and an asset, see both legs quoted and the
  all-in cost.
- `/app/swap` — connect any wallet, switch to Aurora testnet, take gas from the
  Aurora faucet, then mint test stablecoins. The mocks expose a public
  `mint(address,uint256)` with no owner check.
- Quote the same size on USDC/USDT and then on DAI/FRAX. They land within
  0.02 bps of each other, because they are the same book rather than two pools.
- Open an LP position and choose a depeg band — the bound your capital will
  quote down to before it stops trading.

The [hosted app](https://orbital-hook.vercel.app/) runs the same code, but may
lag this repository; the steps above are the authoritative ones.

Asset index order differs per chain, because the hook sorts by address. Resolve
by symbol, never by index.

### What is new, and what is not

Orbital predates this hackathon. The engine, the Orbital math libraries and the
Uniswap v4 integration were built earlier in 2026 and are baseline.

Built inside the hackathon window: the Aurora deployment and everything it
needed, the NEAR Intents integration (`frontend/app/api/intents/`,
`frontend/lib/intents/`, `frontend/lib/hooks/useIntentsQuote.ts`), the
`/app/arrive` page, and the cross-chain settler deployment. The repository
history separates the two.

Libraries used, per the entry rules: Uniswap v4 (core and periphery),
OpenZeppelin Contracts and uniswap-hooks, solmate, hookmate, Foundry and
forge-std on the contract side; Next.js, React, wagmi, viem and TanStack Query
on the frontend. The Orbital math libraries are mine and are baseline.

---

## The Orbital concept

Stablecoins all target $1, but AMMs make you choose. Curve holds many stablecoins together yet lays liquidity flatly along the whole curve. Uniswap v3 concentrates properly and then caps you at two tokens. Orbital ([Paradigm, 2025](https://www.paradigm.xyz/2025/06/orbital)) does both at once.

It comes down to the shape of the curve. Uniswap prices two tokens on a hyperbola; Orbital prices N tokens on a sphere:

$$x \cdot y = k \quad \longrightarrow \quad \|\mathbf{r} - \mathbf{x}\|^2 = \sum_{i=1}^{n}(r - x_i)^2 = r^2$$

| | |
|---|---|
| **Sphere** | The reserve vector $\mathbf{x} = (x_1, \dots, x_n)$ is a point on an N-sphere of radius $r$ centred at $\mathbf{r} = (r, \dots, r)$. The peg is the equal-price point $x_i = r(1 - 1/\sqrt{n})$, where every coin trades exactly 1:1. The curve only bends as the basket drifts off peg. |
| **Ticks** | Each LP picks a plane $\sum_i x_i = k$ cutting the sphere at a depeg bound, for example "provide liquidity only while the price holds above \$0.95". That is the concentration: capital sits where stablecoins actually trade. |
| **Torus** | Stacked ticks fold into a single torus the pool tracks with two running sums, $\sum x_i$ and $\sum x_i^2$. A swap stays O(1) however many coins or ticks exist. |

---

## What it gives you

<table>
<tr>
<td width="33%" valign="top">

### No fragmentation

Four stablecoins normally need **six separate pools**, each with its own shallow depth. Orbital keeps **one book**: a USDC/FRAX trade draws on exactly the same liquidity as USDC/USDT.

Adding a fifth coin adds a dimension, not a market.

</td>
<td width="33%" valign="top">

### Low slippage

Liquidity concentrates in the narrow band around $1 where dollars actually change hands, not spread across prices that never occur.

**0.99 bps** all-in on a $1k swap and **1.21 bps** on $100k, fee included, measured on the live $5M pool — and within 0.02 bps of that on all six pairs.

</td>
<td width="33%" valign="top">

### Deep liquidity

Depth compounds across the whole basket instead of splitting between pairs, and virtual reserves multiply what each real dollar does.

Up to **~154x** the effective depth of a flat pool at N=5, per the Orbital paper.

</td>
</tr>
<tr>
<td valign="top">

### Depeg isolation

Each LP sets the depeg they will hold. Cross it and that tick exits to the boundary and stops quoting, so a broken coin cannot drain the LPs who supplied the healthy ones.

This is the tail loss that wrecks flat stable pools.

</td>
<td valign="top">

### Real stablecoins

USDC and USDT are 6-decimal, DAI and FRAX are 18. The engine runs in WAD and converts only at the token boundary, rounding in the pool's favour every time.

Checked by a 128k-call solvency fuzz on a mixed-decimal pool.

</td>
<td valign="top">

### Travels well

Because one book holds every asset, any stablecoin is a single hop from any other. That makes the pool unusually cheap to fill against, which the ERC-7683 layer below builds on.

An extension, not the core.

</td>
</tr>
</table>

---

## What we built

We ported the full Orbital math from the paper (the N-sphere invariant, per-tick depeg planes, torus consolidation, and the tick-crossing solver) and run it inside a v4 hook. On every swap `beforeSwap` evaluates that engine and hands back the trade, so any pair prices on the Orbital curve instead of constant-product. It serves both halves of the v4 interface — the trader can fix what they pay or what they receive — so ordinary routers and quoters work against it. v4 still does custody, settlement and accounting.

A v4 pool is always exactly two tokens, so to fit four stablecoins into a single book we register the $\binom{4}{2} = 6$ pairs as six v4 pools and point every `PoolKey.hooks` at the same hook. Those pairs are only views. Behind all of them the hook keeps **one** shared reserve vector, so a trade on USDC/USDT and a trade on DAI/FRAX move the same reserves and the same price.

---

## Architecture

Six pairs are `PoolKey`s inside the one PoolManager, and every key's `hooks` field points at the same contract, [`OrbitalHook.sol`](orbitalHook/src/OrbitalHook.sol). The PoolManager holds the tokens and the lock; the hook holds the curve and the shared reserves.

![Orbital architecture: Trader/LP, the v4 PoolManager holding the 6 PoolKeys, and the OrbitalHook](frontend/public/archi.png)

- **PoolManager** is the v4 singleton. It owns the lock, custody of every real ERC-20, and the deferred-delta ("flash") accounting. The six `PoolKey`s are entries in this one contract, not separate deployments.
- **OrbitalHook** is our code. It holds the abstract state: the reserve vector $\mathbf{x}$, the ticks, accrued fees, and the soulbound LP shares it issues. It supplies the curve but never custodies real tokens.
- **Trader and LP.** A trader reaches the pool through any v4 router. An LP calls the hook directly (`addLiquidity`, `removeLiquidity`, `collect`) and the hook runs the `unlock` on their behalf.

### Token custody: two claim ledgers

This is the part that is easy to get wrong, so it is worth being precise. There are two separate claim ledgers and they mean different things.

1. **PoolManager claim tokens, held by the hook.** Real ERC-20s always sit in the PoolManager. When value flows in, the hook turns its positive balance-delta into PoolManager claim tokens (`poolManager.mint(address(this), ...)`), a redeemable IOU against the singleton's custody. To pay out it burns them and the PoolManager releases the underlying.
2. **OrbitalHook LP shares, held by the LP.** The hook keeps its own ERC-6909-shaped ledger with `tokenId = band`, one of a fixed menu of 31 depeg bands. Adding liquidity mints a share of that band's tick, and repeat deposits into a band grow the same position. These are soulbound and are how the hook tracks who owns what, alongside per-position fee checkpoints. No real token ever sits here.

All of it happens inside one `unlock` frame. Balances move only as deltas in transient storage, and `unlock` refuses to return until every currency delta nets to zero.

### LP path

```
LP ─► hook.addLiquidity(band, r, maxAmounts, deadline)
        └─ poolManager.unlock(MINT, ...)
             └─ unlockCallback (only callable by PoolManager):
                  • compute deposit amounts for radius r
                  • update reserves / sumX / sumXSq / rInt   (the torus)
                  • per asset: settle()  ← pull the LP's ERC-20 in
                               mint()    → convert +delta to claim tokens
                  • verify the balance actually landed  (TokenTransferShortfall)
                  • check the sphere invariant           (revert if broken)
                  • _mint(LP, band, rWad)                → issue the LP share
        unlock returns only once every delta == 0
```

`removeLiquidity` and `collect` run the same flow in reverse. Pausing never blocks either path, so LPs can always exit.

---

## Runtime: one swap

```
caller.unlock(data)
└─ PoolManager unlocks, calls back ────────────────┐
   unlockCallback(data):                           │  runs inside the lock
     swap(poolKey, params)                         │
       ├─ beforeSwap → Orbital BeforeSwapDelta     │  (default x·y math bypassed)
       └─ records currency deltas (no tokens move) │
     settle()  ← trader pays input
     take()    ← trader pulls output
└─ unlock returns ─────────────────────────────────┘
   PoolManager asserts every delta == 0  (else revert)
```

`beforeSwap` runs the Orbital engine and returns a `BeforeSwapDelta` that fully specifies the trade, so the PoolManager's default `x·y` math never executes. Two invariants hold throughout: `swap` moves no tokens, and `unlock` will not return until every delta is zero.

---

## How it compares

| Property | Uniswap v3 | Curve Stable | Balancer | **Orbital** |
|---|---|---|---|---|
| Assets per pool | 2 | 2 to 8 (fixed) | 2 to 8 (fixed) | **N (≥ 2)** |
| Concentrated liquidity | Yes | No | No | **Yes** |
| Per-LP depeg range | n/a | No | No | **Yes** |
| Depeg drains pool | n/a | Yes | Yes | **Isolated** |
| Capital efficiency at peg | High (pair) | ~1 to 2x flat | ~1 to 2x flat | **~154x flat, N=5** |
| Mixed decimals (6dp + 18dp) | Yes | Yes | Yes | **Yes** |
| Cross-chain settlement | No | No | No | **ERC-7683** (optional extension) |
| LP position type | NFT (721) | LP token | LP token | **soulbound 6909** |
| Venue | Standalone | Standalone | Standalone | **Uniswap v4 hook** |

---

## Extension: cross-chain settlement

Everything above is the hook. This part is built on top of it and is not required to use the pool.

[`OrbitalIntentSettler`](orbitalHook/src/crosschain/OrbitalIntentSettler.sol) implements [ERC-7683](https://eips.ethereum.org/EIPS/eip-7683), the cross-chain intents standard from Uniswap Labs and Across, settled over Hyperlane. It is covered by `OrbitalIntentSettler.t.sol`, `CrosschainSecurity.t.sol` and a fork suite that runs two live testnets at once against real Hyperlane Mailboxes.

> Settlers are deployed on Aurora, Base Sepolia and Arbitrum Sepolia, peered to each other, so those six routes are open. Robinhood Chain has no Hyperlane deployment and stays same-chain only. [`DeployCrosschain.s.sol`](orbitalHook/script/DeployCrosschain.s.sol) adds a settler to a chain with a Mailbox; `setPeer` registers the peers afterwards.

```
 user signs an intent            filler pays out                proof settles
 ──────────────────────          ────────────────               ─────────────
 escrow on origin        ──►     fill on destination     ──►    Hyperlane message
 (ERC-7683 open)                 routed through the             verified by handle(),
                                 local Orbital pool             escrow released
```

Two things make this work well with an N-asset book:

- **A filler needs inventory in only one asset per chain.** Because every stablecoin shares one book, any asset is a single hop from any other. A filler holding just USDC on Arbitrum can satisfy an order for DAI there. That collapses N x M inventory positions to 1 x M.
- **Settlement is cryptographic, not social.** The origin releases escrow only when its Hyperlane Mailbox delivers a message whose `(domain, sender)` matches a registered peer. There is no arbiter, no bond and no dispute game. The trust assumption is exactly Hyperlane's ISM for that route.

Funds are never stuck: if an order is not settled, the user reclaims the escrow after `fillDeadline + refundBuffer`.

---

## Deployments

Four live pools, one per EVM chain we target: Aurora testnet (primary), Robinhood Chain testnet, Base Sepolia and Arbitrum Sepolia. Each chain is a separate book with its own reserves.

Aurora is the EVM that runs on NEAR, which is why it is the primary deployment.

| Chain | Pool | Hook | Settler |
|---|---|---|---|
| **Aurora testnet** `1313161555` | USDC · USDT · DAI · FRAX | [`0xdb5b8f2078e28a50e1e9f068b9aa00c560702a88`](https://explorer.testnet.aurora.dev/address/0xdb5b8f2078e28a50e1e9f068b9aa00c560702a88) | `0x58D4…71b7` |
| Robinhood Chain testnet `46630` | USDC · USDT · DAI · FRAX | [`0xe2cE434ABB1F2a939fA017f69CD5f7c19c36Aa88`](https://explorer.testnet.chain.robinhood.com/address/0xe2cE434ABB1F2a939fA017f69CD5f7c19c36Aa88) | — no Hyperlane |
| Base Sepolia `84532` | USDC · USDT · DAI · FRAX | [`0xa1685261278e44C12921a0f213daDfBF9Beb6A88`](https://sepolia.basescan.org/address/0xa1685261278e44C12921a0f213daDfBF9Beb6A88) | `0x2D27…EF8E` |
| Arbitrum Sepolia `421614` | USDC · USDT · DAI · FRAX | [`0x3F09f9eCf71Cf78f346Eb2683D4a295D00e82A88`](https://sepolia.arbiscan.io/address/0x3F09f9eCf71Cf78f346Eb2683D4a295D00e82A88) | `0xd980…7627` |

Each pool uses a realistic decimal mix (USDC/USDT 6dp, DAI/FRAX 18dp) and is seeded with $5M of real capital on an eight-tier ladder: seven concentrated bands plus a small full-range backstop. The ladder's shape is not invented — it mirrors where LPs in the live Uniswap v3 USDC/USDT0 0.01% pool on Arbitrum actually place their capital, read tick by tick on-chain, so about two thirds of it sits within 5 bps of $1. Random retail swap flow runs on top, interleaved across the four chains, with each trade capped at $5,000.

Quoted on the live $5M pool, all-in including the 1 bp fee:

| Trade | $1k | $10k | $100k | $250k |
|---|---|---|---|---|
| All-in cost | 0.99 bps | 1.01 bps | 1.21 bps | 1.53 bps |

Every one of the six pairs quotes within 0.02 bps of that, because they share one book.

Token addresses, v4 infra (PoolManager, router, V4Quoter), Hyperlane Mailboxes and the peer registry all live in [`orbitalHook/deployments.json`](orbitalHook/deployments.json).

> **Asset index order differs per chain.** The hook sorts assets ascending by address, and addresses are unrelated across chains, so USDC is index 2 on Aurora, 1 on Robinhood, 0 on Base and 1 on Arbitrum. Always resolve by symbol, never by index.

- Live app: <https://orbital-hook.vercel.app/>
- Subgraph: one manifest, per-chain addresses in [`subgraph/networks.json`](subgraph/networks.json). The app reads pools, positions and quotes straight from the chain, and uses the index only for history.

---

## Repo layout

```
UHI/
├── orbitalHook/            Solidity
│   ├── src/OrbitalHook.sol         the v4 hook and Orbital engine
│   ├── src/libraries/              SphereMath, TorusMath, TickLib, QuadraticSolver, BandLib
│   ├── src/crosschain/             ERC-7683 settler + Hyperlane interfaces
│   ├── script/                     deploy and simulation scripts
│   │   ├── lib/TierLadder.sol          the liquidity ladder every deploy seeds
│   │   ├── Create2Factory.sol          CREATE2 deployer for chains without the canonical one
│   │   └── ReshapeLiquidity.s.sol      move a live pool onto the ladder in place
│   ├── FEEDBACK.md                 Uniswap v4 developer feedback
│   └── deployments.json            machine-readable address registry
├── subgraph/               The Graph: one manifest, per-chain networks
│   ├── schema.graphql              Pool, Asset, Tick, Swap, TickCross, PoolSnapshot
│   ├── src/mapping.ts              reproduces the engine's own crossing condition
│   └── networks.json               per-chain address + start block
└── frontend/               Next.js app: swap, pools, positions, transactions
    ├── lib/crosschain.ts           pool registry, from deployments.json
    └── lib/subgraph.ts             activity and volume, RPC scanning as fallback
```

---

## Walkthrough

<table>
<tr>
<td width="50%" valign="middle">

**Swap**

Trade any two of the four stablecoins from one shared pool at close to 1:1. Every pair routes through the same liquidity, and picking a token on another chain turns the same widget into a cross-chain order.

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

Pick a depeg threshold and your capital concentrates above it. A tighter range earns more fees; a wider range keeps earning through larger moves. Every LP sets their own.

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

Check the full breakdown (tokens, depeg threshold, fee tier, slippage) and confirm. It settles on-chain in one transaction as a soulbound position the hook issues against that band.

</td>
<td width="50%"><img src="frontend/public/screens/add-review.png" width="100%" alt="Add liquidity: review" /></td>
</tr>

<tr>
<td width="50%" valign="middle">

**Positions**

Manage everything in one place. Each band you hold is its own share that earns fees independently, and you can increase, decrease, collect, or burn it anytime — during a depeg too.

</td>
<td width="50%"><img src="frontend/public/screens/positions.png" width="100%" alt="Positions" /></td>
</tr>
</table>

---

## Testing

**205 tests across 18 suites.** The ones that carry the weight:

| Suite | What it proves |
|---|---|
| `Solvency.invariant.t.sol` | Stateful fuzz, **256 runs / 128k calls**, on two decimal profiles, with swaps fixed by input *and* by output and assets frozen and unfrozen mid-sequence. Real claim-token custody always covers reserves plus accrued fees plus any payout held back, and rounding only ever favours the pool. The mixed-decimal profile (6/6/18) is the one that actually exercises the scaling layer; an all-18 run leaves every conversion a no-op and proves nothing about it. |
| `MixedDecimalsLifecycle.t.sol` | Deterministic add → swap → collect → partial burn → full burn on a 6dp book, so every operation is asserted to *succeed*, not merely to not break. Also asserts a fee-on-transfer token is refused at the deposit boundary. |
| `OrbitalHook.t.sol` | 67 tests over the hook surface: constructor guards, hook permissions, bands and deadlines, LP entry and exit during a depeg, swaps, tick crossings, boundary behaviour, pause and ownership. |
| `IssuerFreeze.t.sol` | A paused stablecoin, a frozen LP and a frozen PoolManager: withdrawals and fee collection still pay every other asset, and the stuck one is held for its owner and claimable once the token moves again. |
| `VirtualLiquidity.t.sol` · `SolverRobustness.t.sol` | Concentrated deposits and withdrawals, depth per unit of capital, and swaps up to the edge of the book without breaking the solver. |
| Math libraries | `SphereMath`, `TorusMath`, `TickLib`, `QuadraticSolver`, including fuzzed solver residual and stability bounds. |

The cross-chain extension adds `OrbitalIntentSettler.t.sol`, `CrosschainSecurity.t.sol` and `CrosschainFork.t.sol`. The fork suite runs live forks of two testnets at once against real Hyperlane Mailboxes, with a forged-proof test asserting escrow does not move for a wrong `(domain, sender)`. The security suite asserts a fill cannot release escrow for an order it did not pay, and that a fill after its deadline earns no proof.

```bash
cd orbitalHook && forge test          # 205 tests
```

---

## Indexing and monitoring

[`subgraph/`](subgraph) is the Graph manifest for the activity feed and 24h
volume. No subgraph is currently deployed, so the app falls back to scanning
logs over RPC — pools, positions, quotes and swaps all read straight from the
chain, so everything works whether or not an index is live.

The point is not a dashboard. `TickCrossed` only fires *after* a depeg bound is hit,
so as a warning it arrives too late. Every handler therefore also reads live `slot0`
and `ticks` at its own block and reproduces the engine's crossing condition,

```
alphaNorm = ((sumX·WAD/√N) − kBound)·WAD / rInt      kNorm = k·WAD / r
```

storing how much slack each tick has left. That turns the feed into a leading
indicator: it shows which tick will cross first and how much of the book leaves
with it, before it happens.

---

## Getting started

```bash
git clone --recurse-submodules <repo>

cd orbitalHook
forge test                       # 205 tests

cd ../frontend
cp .env.example .env.local       # optional: dedicated RPC URLs
npm install && npm run dev       # http://localhost:3000
```

Foundry uses `via_ir = true`, required by the Orbital math libraries. If you cloned without submodules, run `git submodule update --init --recursive`.

---

## References

- Paradigm Orbital paper: <https://www.paradigm.xyz/2025/06/orbital>
- ERC-7683 cross-chain intents: <https://eips.ethereum.org/EIPS/eip-7683>
- Uniswap v4 docs: <https://docs.uniswap.org/contracts/v4/overview>
- Hyperlane docs: <https://docs.hyperlane.xyz>
