import { SwapTabs } from "@/components/app/swap/SwapTabs";
import { AsciiBackground } from "@/components/app/shared/AsciiBackground";

export const metadata = {
  title: "Arrive — Orbital",
  description:
    "What it costs to reach the Orbital basket from any of 39 chains: NEAR Intents prices the journey, Orbital prices the swap.",
};

// Same vignette as /app/swap: the two are one page with two tabs, so they must
// not look like different places when reached by their own URLs.
const BG_MASK =
  "radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.55) 38%, rgba(0,0,0,0.12) 70%, transparent 100%)";

export default function ArrivePage() {
  return (
    <section className="relative flex-1 flex items-center justify-center py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-screen overflow-hidden"
        style={{ maskImage: BG_MASK, WebkitMaskImage: BG_MASK }}
      >
        <AsciiBackground colorMode="dark" fontSize={9} asciiChars="@" showPattern isPlaying />
      </div>

      <div className="relative z-10 w-full max-w-md px-4 sm:px-0">
        <SwapTabs initial="arrive" />
      </div>
    </section>
  );
}
