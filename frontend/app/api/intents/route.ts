/**
 * NEAR Intents proxy.
 *
 * The browser does not call 1Click directly: the service sets no CORS headers
 * for arbitrary origins, and proxying also keeps the token list cacheable on
 * one server rather than refetched per visitor.
 *
 * Every quote this route asks for is `dry: true`. A dry quote is priced by the
 * same solver network as a real one and returns the same amounts, fees and
 * time estimate, but mints no deposit address and asks for no signature, so
 * nothing here can move a user's funds. NEAR Intents has no testnet, so a dry
 * quote is the honest way to show real routing against a testnet pool.
 */

import { NextResponse } from "next/server";

import type { IntentsToken } from "@/lib/intents/types";

const ONECLICK = "https://1click.chaindefuser.com/v0";

/** Token list changes rarely; a visitor should not pay for refetching it. */
export const revalidate = 300;

async function tokens(): Promise<IntentsToken[]> {
  const r = await fetch(`${ONECLICK}/tokens`, {
    next: { revalidate },
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`1Click /tokens ${r.status}`);
  return (await r.json()) as IntentsToken[];
}

export async function GET() {
  try {
    const all = await tokens();
    // Trim to what the picker needs. The full list carries price history and
    // per-chain metadata that would otherwise cross the wire on every load.
    const slim = all.map((t) => ({
      assetId: t.assetId,
      blockchain: t.blockchain,
      symbol: t.symbol,
      decimals: t.decimals,
      contractAddress: t.contractAddress,
      price: t.price,
    }));
    return NextResponse.json({ ok: true, tokens: slim });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "token list unavailable" },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "malformed request" }, { status: 400 });
  }

  const { originAssetId, destinationAssetId, amount, slippageBps } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (
    typeof originAssetId !== "string" ||
    typeof destinationAssetId !== "string" ||
    typeof amount !== "string" ||
    !/^\d+$/.test(amount)
  ) {
    return NextResponse.json(
      { ok: false, error: "originAssetId, destinationAssetId and an atomic amount are required" },
      { status: 400 },
    );
  }
  if (originAssetId === destinationAssetId) {
    return NextResponse.json({ ok: false, error: "same asset on both legs" }, { status: 400 });
  }

  // `refundTo` and `recipient` are required by the schema even on a dry quote.
  // A constant placeholder keeps real user addresses out of a third party's
  // logs, since a dry quote settles nothing and the field only has to parse.
  //
  // It cannot be a burn address: 1Click answers "recipient is not valid" for
  // the zero address and for 0x…dEaD, so this is a non-burn constant that
  // validates and belongs to nobody in particular.
  const placeholder = "0x1111111111111111111111111111111111111111";

  // Far enough out that the quote is never refused for an expired deadline,
  // and meaningless anyway because nothing is deposited against it.
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  try {
    const r = await fetch(`${ONECLICK}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        dry: true,
        swapType: "EXACT_INPUT",
        slippageTolerance: typeof slippageBps === "number" ? slippageBps : 100,
        originAsset: originAssetId,
        destinationAsset: destinationAssetId,
        amount,
        refundTo: placeholder,
        refundType: "ORIGIN_CHAIN",
        recipient: placeholder,
        recipientType: "DESTINATION_CHAIN",
        depositType: "ORIGIN_CHAIN",
        deadline,
      }),
      cache: "no-store",
    });

    const json = (await r.json()) as { quote?: unknown; message?: string };
    if (!r.ok || !json.quote) {
      // The service explains an unroutable pair in `message`; surfacing it is
      // more useful than a generic failure, since "no route" is a real answer.
      return NextResponse.json(
        { ok: false, error: json.message ?? `1Click /quote ${r.status}` },
        { status: r.status === 400 ? 200 : 502 },
      );
    }
    return NextResponse.json({ ok: true, quote: json.quote });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "quote unavailable" },
      { status: 502 },
    );
  }
}
