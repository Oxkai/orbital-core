"use client";

/**
 * Arrival cost, end to end.
 *
 * Orbital prices the swap. NEAR Intents prices the journey. Neither number is
 * much use alone: a trader holding USDT on Tron and wanting DAI does not care
 * what either leg costs, they care what arrives.
 *
 * Both legs are quoted live by the system that would actually execute them —
 * Intents through its solver network, Orbital through its own V4Quoter on the
 * Aurora deployment. Nothing here is modelled or estimated by this app.
 *
 * The seam is stated rather than hidden: Intents settles to NEAR and to EVM
 * mainnets, and it does not list Aurora as a destination, so the last hop to
 * the Aurora pool is NEAR's own bridge and is not part of the Intents quote.
 */

import { useMemo, useState } from "react";
import { useReadContract } from "wagmi";

import { color, typography } from "@/constants";
import { QUOTER_ABI } from "@/lib/contracts";
import { AURORA_TESTNET_ID, DEPLOYMENTS } from "@/lib/crosschain";
import { useIntentsQuote, useIntentsTokens } from "@/lib/hooks/useIntentsQuote";
import { chainLabel } from "@/lib/intents/types";

/**
 * The basket is reached through NEAR, the one chain Intents serves that also
 * carries three of the four basket symbols. Aurora, where the pool lives, is
 * NEAR's EVM but is not an Intents destination.
 */
const BRIDGE_CHAIN = "near";

const aurora = DEPLOYMENTS[AURORA_TESTNET_ID];

function fmtUsd(v?: string) {
  if (!v) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
}

function fmtSeconds(s?: number) {
  if (s === undefined) return "—";
  return s < 90 ? `${s}s` : `${Math.round(s / 60)} min`;
}

