# Orbital — Frontend

The web app for **Orbital**, an N-asset stableswap built as a **Uniswap v4 hook**, deployed on **Monad testnet (chainId 10143)**. Swap, provide liquidity, and inspect the live pool — wired directly to the on-chain hook.

**Live → https://orbital-hook.vercel.app/**  ·  Hook [`0x63deB95a…6A88`](https://testnet.monadscan.com/address/0x63deB95aFa4EED08271831750059CD4e42e76A88)

Contracts live in [`../orbitalHook`](../orbitalHook). The deployed addresses the app talks to are in [`lib/contracts.ts`](lib/contracts.ts).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| Chain | wagmi 3 + viem 2 (Monad testnet) |
| Styling | Tailwind CSS 4 + inline design tokens |
| Math | KaTeX |
| Charts / 3D | Recharts · three.js |
| Fonts | Roboto · Geist Mono |

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

Connect a wallet on **Monad testnet (10143)**. Get test MON from <https://faucet.monad.xyz>. The Nav prompts a network switch if you're on the wrong chain.

## Environment

| Var | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | optional | Private Monad RPC. Falls back to the public `https://testnet-rpc.monad.xyz`. |

Copy `.env.example` → `.env.local` and fill in if you have one.

## Deploy on Vercel

Deploy this folder as its own Vercel project:

1. **Import** the `Oxkai/orbital-core` repo into Vercel.
2. Set **Root Directory** to `frontend`.
3. Framework preset auto-detects **Next.js** (also pinned in `vercel.json`).
4. (Optional) add `NEXT_PUBLIC_RPC_URL` as an env var.
5. Deploy.

`vercel.json` pins `framework: nextjs`, `buildCommand: next build`, `installCommand: npm install`.

## Structure

```
app/
  layout.tsx              root layout — fonts, theme vars, KaTeX css
  page.tsx                home page — assembles all sections
  app/                    the dApp
    swap/                 swap widget (V4Quoter + v4 router)
    pools/  pool/[address]  pool list + detail + add-liquidity
    positions/            LP positions (ERC-6909 shares)
    transactions/         on-chain activity
components/
  home/                   Masthead · Pillars · Mechanics · Architecture · PoolSim (3-token sphere simulation) · VsTable · Deployed · References
  app/                    swap widget, pool/position cards, LP modals
  layout/                 Nav (dark/light) · Footer
  Tex.tsx                 KaTeX formula renderer
lib/
  contracts.ts            deployed addresses + ABIs + PoolKey helper
  wagmi.ts                Monad testnet chain config
  hooks/                  usePool · usePositions · useTokenBalances · useTransactions · useVolume24h
constants/                color themes (dark/light) + type scale
```

> Research deployment on Monad testnet — not audited, not production.
