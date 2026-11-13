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
import { ArrowDown, CaretDown, CaretUp, Info } from "@phosphor-icons/react";
import { useReadContract } from "wagmi";

import { color, typography } from "@/constants";
import { TokenIcon } from "@/components/app/shared/TokenIcon";
import { TabStrip, type SwapTab } from "@/components/app/swap/TabStrip";
import { QUOTER_ABI } from "@/lib/contracts";
import { AURORA_TESTNET_ID, DEPLOYMENTS } from "@/lib/crosschain";
import { useIntentsQuote, useIntentsTokens } from "@/lib/hooks/useIntentsQuote";
import { chainLabel } from "@/lib/intents/types";

/// Section label: uppercase, tracked out, muted — as used by the swap widget
/// and the add-liquidity page, so this panel reads as part of the same app.
const LBL = {
  fontFamily: typography.caption.family,
  fontSize: typography.caption.size,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  fontWeight: 500,
};

function body(size: "p1" | "p2" | "p3" | "caption" = "p2", c: string = color.textPrimary) {
  const t = typography[size];
  return {
    fontFamily: t.family,
    fontSize: t.size,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    color: c,
    fontVariantNumeric: "tabular-nums" as const,
  };
}

/// The 36px figure both token boxes lead with, matching `TokenBox` in the swap
/// widget. Dimmed when there is nothing to show yet.
function hero(filled: boolean): React.CSSProperties {
  return {
    fontFamily: typography.h1.family,
    fontSize: "36px",
    letterSpacing: "-0.03em",
    fontWeight: 500,
    color: filled ? color.textPrimary : color.textMuted,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  };
}

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

