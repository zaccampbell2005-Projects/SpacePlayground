<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Simulation/physics lives in `src/cosmos/` as plain TypeScript (no React/canvas imports) so it stays unit-testable; `physics.test.ts` covers it.
- Rendering: `src/cosmos/render.ts` draws bodies/effects in Canvas 2D; when WebGL exists, `gl-backdrop.ts` draws stars + nebula sprites and composites the 2D layer on the GPU (with chromatic aberration), else everything falls back to 2D. Per-frame state stays in refs — avoids 60fps re-renders.
- Adaptive quality lives in the CosmosApp render loop (smoothed fps → nebula stride + DPR); dev builds expose `window.__cosmos` (world, renderer, cam refs) for scripted browser checks.
- The `/` route is `ssr: false` because the sandbox uses window/canvas/Web Audio at mount.
- Saved universes live in `cosmic_universes`: public read, guests insert unowned rows, signed-in users insert with `owner_id = auth.uid()` and only owners update/delete — share links work without accounts.
- tsconfig has `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` off: typed-array-heavy simulation code is unreadable under them.
