import { ArrivePanel } from "@/components/app/arrive/ArrivePanel";

export const metadata = {
  title: "Arrive — Orbital",
  description:
    "What it costs to reach the Orbital basket from any of 39 chains: NEAR Intents prices the journey, Orbital prices the swap.",
};

export default function ArrivePage() {
  return (
    <section className="relative flex-1 py-12">
      <div className="mx-auto w-full max-w-[560px] px-4">
        <ArrivePanel />
      </div>
    </section>
  );
}