export function ArrivePanel({
  tab,
  onTabChange,
}: {
  /// Rendered inside this panel's header row, so Swap/Arrive costs no extra bar.
  tab?: SwapTab;
  onTabChange?: (t: SwapTab) => void;
} = {}) {
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
    // Scaled to 1e6 and divided down, so the bps keeps two decimals: integer
    // division straight to bps truncated 1.9 bps to 1 and showed half the cost.
    return Number(((startWad - endWad) * 1_000_000n) / startWad) / 100;
  }, [origin, outAsset, amountRaw, swapOut]);

  const originFilled = Number(amountText) > 0;
  const outStr =
    swapOut !== undefined && outAsset
      ? (Number(swapOut) / 10 ** outAsset.decimals).toFixed(4)
      : "";
  const legTwoBusy = swap.isLoading && wantSymbol !== "USDC";

  return (
    <div className="flex flex-col w-full">
      {tab && (
        <div
          className="flex items-center justify-between gap-4 px-5 pt-3"
          style={{ backgroundColor: color.surface1 }}
        >
          <TabStrip tab={tab} onChange={onTabChange} />
          <span style={{ ...body("p3", color.textMuted), paddingBottom: 5 }} className="truncate">
            → Aurora
          </span>
        </div>
      )}

      {tokensError && (
        <div className="mt-px px-5 py-4" style={{ backgroundColor: color.surface1 }}>
          <span style={body("p3", color.warning)}>Intents token list unavailable: {tokensError}</span>
        </div>
      )}

      {/* You hold */}
      <div className="mt-px px-5 py-5" style={{ backgroundColor: color.surface1 }}>
        <div className="flex items-center justify-between mb-3">
          <span style={{ ...LBL, color: color.textMuted }}>You hold</span>
          <Picker
            value={originChain}
            onChange={(v) => setOriginChain(v)}
            disabled={tokensLoading}
            options={chains.map((c) => ({ value: c, label: chainLabel(c) }))}
            muted
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amountText}
              onChange={(e) => {
                if (/^\d*(?:\.\d*)?$/.test(e.target.value)) setAmountText(e.target.value);
              }}
              className="w-full bg-transparent outline-none"
              style={hero(originFilled)}
            />
          </div>
          <TokenSelect
            symbol={origin?.symbol ?? "—"}
            value={origin?.symbol ?? ""}
            onChange={(v) => setOriginSymbol(v)}
            disabled={tokensLoading}
            options={originOptions.map((t) => ({ value: t.symbol, label: t.symbol }))}
          />
        </div>

        <div className="mt-3">
          <span style={body("caption", color.textMuted)}>
            ≈ ${originFilled ? Number(amountText).toFixed(2) : "0.00"}
          </span>
        </div>
      </div>

      {/* Direction marker, sitting in the 1px seam like the swap widget's flip */}
      <div className="relative" style={{ height: 0 }}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <div
            className="flex items-center justify-center w-9 h-9"
            style={{ backgroundColor: color.surface2, outline: `2px solid ${color.bg}`, borderRadius: 2 }}
          >
            <ArrowDown size={14} color={color.textPrimary} weight="regular" />
          </div>
        </div>
      </div>

      {/* You receive */}
      <div className="mt-px px-5 py-5" style={{ backgroundColor: color.surface1 }}>
        <div className="flex items-center justify-between mb-3">
          <span style={{ ...LBL, color: color.textMuted }}>You receive</span>
          <span style={body("caption", color.textMuted)}>Aurora testnet</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div style={hero(!!outStr)}>{legTwoBusy ? "…" : outStr || "0"}</div>
          </div>
          <TokenSelect
            symbol={wantSymbol}
            value={wantSymbol}
            onChange={(v) => setWantSymbol(v)}
            chainId={AURORA_TESTNET_ID}
            options={Object.keys(aurora?.assets ?? {}).map((s) => ({ value: s, label: s }))}
          />
        </div>

        <div className="mt-3">
          <span style={body("caption", color.textMuted)}>
            ≈ ${outStr ? Number(outStr).toFixed(2) : "0.00"}
          </span>
        </div>
      </div>

      {/* The two legs, each priced by the system that would execute it */}
      <div className="mt-px flex flex-col gap-px">
        <Leg
          n={1}
          title={`${chainLabel(originChain)} → NEAR · via Intents`}
          busy={quoting}
          error={quoteError}
          summary={quote ? `${quote.amountOutFormatted} USDC` : undefined}
          rows={
            quote
              ? [
                  ["Value", fmtUsd(quote.amountOutUsd)],
                  ["Takes", fmtSeconds(quote.timeEstimate)],
                ]
              : undefined
          }
        />
        <Leg
          n={2}
          title={
            quote
              ? `${quote.amountOutFormatted} USDC → ${wantSymbol} · on Orbital`
              : `USDC → ${wantSymbol} · on Orbital`
          }
          busy={legTwoBusy}
          error={swap.isError ? "Pool did not quote" : undefined}
          summary={outStr ? `${outStr} ${wantSymbol}` : undefined}
          rows={outStr ? [["Pool", "Aurora testnet · 1bp"]] : undefined}
        />
      </div>

      {/* All-in cost — the number the whole page exists to produce */}
      <div
        className="mt-px px-5 py-4 flex items-center justify-between"
        style={{ backgroundColor: color.surface1 }}
      >
        <div className="flex flex-col gap-1">
          <span style={{ ...LBL, color: color.textMuted }}>All-in cost</span>
          <span style={body("caption", color.textMuted)}>Both legs, against what you started with</span>
        </div>
        <span
          style={{
            fontFamily: typography.h1.family,
            fontSize: "28px",
            letterSpacing: "-0.03em",
            fontWeight: 500,
            color: allInBps === undefined ? color.textMuted : color.textPrimary,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {allInBps === undefined ? "—" : `${allInBps.toFixed(2)} bps`}
        </span>
      </div>

      <DryNote />
    </div>
  );
}

/// The dry-quote caveat and the Aurora seam. Both matter, but neither needs to
/// occupy a third of the panel: one line states the guarantee, the detail is a
/// click away behind the same disclosure the swap widget's info panel uses.
function DryNote() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-px" style={{ backgroundColor: color.surface1 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-(--color-surface-2) transition-colors"
        style={{ cursor: "pointer" }}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Info size={13} color={color.textMuted} weight="regular" style={{ flexShrink: 0 }} />
          <span style={body("p3", color.textSecondary)}>Quotes are dry — nothing here moves funds</span>
        </span>
        {open ? (
          <CaretUp size={12} color={color.textMuted} weight="regular" style={{ flexShrink: 0 }} />
        ) : (
          <CaretDown size={12} color={color.textMuted} weight="regular" style={{ flexShrink: 0 }} />
        )}
      </button>

      {open && (
        <div
          className="px-5 py-4 flex flex-col gap-2.5"
          style={{ borderTop: `1px dashed ${color.borderSubtle}` }}
        >
          <p style={body("p3", color.textMuted)}>
            Priced by the same solver network as a real route, but no deposit address is minted and
            no signature is requested. Intents has no testnet.
          </p>
          <p style={body("p3", color.textMuted)}>
            It does not list Aurora as a destination, so the final hop from NEAR to the Aurora pool
            is NEAR&apos;s own bridge and is not included in leg one.
          </p>
        </div>
      )}
    </div>
  );
}

