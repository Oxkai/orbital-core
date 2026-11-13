"use client";

/**
 * Swap and Arrive, one page.
 *
 * Both answer "I hold X, I want Y", so they belong in one place — but they end
 * differently and must not pretend otherwise. Swap ends in a transaction: the
 * pool's own router, or an ERC-7683 order settled over Hyperlane. Arrive ends
 * in a price: NEAR Intents quotes are dry, and Intents does not reach Aurora,
 * so there is nothing here to execute.
 *
 * That is why they are tabs rather than one widget. A single widget would need
 * one token selector serving both the 16 tokens the pools hold (with wallet
 * balances) and the 229 assets Intents routes (with none), and its primary
 * button would be dead for every Intents route.
 *
 * This component owns only which tab is open. The toggle itself is drawn by
 * each widget inside its own header row, so the pair costs one bar of chrome
 * rather than two stacked ones.
 *
 * `/app/swap` and `/app/arrive` both render this, each opening on its own tab,
 * so either URL still lands where it says it does.
 */

import { useState } from "react";

import { ArrivePanel } from "@/components/app/arrive/ArrivePanel";
import { SwapWidget } from "@/components/app/swap/SwapWidget";
import type { SwapTab } from "@/components/app/swap/TabStrip";

export type { SwapTab };

export function SwapTabs({ initial = "swap" }: { initial?: SwapTab }) {
  const [tab, setTab] = useState<SwapTab>(initial);

  // Both stay mounted: switching tabs must not re-fetch the 229-asset Intents
  // list, nor discard a quote the user is part-way through reading.
  return (
    <div className="flex flex-col w-full">
      <div hidden={tab !== "swap"}>
        <SwapWidget tab={tab} onTabChange={setTab} />
      </div>
      <div hidden={tab !== "arrive"}>
        <ArrivePanel tab={tab} onTabChange={setTab} />
      </div>
    </div>
  );
}
