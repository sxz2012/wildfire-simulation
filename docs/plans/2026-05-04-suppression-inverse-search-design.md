# Suppression Inverse-Search & Local Backend — Design

**Date:** 2026-05-04
**Branch:** version3
**Status:** Validated
**Builds on:** `docs/plans/2026-05-04-suppression-modeling-design.md` (which produced the existing dual-pass suppression sim)

## Goal

Turn the existing suppression sandbox from "user picks inputs → see one outcome" into a **what-if-analysis tool** that answers two operationally-meaningful questions:

- **Q1 — Max acceptable response delay.** *Given a fixed resource bundle and a started fire, what is the largest response delay where suppression still works?*
- **Q2 — Minimum required tier.** *Given a fixed delay and a started fire, what is the smallest resource tier that successfully contains the fire?*

For both, **success = final burned area ≤ a per-scenario threshold (default 500 ha)**.

A second deliverable: a **local Node backend** running on the user's workstation so live, audience-driven what-if queries finish in seconds instead of minutes.

## Why

The current dual-pass simulation is great for sandbox exploration, but it doesn't directly answer the two questions an incident commander actually asks. Q1 and Q2 are the questions decision-makers care about — *"Can I wait for more crews?"* and *"What's the smallest commitment that holds?"*

A demo that answers Q1 and Q2 in seconds — both for canned scenarios and live ad-hoc clicks — is far more compelling than one that requires the audience to manually probe parameter combinations.

## Inputs and outputs

### Q1 — `findMaxDelay`

| Input | Description |
|---|---|
| Scenario (location, weather, fuel, terrain) | Same data the regular sim takes |
| Fixed bundle (`Initial Attack` / `Type 3` / `Type 2` / `Type 1`) | Resources committed |
| Threshold area (default 500 ha) | Success criterion |

| Output | Description |
|---|---|
| `maxDelayMin` | Largest delay where final area ≤ threshold |
| `justWorksRun` | Full sim history at the boundary delay (passes) |
| `justFailsRun` | Full sim history at delay + step (fails) |
| `bisectionTrace` | Sequence of (delay, finalArea, passed) for diagnostic display |