/// A native select dressed as the app's surface2 control, so the 39-chain and
/// 229-asset lists stay keyboard- and screen-reader-native while matching the
/// token buttons either side of them.
function Picker({
  value,
  onChange,
  options,
  disabled,
  muted,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="relative flex items-center">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none outline-none hover:bg-(--color-surface-3) transition-colors"
        style={{
          backgroundColor: color.surface2,
          color: muted ? color.textSecondary : color.textPrimary,
          fontFamily: typography.caption.family,
          fontSize: "11px",
          letterSpacing: "0.02em",
          height: 28,
          padding: "0 26px 0 10px",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <CaretDown
        size={10}
        color={color.textMuted}
        weight="regular"
        style={{ position: "absolute", right: 9, pointerEvents: "none" }}
      />
    </div>
  );
}

/// The token control from the swap widget's `TokenBox`: icon, symbol, caret —
/// with a native select laid over it so the list itself stays native.
function TokenSelect({
  symbol,
  value,
  onChange,
  options,
  disabled,
  chainId,
}: {
  symbol: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  chainId?: number;
}) {
  return (
    <div className="relative shrink-0">
      <div
        className="flex items-center gap-2 pl-2 pr-3 h-10"
        style={{ backgroundColor: color.surface2 }}
      >
        <TokenIcon symbol={symbol} size={28} chainId={chainId} ringColor={color.surface2} />
        <span style={{ ...body("p2", color.textPrimary), fontWeight: 500 }}>{symbol}</span>
        <CaretDown size={11} color={color.textMuted} weight="regular" />
      </div>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Asset"
        className="absolute inset-0 w-full h-full opacity-0"
        style={{ cursor: disabled ? "not-allowed" : "pointer" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/// One priced leg of the journey.
///
/// Collapsed, it states the route and what it hands on — enough to follow the
/// chain from the amount entered to the amount received. The rest sits behind
/// the caret, on the same disclosure the swap widget's info panel uses, so the
/// two legs cost four lines instead of eleven.
function Leg({
  n,
  title,
  summary,
  busy,
  error,
  rows,
}: {
  n: number;
  title: string;
  /// The figure this leg hands to the next one, shown while collapsed.
  summary?: string;
  busy?: boolean;
  error?: string;
  rows?: [string, string][];
}) {
  const [open, setOpen] = useState(false);
  const expandable = !!rows?.length && !busy && !error;

  return (
    <div style={{ backgroundColor: color.surface1 }}>
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left ${
          expandable ? "hover:bg-(--color-surface-2) transition-colors" : ""
        }`}
        style={{ cursor: expandable ? "pointer" : "default" }}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span
            className="flex items-center justify-center shrink-0"
            style={{
              width: 18,
              height: 18,
              backgroundColor: color.surface3,
              color: color.textSecondary,
              fontFamily: typography.caption.family,
              fontSize: "10px",
              fontWeight: 500,
            }}
          >
            {n}
          </span>
          <span style={{ ...body("p3", color.textPrimary), fontWeight: 500 }} className="truncate">
            {title}
          </span>
        </span>

        <span className="flex items-center gap-2 shrink-0">
          {busy ? (
            <span style={body("p3", color.textMuted)}>Quoting…</span>
          ) : error ? (
            <span style={body("p3", color.warning)}>{error}</span>
          ) : (
            <span style={body("p3", color.textSecondary)}>{summary ?? "—"}</span>
          )}
          {expandable &&
            (open ? (
              <CaretUp size={12} color={color.textMuted} weight="regular" />
            ) : (
              <CaretDown size={12} color={color.textMuted} weight="regular" />
            ))}
        </span>
      </button>

      {open && expandable && (
        <div
          className="px-5 py-3.5 flex flex-col gap-2"
          style={{ borderTop: `1px dashed ${color.borderSubtle}` }}
        >
          {rows?.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span style={{ ...LBL, color: color.textMuted }}>{k}</span>
              <span style={body("p3", color.textSecondary)}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