export function ArrivePanel() {
  const { tokens, loading: tokensLoading, error: tokensError } = useIntentsTokens();

  const [originChain, setOriginChain] = useState("arb");
  const [originSymbol, setOriginSymbol] = useState("USDC");
  const [amountText, setAmountText] = useState("1000");
  /** Which basket asset the trader actually wants to end up holding. */
  const [wantSymbol, setWantSymbol] = useState("DAI");

  const chains = useMemo(
    () => [...new Set(tokens.map((t) => t.blockchain))].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b))),
    [tokens],
  );
  const originOptions = useMemo(
    () => tokens.filter((t) => t.blockchain === originChain),
    [tokens, originChain],
  );
  const origin = useMemo(
    () => originOptions.find((t) => t.symbol === originSymbol) ?? originOptions[0],
    [originOptions, originSymbol],
  );

  /** The basket symbol we bridge into, and the one the trader wants, must both exist on NEAR. */
  const bridgeIn = useMemo(
    () => tokens.find((t) => t.blockchain === BRIDGE_CHAIN && t.symbol === "USDC"),
    [tokens],
  );

  const amountRaw = useMemo(() => {
    if (!origin) return 0n;
    const n = Number(amountText);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.round(n * 10 ** origin.decimals));
  }, [amountText, origin]);

  const {
    quote,
    error: quoteError,
    loading: quoting,
  } = useIntentsQuote(origin?.assetId, bridgeIn?.assetId, amountRaw);

  // Leg two: what Orbital returns for swapping the arrived USDC into the
  // symbol the trader wants. Read from the live pool, not modelled here.
  const inAsset = aurora?.assets.USDC;
  const outAsset = aurora?.assets[wantSymbol];
  const arrived = quote ? BigInt(quote.amountOut) : 0n;

  const poolKey = useMemo(() => {
    if (!inAsset || !outAsset || !aurora) return undefined;
    const [c0, c1] =
      inAsset.address.toLowerCase() < outAsset.address.toLowerCase()
        ? [inAsset.address, outAsset.address]
        : [outAsset.address, inAsset.address];
    return {
      key: {
        currency0: c0 as `0x${string}`,
        currency1: c1 as `0x${string}`,
        fee: 0,
        tickSpacing: 1,
        hooks: aurora.orbitalHook,
      },
      zeroForOne: inAsset.address.toLowerCase() === c0.toLowerCase(),
    };
  }, [inAsset, outAsset]);

  const swap = useReadContract({
    chainId: AURORA_TESTNET_ID,
    address: aurora?.quoter,
    abi: QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: poolKey
      ? ([
          {
            poolKey: poolKey.key,
            zeroForOne: poolKey.zeroForOne,
            exactAmount: arrived,
            hookData: "0x" as const,
          },
        ] as const)
      : undefined,
    query: { enabled: !!poolKey && arrived > 0n && wantSymbol !== "USDC" },
  });

  const swapOut = wantSymbol === "USDC" ? arrived : (swap.data?.[0] as bigint | undefined);

  // All-in, against what the trader started with. Both legs are same-peg
  // dollars, so the comparison is honest without a price oracle.
  const allInBps = useMemo(() => {
    if (!origin || !outAsset || amountRaw <= 0n || swapOut === undefined) return undefined;
    const startWad = (amountRaw * 10n ** 18n) / 10n ** BigInt(origin.decimals);
    const endWad = (swapOut * 10n ** 18n) / 10n ** BigInt(outAsset.decimals);
    if (startWad === 0n) return undefined;
    return Number(((startWad - endWad) * 10000n) / startWad);
  }, [origin, outAsset, amountRaw, swapOut]);

  const label = (t: string) => (
    <div style={{ ...typography.caption, color: color.textMuted, marginBottom: 6 }}>{t}</div>
  );
  const selectStyle: React.CSSProperties = {
    backgroundColor: color.surface2,
    color: color.textPrimary,
    border: `1px solid ${color.borderSubtle}`,
    padding: "8px 10px",
    width: "100%",
    fontFamily: "var(--font-mono)",
    fontSize: 13,
  };

  return (
    <div style={{ backgroundColor: color.surface1, border: `1px solid ${color.borderSubtle}` }}>
      <div style={{ padding: "16px 18px", borderBottom: `1px solid ${color.borderSubtle}` }}>
        <div style={{ ...typography.p1, color: color.textPrimary }}>Arrive from any chain</div>
        <div style={{ ...typography.caption, color: color.textMuted, marginTop: 4 }}>
          NEAR Intents prices the journey. Orbital prices the swap. Both quoted live.
        </div>
      </div>

      <div style={{ padding: 18, display: "grid", gap: 14 }}>
        {tokensError && (
          <div style={{ ...typography.caption, color: color.error }}>
            Intents token list unavailable: {tokensError}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            {label("You hold, on")}
            <select
              value={originChain}
              onChange={(e) => setOriginChain(e.target.value)}
              style={selectStyle}
              disabled={tokensLoading}
            >
              {chains.map((c) => (
                <option key={c} value={c}>
                  {chainLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            {label("Asset")}
            <select
              value={origin?.symbol ?? ""}
              onChange={(e) => setOriginSymbol(e.target.value)}
              style={selectStyle}
              disabled={tokensLoading}
            >
              {originOptions.map((t) => (
                <option key={t.assetId} value={t.symbol}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            {label("Amount")}
            <input
              value={amountText}
              onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              style={selectStyle}
            />
          </div>
          <div>
            {label("You want")}
            <select value={wantSymbol} onChange={(e) => setWantSymbol(e.target.value)} style={selectStyle}>
              {Object.keys(aurora?.assets ?? {}).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Row
          n={1}
          title={`${chainLabel(originChain)} → NEAR, via Intents`}
          busy={quoting}
          error={quoteError}
          lines={
            quote
              ? [
                  ["arrives", `${quote.amountOutFormatted} USDC`],
                  ["value", fmtUsd(quote.amountOutUsd)],
                  ["takes", fmtSeconds(quote.timeEstimate)],
                ]
              : undefined
          }
        />

        <Row
          n={2}
          title={`USDC → ${wantSymbol}, on Orbital`}
          busy={swap.isLoading}
          error={swap.isError ? "pool did not quote" : undefined}
          lines={
            swapOut !== undefined && outAsset
              ? [
                  [
                    "receives",
                    `${(Number(swapOut) / 10 ** outAsset.decimals).toFixed(4)} ${wantSymbol}`,
                  ],
                  ["pool", "Aurora testnet, 1bp"],
                ]
              : undefined
          }
        />

        {allInBps !== undefined && (
          <div
            style={{
              backgroundColor: color.surface2,
              padding: "12px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span style={{ ...typography.p2, color: color.textSecondary }}>All-in cost</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 18,
                color: color.textPrimary,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {(allInBps / 100).toFixed(2)}%
            </span>
          </div>
        )}

        <p style={{ ...typography.caption, color: color.textMuted, lineHeight: 1.5 }}>
          Intents quotes are <strong>dry</strong>: priced by the same solver network as a real
          route, but they mint no deposit address and request no signature, so nothing here can
          move funds. Intents has no testnet. It settles to NEAR and to EVM mainnets and does not
          list Aurora as a destination, so the final hop from NEAR to the Aurora pool is NEAR&apos;s
          own bridge and is not included in leg one.
        </p>
      </div>
    </div>
  );
}

function Row({
  n,
  title,
  busy,
  error,
  lines,
}: {
  n: number;
  title: string;
  busy?: boolean;
  error?: string;
  lines?: [string, string][];
}) {
  return (
    <div style={{ border: `1px solid ${color.borderSubtle}`, padding: "12px 14px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: lines || busy || error ? 8 : 0 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: color.bg,
            backgroundColor: color.textMuted,
            width: 18,
            height: 18,
            display: "grid",
            placeItems: "center",
          }}
        >
          {n}
        </span>
        <span style={{ ...typography.p2, color: color.textPrimary }}>{title}</span>
      </div>
      {busy && <div style={{ ...typography.caption, color: color.textMuted }}>quoting…</div>}
      {error && <div style={{ ...typography.caption, color: color.warning }}>{error}</div>}
      {lines?.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ ...typography.caption, color: color.textMuted }}>{k}</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: color.textPrimary,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}
