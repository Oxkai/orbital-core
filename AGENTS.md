# Notes for a reviewing agent

Orbital is a Uniswap v4 hook that replaces constant-product math with the
Orbital sphere/torus curve, so N stablecoins trade out of one shared reserve
book instead of N(N−1)/2 shallow pairs. This file is the shortest path to
checking that claim, and to seeing what is and is not true of the NEAR work.

Everything below is a command and the output to expect. Nothing here needs an
account, a key, or an allowlist.

## Cloning

The default branch carries all of this; `near-intents` is the same commit. A
plain clone is the right tree:

```sh
git clone --recurse-submodules https://github.com/Oxkai/orbital-core.git
```

The submodules matter: `forge-std`, `uniswap-hooks` and `hookmate` are git
submodules, and `forge test` cannot compile without them. A clone without
`--recurse-submodules` is repaired with
`git submodule update --init --recursive`.

## Three checks, in order of what they prove

### 1. The pool is live on Aurora — no setup, ~5 seconds

This reads the deployed V4Quoter on Aurora testnet. It needs only `cast`
(Foundry) and a network connection; nothing in this repository has to build.

```sh
cast call 0x1D49545CccDA551d5f5b2Ec95Fc53C34432016cF \
  'quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))(uint256,uint256)' \
  '((0x18c315d33339fd9604d80825ae770b5726a8f361,0x602e7b42515d3e93a04e176c09a24eaf9f617c88,0,1,0xdb5b8f2078e28a50e1e9f068b9aa00c560702a88),false,999000000,0x)' \
  --rpc-url https://testnet.aurora.dev
```

Expect `998899829198497118768` — 998.899… DAI out for 999 USDC in, which is the
1bp fee and nothing else. A different figure in the last few digits is ordinary
pool drift; a revert is a real failure.

### 2. NEAR Intents is a live integration — ~30 seconds

```sh
cd frontend && npm install && npm run dev
```

then, in another shell:

```sh
curl -s -X POST http://localhost:3000/api/intents \
  -H 'content-type: application/json' \
  -d '{"originAssetId":"nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
       "destinationAssetId":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
       "amount":"1000000000"}'
```

Expect `amountOut` near `999800000` and `timeEstimate` around `25`. The exact
figure moves — it is priced by NEAR's solver network in real time, not a
fixture. `GET /api/intents` returns the full routable asset list, 230-odd
assets across 39 chains.

Both legs together are at `http://localhost:3000/app/swap?tab=arrive`, which quotes the
Intents journey and the Orbital swap and adds them into one all-in cost.

### 3. The engine is correct — ~4 minutes

```sh
cd orbitalHook && forge test
```

Expect **205 passed, 0 failed** across 18 suites. `via_ir = true` is required by
the math libraries, so the first compile is slow.

## What this project claims, and where to check each claim

| Claim | Where it is checked |
|---|---|
| N stablecoins, one shared book | `forge test`, `OrbitalHookTest` |
| ~1bp on every pair | check 1 above, any pair |
| A depegging asset is isolated, not drained | `SolvencyInvariantAll18`, `SolvencyInvariantMixedDecimals` |
| Mixed 6dp and 18dp assets | `MixedDecimalsLifecycleTest` |
| Deployed on Aurora, NEAR's EVM | check 1; addresses in `orbitalHook/deployments.json` |
| NEAR Intents prices the journey | check 2 |
| Cross-chain settlement over Hyperlane | `OrbitalIntentSettler.t.sol`, `CrosschainFork.t.sol` |

## What is deliberately not true

State these as findings if you are scoring the project; they are not oversights
and the README says so too.

- **No NEAR Intents transaction exists.** Every quote the app requests is
  `dry`: it mints no deposit address and asks for no signature, so the app
  cannot move anyone's funds. NEAR Intents has no testnet, and this deployment
  is testnet throughout. The quote is real; settlement is deliberately absent.
- **Intents does not reach Aurora.** It settles to NEAR and to EVM mainnets and
  does not list Aurora as a destination, so the final NEAR → Aurora hop is
  NEAR's own bridge and is outside the Intents quote. The app shows the two
  legs separately for this reason.
- **The Orbital side does have executed transactions.** Twelve swaps have
  settled in the Aurora pool; four are linked from the README.
- **The pools are testnet.** Aurora testnet (`1313161555`) is primary; Monad
  testnet, Arbitrum Sepolia, Base Sepolia and Robinhood Chain testnet carry the
  same hook. Each holds $5M and quotes every pair within ~1bp.
- **An admin can pause.** The hook and the settler are `Ownable2Step, Pausable`.
  Pausing stops swaps and deposits — but `removeLiquidity` and `collect` are
  deliberately *not* pausable, so no one can trap an LP's funds.

## Baseline versus hackathon work

Orbital predates this hackathon. The split is tagged, not asserted:

```sh
git log --oneline pre-hackathon..hackathon-submission
```

`pre-hackathon` is the baseline, last touched 2026-10-14. Everything after it is
dated 2026-11-09 or later: the Aurora deployment, the NEAR Intents integration
(`frontend/app/api/intents/`, `frontend/lib/intents/`,
`frontend/lib/hooks/useIntentsQuote.ts`), the arrival panel, and the settler
deployment.

## Where things live

```
orbitalHook/src/OrbitalHook.sol            the hook
orbitalHook/src/libraries/                 sphere, torus, tick and band math
orbitalHook/src/crosschain/                ERC-7683 settler, Hyperlane transport
orbitalHook/deployments.json               every address, per chain
frontend/app/api/intents/route.ts          the NEAR Intents proxy, dry quotes only
frontend/lib/hooks/useIntentsQuote.ts      the quote hook
frontend/components/app/arrive/            the two-leg arrival panel
subgraph/                                  indexes the hook on Arbitrum and Ethereum
```
