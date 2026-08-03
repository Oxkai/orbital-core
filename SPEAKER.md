# Speaker script. 3:00 demo

430 words over 180 seconds ≈ **143 wpm**, a relaxed pace. Landing under time is fine; dead air at the end beats rushing slide VII.

The deck's HUD shows cumulative elapsed time. Check it on slide V, above 1:30 means you're long, so use the cut list at the bottom.

**One rule:** VII and VIII are the submission. Everything before is setup, everything after is proof. Never sacrifice those two.

---

## I. Orbital · 0:18

> Orbital is a spherical AMM. Multi-token pools like Curve, concentrated liquidity like Uniswap v3, both at once, which no pool does today. It implements the Orbital paper from Paradigm, shipped as a Uniswap v4 hook, deployed on Monad testnet.

*Let the wordmark sit for a beat first. "Both at once, which no pool does today" is the hook, say it like it's the claim, because it is. Don't read the chain metadata; it's on screen.*

---

## II. Problem · 0:22

> Stablecoin liquidity is fragmented and fragile. Curve holds many coins but spreads liquidity flat, shallow depth, poor capital efficiency. Uniswap v3 concentrates, but only for two tokens. And on a depeg, a flat stable pool drains into the broken asset and wipes out its LPs. SVB, USDC, 2023.

*The SVB reference is the most persuasive thing in the deck for anyone who was around for it. Land it as a fact, not a warning. A, B and C are on screen because the next slide answers them by letter.*

---

## III. Solution · 0:22

> One sphere answers all three. A, each LP sets their own depeg bound, so capital concentrates where dollars actually trade. B, every coin sits in one book, so you get concentration and multi-asset instead of choosing. C, when a coin breaks, its tick exits to the boundary and the rest keep trading one to one.

*Say the letters out loud. It's the only thing tying the two slides together, and it makes the pitch feel answered rather than listed.*

---

## IV. Mechanism · 0:24

> The math is three pieces. Reserves live on an N-dimensional sphere, at the centre, every coin trades one to one. Each LP cuts that sphere with a plane: their depeg bound. That's the concentration. Every tick then folds into one torus, tracked by two running sums, so a swap stays constant time however many coins or ticks exist.

*Don't narrate the formulas. They're there to show the work is real. "Constant time however many coins" is the payoff, pause after it.*

---

## V. Architecture · 0:22

> A v4 pool only holds two tokens, so we register all six pairs and point every pool key at the same hook. The pairs are just views, a USDC/USDT trade and a DAI/FRAX trade move the same reserve vector. v4 keeps custody; our hook only supplies the curve.

*"The pairs are just views" is the non-obvious bit. Most people assume six pools means six separate pots of money. Say it deliberately.*

---

## VI. The Pool · 0:22

> Here's where the liquidity actually sits. Grey is a flat pool, same capital, spread across every price. Purple is Orbital: four tick bands stacked into a spike within a cent of the peg, which is where stablecoins actually trade. Each step down is a tier dropping out as price moves away.

*Wait for the curve to finish drawing before speaking. Trace the spike with your cursor. Let the picture do the persuading and keep your words underneath it.*

---

## VII. What we found · 0:28

> Then we quoted the live pool. It priced like constant product, the ticks were doing nothing. Deposits were sized from the radius alone, so a tight tick cost the same as a full-range one. Now an LP funds only the band their tick actually trades in, while the curve is credited the whole thing. The unfunded part is never callable, because the tick exits at its bound first.

*The most important 28 seconds in the deck. This is what no other submission has: you didn't just implement a paper, you found where the implementation was silently wrong and fixed it.*

*Beat after "the ticks were doing nothing." Let it sit for a second before you deliver the fix.*

---

## VIII. Results · 0:16

> Same capital, after the fix. A hundred-thousand-dollar swap went from nearly two percent slippage to one and a half basis points. A million-dollar swap used to revert outright, now it clears at five basis points. A hundred and twenty-one tests pass.

*Say "basis points", never "zero point zero one four five percent". Nobody parses that spoken.*

---

## IX. Live · 0:06

> Live on Monad testnet, all verifiable on chain. Everything's in the repo.

*Don't read addresses. Leave the slide up while you stop recording.*

---

## If you're running long

Cut in this order. Each is a clean removal that costs no argument:

1. **V, last sentence**, "v4 keeps custody…" (~5s)
2. **IV, the torus sentence**, keep sphere and ticks (~8s)
3. **I, the paper sentence**, the first two sentences carry the definition (~7s)

Never cut from VI, VII or VIII.

---

## Hold these for the live discussion

Keep these out of the video, they invite questions you can't answer in 3 minutes, and they're better as conversation:

- **Boundary-state LP exits.** Mints and burns are gated on `kBound == 0`, so exiting *during* an active depeg is future work. Say so plainly if asked; it's a known, documented limit.
- **The 2000× concentration cap**, why it exists (the `k → kMin` degeneracy where required capital tends to zero) and why that number.
- **Why the sphere alone equals constant product at peg.** Genuinely interesting, and the reason the bug hid for so long, but it needs a whiteboard.
- **Monad's parallel execution.** Shared reserve state means concurrent swaps conflict. Real, measurable, unexplored. Your best answer to "what's next."
- **`virtualOffset` mechanics** and why it stays invariant under swaps and tick crossings.
- **Provenance.** The hook and math libraries came from our UHI9 build; the Monad port, the concentration fix and everything measured here is new. Volunteer this before anyone asks.

---

## Before you record

- Re-run `SeedActivity` first. Monad's ~300 ms blocks push activity out of the frontend's scan window within about an hour, so a stale pool shows an empty transactions list.
- Confirm the app is serving Monad, not a cached build.
- Full-screen the deck, or the HUD lands in the recording.