Algorithm: **bisection** on the interval `[0, 180]` minutes with a 5-minute resolution stop condition. Worst case: ~6 simulations. Each sim uses the existing `runSimulation` (suppression-only pass — we don't need the unsuppressed counterfactual for inverse search).

### Q2 — `findMinTier`

| Input | Description |
|---|---|
| Scenario | Same as Q1 |
| Fixed delay (e.g. 30 min) | Response delay |
| Threshold area | Success criterion |

| Output | Description |
|---|---|
| `minTier` | Smallest tier (`initialAttack`, `type3`, `type2`, `type1`) that meets the threshold; or `null` if even Type 1 fails |
| `minWorkingRun` | History at `minTier` |
| `tierBelowRun` | History at the tier just below `minTier` (the one that fails) |
| `tierTrace` | List of (tier, finalArea, passed) for diagnostic display |

Algorithm: **linear scan up the ladder**, return on the first pass. Worst case: 4 simulations.

## Success criterion: final-area threshold

- Independent of the abstract Reed-McCool math
- Directly comparable across scenarios
- Matches how an IC frames the question
- Per-scenario default lives in scenario JSON (typical: 500 ha for suburban, larger for remote)

## UI: tier labels (verbose Option A)

Tier names are jargon for non-fire-ops viewers. Every dropdown, modal, and analysis card uses **size descriptor + official tier + composition** in a single line:

| Bundle key | Display label |
|---|---|
| `none` | *No response* |
| `initialAttack` | *Small (Initial Attack) — 1 crew + 1 engine + 1 helitack* |
| `type3` | *Medium (Type 3) — 3 crews + 2 engines + 2 helitack* |
| `type2` | *Large (Type 2) — 5 crews + 3 dozers + 2 helitack + 1 tanker* |
| `type1` | *Maximum (Type 1) — 10 crews + 5 dozers + 3 helitack + 2 tankers* |

Q1 / Q2 result cards say things like *"Min effective response = **Medium (Type 3)**."* — gives the audience the gist immediately, keeps the official terminology authentic.

## Architecture

### Two execution paths

| Path | When | Where it runs | Latency |
|---|---|---|---|
| **Precompute** (default) | Per-scenario, baked into JSON, ships in repo | Workstation (Node script, run during build / overnight) | Instant for the audience |
| **Local backend** (live) | Audience asks "what about HERE?" with a custom click | Local Node Express/Hono server on the workstation; browser POSTs to `localhost:3001` | ~3–10 s per sim, ~15–60 s for full inverse search |

The same code path (`runSimulation` + the new `inverseSearch.ts`) drives both — precompute just batches what the API computes on demand.

### Components

#### New

1. **`src/simulation/inverseSearch.ts`** — pure TypeScript, browser + Node compatible.
   - `findMaxDelay({ config, weather, fuelMap, elevationMap, igniteRowCol, bundle, thresholdAreaHa, maxSteps })` → `{ maxDelayMin, justWorksRun, justFailsRun, bisectionTrace }`
   - `findMinTier({ config, weather, fuelMap, elevationMap, igniteRowCol, delayMin, thresholdAreaHa, maxSteps })` → `{ minTier, minWorkingRun, tierBelowRun, tierTrace }`
   - Each call wraps `runSimulation` (suppression-only) and computes final area from the last snapshot.

2. **`scripts/dev-server.ts`** — minimal localhost API. Three endpoints:
   - `POST /api/simulate` — single live sim
   - `POST /api/q1` — full Q1 inverse search
   - `POST /api/q2` — full Q2 inverse search
   - All three stream progress over **Server-Sent Events** (per-step diagnostics + percent complete).

3. **`src/services/simulationApi.ts`** — frontend client for the local API. Tries the API first; falls back to the existing browser worker only if `localhost:3001` is unreachable.

4. **`src/components/AnalysisPanel.tsx`** — Q1 + Q2 result cards inside the existing `ImpactSection`. Each card shows:
   - Boundary number (large: *"35 min"* / *"Medium (Type 3)"*)
   - Verbose label
   - Threshold area context (*"keeping it under 500 ha"*)
   - Toggle to load the just-works / just-fails sim into the map for visual comparison

#### Modified

- **`scripts/generate_scenario.ts`** — extended to also run `findMaxDelay` + `findMinTier` per scenario and embed results in the JSON.
- **`src/components/SuppressionInputs.tsx`** — labels updated to the verbose Option A format.
- **`src/data/scenarios/cupertino-wui.json`** — regenerated with the new `analysis` block.
- **`src/App.tsx`** — wires `simulationApi` for live sims; loads `analysis` from scenario JSON when present.

### Scenario JSON format (extended)

```typescript
interface PrecomputedScenario {
  meta: {
    id: string;
    name: string;
    description: string;
    location: { lat: number; lng: number };
    weather: { ...same as today };
    suppression: SuppressionConfig;        // default for the primary sim
    config: { gridSize, cellSizeMeters, timestepMinutes, windSpeed, windDirection, humidity };
    threshold: { areaHa: number };          // NEW — used by inverse search
    generatedAt: string;
  };
  fuelMap: number[];
  elevations: number[];
  primary: { rleSteps: number[][]; diags?: SuppressionStepDiag[] };  // the default sim
  analysis: {                                                         // NEW
    q1: {
      bundle: BundleKey;
      maxDelayMin: number | null;
      justWorks: { delayMin: number; rleSteps: number[][]; finalAreaHa: number };
      justFails: { delayMin: number; rleSteps: number[][]; finalAreaHa: number };
      bisectionTrace: Array<{ delayMin: number; finalAreaHa: number; passed: boolean }>;
    };
    q2: {
      delayMin: number;
      minTier: BundleKey | null;
      minWorking?: { tier: BundleKey; rleSteps: number[][]; finalAreaHa: number };
      tierBelow?: { tier: BundleKey; rleSteps: number[][]; finalAreaHa: number };
      tierTrace: Array<{ tier: BundleKey; finalAreaHa: number; passed: boolean }>;
    };
  };
}
```

## Demo posture

- **Precompute is the safe default**: the audience sees instant results from baked JSONs.
- **Local backend is the showpiece**: when someone asks for a custom location, the workstation runs the real inverse search live, in seconds, with a streaming progress UI.
- **Browser fallback** stays available for offline development but is **not** the default during the demo.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Local server isn't running during the demo (forgotten) | Frontend detects unreachable API, shows a clear toast: *"Local server unreachable. Start with `npm run server` or use a precomputed scenario."* Falls back to browser worker silently if user prefers |
| Inverse search returns "even Type 1 fails" for an extreme scenario | Display `null` cleanly: *"This fire cannot be contained under 500 ha with any tier in our model — try increasing the threshold."* |
| Per-scenario threshold isn't sensible | Document defaults in scenario JSON; let user override via a small input on the AnalysisPanel |
| Precompute time bloats with more scenarios | Run on workstation overnight; keep the inverse-search budget bounded (≤ 6 sims for Q1 + ≤ 4 for Q2 = 10 max per scenario) |
| Browser-side fallback is much slower than the Node API | Document the expected latencies; precompute remains the demo default |

## Success criteria

The feature ships when:

1. Cupertino scenario shows Q1 and Q2 cards with sensible numbers (not `null`).
2. Clicking a result card loads the boundary sim into the map (just-works vs just-fails).
3. Live audience clicks finish in under 30 s on the workstation.
4. The local server can be started with a single `npm run server` command.
5. If the server is down, the frontend either falls back gracefully or shows a clear error.
6. Tier labels show as *"Small (Initial Attack)"* style throughout — pickers, modals, analysis cards.

## Out of scope

- Continuous-axis Q2 (search by total chains/hr) — Phase 2 if the tier ladder feels too coarse.
- Pareto-frontier output — too abstract for the demo.
- Cloud deployment — workstation-only for now.
- Optimization across a continuous resource space — combinatorial blow-up; out of scope.
- WebSocket upgrade — Server-Sent Events are sufficient for one-way streaming.
