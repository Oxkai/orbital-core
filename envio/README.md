# Orbital indexer (Envio HyperIndex)

Indexes the OrbitalHook deployment on Monad testnet (10143).

Replaces the Graph subgraph in `../subgraph` for Monad. Both answer the same
question — *how close is this book to a tick crossing, and what does that
cost?* — but each subgraph deployment pins one hook address, so a redeploy left
it indexing a retired contract while the app silently fell back to scanning
`eth_getLogs` backwards in 10,000-block windows.

## What it indexes

Five events: `Swap`, `Mint`, `Burn`, `Collect`, `TickCrossed`.

`TickCrossed` fires *after* a boundary is hit, so on its own it is a postmortem
rather than a warning. Every handler therefore also reads live engine state at
its own block and stores the slack beside the log:

- `Tick.distanceToBoundaryWad` — signed slack, `kNorm - alphaNorm`. Crosses at zero.
- `Tick.boundaryProgressBps` — 0 at parity, 10000 at the crossing, normalised by
  each tick's own span so a 0.97 band and a 0.80 band are comparable.
- `PoolSnapshot` — one row per event, carrying `maxBoundaryProgressBps` and
  `nearestTick`, so the trend is queryable rather than just the latest reading.

The normalised projection is reproduced from the engine rather than
approximated, because `sqrtN` is `internal immutable` in the hook and so not
callable:

```
sqrtN     = sqrt(N * WAD^2)
alphaTot  = sumX * WAD / sqrtN
alphaInt  = max(alphaTot - kBound, 0)
alphaNorm = alphaInt * WAD / rInt
```

## Contract reads

Two cached effects in `src/effects.ts`, not one per call:

- `poolConfig`, keyed by hook alone — `N`, asset addresses, decimals and scales
  are immutable in the hook, so this runs once per deployment.
- `engineState`, keyed by hook **and block** — which is what makes caching sound:
  the same block always has the same state, so a restart or re-index replays
  from cache instead of re-reading the chain.

Reads batch through multicall3 at the canonical address, which is deployed on
Monad testnet.

## Running it

Needs Postgres. Envio's own `envio dev` provisions one through Docker; with an
existing local Postgres, point `.env` at it and use `envio start`:

```
ENVIO_PG_HOST=localhost
ENVIO_PG_PORT=5432
ENVIO_PG_USER=<user>
ENVIO_PG_DATABASE=envio_orbital
ENVIO_PG_SSL_MODE=false
ENVIO_HASURA=false
```

```sh
pnpm install
pnpm codegen
pnpm start
```

Monad's public RPC answers `eth_getLogs is limited to a 100 range`, so
`config.yaml` pins `initial_block_interval` and `interval_ceiling` to 100.
Without that the indexer probes wider ranges and backs off through four failed
retries on every partition.

The `rpc` block deliberately omits `for:`. Left out, it defaults to `fallback`
wherever HyperSync covers the chain, so HyperSync leads and this RPC backs it
up. HyperSync needs an `ENVIO_API_TOKEN`, which Envio Cloud supplies to its own
deployments; running locally, put a token from envio.dev/app/api-tokens in
`.env`, or pin `for: sync` to stay on RPC alone.

## Hosted endpoint

```
https://indexer.dev.hyperindex.xyz/42f7655/v1/graphql
```

Public, no key. Running on Envio Cloud against HyperSync, synced to the head of
Monad testnet.

```sh
curl -s -X POST https://indexer.dev.hyperindex.xyz/42f7655/v1/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Pool { swapCount volumeWad feesWad sumX rInt frozen } }"}'
```

## Verified against the chain

The pool is live, so these figures move. What does not move is that they agree:
every value the indexer reports is derived independently of the one the hook
holds, and the two match to the wei. Checked at 27 swaps:

| | On-chain | Indexed |
|---|---|---|
| `sumX` | 18472534689490746698693839714 | 18472534689490746698693839714 |
| `rInt` | 9236267344745131856792855798 | 9236267344745131856792855798 |
| fees, summed over 4 assets | 1.056735 | 1.056735 |

The fee figure is the useful check: the indexer derives it from
`volume * feeBps / 1e6` while the hook accrues it per asset independently.

To re-run the comparison at whatever the current state is:

```sh
cast call 0x2Db3289884D575A7b49374F28d738DBF2dc42a88 \
  'slot0()(uint256,uint256,uint256,uint256,uint256)' \
  --rpc-url https://testnet-rpc.monad.xyz
```

The first value is `sumX` and the third is `rInt`; compare against the query
above.

Entities after the initial backfill: 1 Pool, 4 Asset, 8 Tick, 27 Swap,
1 LiquidityEvent, 0 TickCross — no band has crossed, which is what a basket of
healthy pegs should look like.

## GraphQL

The query layer is Hasura, which Envio provisions through Docker
(`ENVIO_HASURA=true`). On a machine without Docker the indexer still runs and
writes to Postgres, but serves only health and metrics on `:9898`; query
Postgres directly, or host the indexer on Envio Cloud for a hosted endpoint.

The deployment above is hosted on Envio Cloud, which is git-based through
envio.dev/app rather than the CLI (which has no auth or deploy commands).
Connect the repository, add an indexer with root directory `envio` and config
file `config.yaml`, and push to the deployment branch.

Note for anything consuming this: Envio's GraphQL is Hasura-flavoured
(`Pool(where: ...)`), not Graph-flavoured (`pools(where: ...)`), so the
frontend's existing subgraph queries in `../frontend/lib/subgraph.ts` need a
Hasura variant rather than a change of URL.
