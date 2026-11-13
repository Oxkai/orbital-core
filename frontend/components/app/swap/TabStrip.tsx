"use client";

/**
 * The Swap / Arrive toggle.
 *
 * It lives in its own file because both widgets render it as the left half of
 * their own header row — importing it from `SwapTabs` would be circular, and a
 * strip above the widget cost a second bar of chrome for the same two words.
 */

import { color, typography } from "@/constants";

export type SwapTab = "swap" | "arrive";

const TABS: { id: SwapTab; label: string }[] = [
  { id: "swap", label: "Swap" },
  { id: "arrive", label: "Arrive" },
];

export function TabStrip({
  tab,
  onChange,
}: {
  tab: SwapTab;
  onChange?: (t: SwapTab) => void;
}) {
  return (
    <div className="flex items-center gap-5 shrink-0" role="tablist" aria-label="Swap or arrive">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(t.id)}
            // No surface, so no hover veil (see globals.css): the inactive
            // label brightens toward the active one instead.
            className={`transition-colors ${active ? "" : "text-(--color-text-muted) hover:text-(--color-text-secondary)"}`}
            style={{
              fontFamily: typography.p2.family,
              fontSize: typography.p2.size,
              fontWeight: 500,
              letterSpacing: "-0.01em",
              color: active ? color.textPrimary : undefined,
              paddingBottom: 5,
              borderBottom: `2px solid ${active ? color.textPrimary : "transparent"}`,
              cursor: onChange ? "pointer" : "default",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
