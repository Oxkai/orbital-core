"use client";

/**
 * The NEAR Intents leg of an arrival: what it costs to move an asset from one
 * of 39 chains to the chain the Orbital basket is reachable from.
 *
 * Every quote is `dry` (see `app/api/intents/route.ts`), so this hook can run
 * on every keystroke without a wallet, a signature, or any possibility of
 * moving funds. NEAR Intents has no testnet, and the organisers' own guidance
 * is to develop against mainnet with dry quotes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { IntentsQuote, IntentsToken } from "@/lib/intents/types";

/** Debounce, so typing an amount does not fire a quote per character. */
const QUOTE_DEBOUNCE_MS = 400;

export function useIntentsTokens() {
  const [tokens, setTokens] = useState<IntentsToken[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetch("/api/intents")
      .then((r) => r.json())
      .then((d: { ok: boolean; tokens?: IntentsToken[]; error?: string }) => {
        if (!live) return;
        if (d.ok && d.tokens) setTokens(d.tokens);
        else setError(d.error ?? "token list unavailable");
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "network error"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  return { tokens, error, loading };
}

export function useIntentsQuote(
  originAssetId: string | undefined,
  destinationAssetId: string | undefined,
  amount: bigint,
) {
  const [quote, setQuote] = useState<IntentsQuote>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  // Only the newest request may write state: a slow quote for an amount the
  // user has already changed must not overwrite a fresh one.
  const seq = useRef(0);

  const run = useCallback(async () => {
    if (!originAssetId || !destinationAssetId || amount <= 0n) {
      setQuote(undefined);
      setError(undefined);
      return;
    }
    if (originAssetId === destinationAssetId) {
      setQuote(undefined);
      setError("Pick a different origin asset — that is already the destination.");
      return;
    }

    const mine = ++seq.current;
    setLoading(true);
    setError(undefined);
    try {
      const r = await fetch("/api/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originAssetId,
          destinationAssetId,
          amount: amount.toString(),
        }),
      });
      const d = (await r.json()) as
        | { ok: true; quote: IntentsQuote }
        | { ok: false; error: string };
      if (mine !== seq.current) return;
      if (d.ok) {
        setQuote(d.quote);
      } else {
        setQuote(undefined);
        setError(d.error);
      }
    } catch (e) {
      if (mine !== seq.current) return;
      setQuote(undefined);
      setError(e instanceof Error ? e.message : "quote failed");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [originAssetId, destinationAssetId, amount]);

  useEffect(() => {
    const t = setTimeout(run, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [run]);

  return { quote, error, loading };
}
