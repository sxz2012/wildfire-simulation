# Pause → Draw → Compute → Recommendation → Resume — Design

**Date:** 2026-05-06
**Branch:** version3 (or successor)
**Status:** Validated
**Builds on:** `2026-05-04-suppression-modeling-design.md`, `2026-05-04-suppression-inverse-search-design.md`, `2026-05-05-suppression-visualization-design.md`

## Goal

Turn the wildfire-only sim into an Incident-Commander decision-support tool. Pause the live fire mid-spread, draw a defensible perimeter, get a system-recommended *minimum custom roster* (any mix of crews/engines/dozers/helitack/tankers — not constrained to the four canonical tiers) that holds the line, override if needed, then resume forward with that suppression deployed.

## The five-step flow

1. **Pause.** User pauses a wildfire-only sim via the timeline scrubber. Current `Uint8Array` grid at `currentStep` is the input state for everything below.
2. **Draw.** New "Draw Boundary" mode. User clicks vertices on the globe; Cesium renders a translucent yellow polygon in real time. Double-click or click-first-vertex to close.
3. **Compute.** Blocking modal-card shows progress while `findMinRosterForBoundary` runs. Each candidate sim uses `extendSimulation(initialGrid=pausedGrid, polygon, bundle, ...)` — only runs forward. ~5–15 s on the workstation.
4. **Recommendation.** Card shows the headline custom roster + a counterfactual ("smaller bundle breaches at minute N — X% outside boundary"). Override dropdown allows any preset or custom roster. Uncontainable scenarios get "best effort" framing.
5. **Resume.** Approved roster becomes the active suppression config. `extendSimulation` runs forward from the paused grid with that bundle. Full visualization activates (cyan rim, glTF vehicles, retardant trails, HUD). The drawn polygon stays as a thin cyan outline reference.

## Success criterion

**Strict polygon containment:** at end of sim, zero `CellState.Burning` cells outside the user's polygon. Burned-out cells outside are acceptable (they've already passed the burning phase).

## Recommendation algorithm

The search space is the full resource roster, not the four tiers.

**Bisection on total fireline-construction rate (chains/hr).** The Reed–McCool containment model already keys on aggregate chains/hr.

1. **Range:** `[0, 1000]` chains/hr. Bisection resolution: 25 chains/hr.
2. **Per-candidate mix:** Given target chains/hr, fill the cheapest mix using `RESOURCE_RATES.costPerHour / chainsPerHour`. Greedy fill: Type1Dozer ($67/chain) → Type1Crew ($500/chain) → Engine ($625/chain). Add 1 Helitack and 1 Tanker to every roster of meaningful size for aerial support.
3. **Bisection budget:** ~6 sims (matches Q1 budget).
4. **Output:** smallest passing roster as `ResourceCount[]` — e.g. `{Type1Dozer: 3, Type1Crew: 2, Helitack: 1}`. If even max-capacity fails → "uncontainable" + best-effort path.

## Boundary drawing UI

**Trigger.** "Suggest Containment" button in the timeline bar appears when sim is paused AND wildfire-only.

**Draw banner.** Replaces timeline:
```
DRAW CONTAINMENT BOUNDARY
Click to place vertices · double-click to close · right-click to undo · Esc to cancel
[Cancel]    [N vertices · close to compute]
```

**Cesium entities while drawing:**
- Yellow vertex points (`PointPrimitiveCollection`); active vertex brighter.
- Closed-loop polyline (`CallbackProperty` on `positions`) — translucent yellow, 3 px, `clampToGround: true`.
- Polygon fill at ≥ 3 vertices — `polygon` entity with `hierarchy = vertices`, fill rgba(250, 200, 50, 0.15), `clampToGround: true`.

**Closure.** Double-click empty space OR click within 30 px of first vertex.

**Validation:** ≥ 3 vertices, no self-intersection, ≥ 1 ha area. Failures show transient toast + stay in Draw mode.

**Cancel and Esc:** clear vertex array, remove draw entities, return to paused-sim state.

## extendSimulation (new in `runner.ts`)

```typescript
function extendSimulation(
  config: SimulationConfig,
  initialGrid: Uint8Array,        // the paused state
  initialStep: number,             // step at which initialGrid was captured
  fuelMap: FuelType[],
  elevationMap: Float32Array,
  centerLat: number,
  centerLng: number,
  weather: WeatherInputs,
  suppression: SuppressionConfig | null,
  maxSteps: number,                // total steps INCLUDING initialStep
): SuppressionResult;              // history from initialStep onward + diags
```

Skips the `createGrid + igniteCell` setup; starts the step loop at `step = initialStep` with `grid = initialGrid.slice()` (defensive copy). Suppression deploys when `step >= initialStep + ⌈responseDelayMin/timestepMinutes⌉` — so deploying "now" means `responseDelayMin = 0`.

**Refactor:** Extract `runOnePassFromGrid(initialGrid, initialStep, ..., suppression, maxSteps)` from `runOnePass`. Existing `runOnePass` becomes a thin wrapper.

## findMinRosterForBoundary (new in `inverseSearch.ts`)

```typescript
function findMinRosterForBoundary(input: {
  config, fuelMap, elevationMap, centerLat, centerLng, weather,
  initialGrid, initialStep, polygon: LatLng[], maxSteps,
}): {
  recommendedRoster: ResourceCount[] | null;        // null = uncontainable
  bestEffortRoster: ResourceCount[];                // even if recommended is null
  passingRun: SuppressionResult;
  failingRun: SuppressionResult;
  breachStep: number | null;
  breachPercent: number;
  bisectionTrace: Array<{capacityChainsHr, roster, passed, breachStep, breachPercent}>;
}
```

**Containment check:** at end of sim, count cells where `state.grid[i] === Burning && pointInPolygon(cellLatLng(i), polygon) === false`. Zero such cells → pass.

**Breach detection:** during failing run, track first step where any Burning cell appears outside polygon. Store as `breachStep`. Compute `breachPercent` at that step (cells outside / total burning).

**Point-in-polygon:** standard ray-casting. O(V) per cell × 360k cells × 6 sims = 2.2 M ops total. Microsec scale.

## Recommendation card

**Containable:**
```
MINIMUM EFFECTIVE RESPONSE
3 dozers · 2 crews · 1 helitack
Total line capacity: 245 chains/hr · est. cost $25k/hr
─────────────────────────────
Smaller (1 dozer + 1 crew) breaches at minute 47
12% outside boundary  [show breach preview]
─────────────────────────────
Override: [3 dozers · 2 crews · 1 helitack ▾]
          ├ Initial Attack (1 of each)
          ├ Type 3 (3·2·2)
          ├ Type 2 (5·3·2·1)
          ├ Type 1 (10·5·3·2)
          └ Custom...

[Approve & Deploy]   [Redraw]   [Cancel]
```

**Uncontainable:**
```
UNCONTAINABLE AT THIS BOUNDARY
Max response (10 dozers · 10 crews · 5 helitack · 3 tankers · 5 engines)
breaches at minute 67 — 23% outside boundary

Closest to containment: [same max bundle ▾]  Limits breach to 23%

[Deploy (best effort)]   [Redraw]   [Cancel]
```

**"Show breach preview"** loads `failingRun` history into the visualization. User polygon traces in cyan; breach cell flashes red.

**Override dropdown** carries the canonical tiers as quick presets plus a "Custom..." that opens the existing `SuppressionInputs` per-resource sliders inline.

**Approve flow:** chosen `ResourceCount[]` becomes `suppressionResources`, `responseDelayMin = 0`, modal dismisses, app transitions to Resume.

## Resume

Three coordinated state changes on Approve:

1. **Suppression config injected.** `setSuppressionResources(approvedRoster)` and `setSuppressionDelay(0)`.

2. **Resumed history.** Call `extendSimulation` via the local API. Returned `SuppressionResult` covers steps `pausedStep..maxSteps`. Stitch onto existing pre-pause history:
   ```typescript
   setHistory({
     baseline: existingBaseline,                              // unchanged: full pre-pause
     suppressed: [...existingBaseline.slice(0, pausedStep+1), ...resumedResult.history],
     diags: padDiagsZerosBefore(pausedStep, resumedResult.diags),
   });
   ```

3. **Visualization activates.** All existing suppression-visualization layers (cyan rim, glTF vehicles, retardant trails, HUD) auto-mount because `history.suppressed` and `history.diags` are now non-empty. The drawn polygon stays rendered as a thin cyan outline (alpha 0.5) for orientation; fades to 0.2 + green flash on full containment.

**Autoplay resumes.** `setAutoPlay(true)` continues forward from the paused step.

**Sim ends without containment.** HUD freezes with: *"Boundary breached at minute N. Final burned area: X ha (Y% outside boundary)."*

## Architecture summary

### Backend additions
- `src/simulation/runner.ts` — `extendSimulation(...)` + extracted `runOnePassFromGrid`.
- `src/simulation/inverseSearch.ts` — `findMinRosterForBoundary(...)`, `pointInPolygon`, `containmentCheck`, `cheapestRosterForCapacity`.
- `scripts/dev-server.ts` — `POST /api/extend`, `POST /api/q-boundary`.
- `src/services/simulationApi.ts` — `apiExtend(...)`, `apiQBoundary(...)`.
- `src/simulation/worker.ts` — new message types `"extendSim"` and `"qBoundary"` (browser fallback).

### Frontend additions
- `src/components/BoundaryDrawTool.tsx` — Cesium polygon drawing UI.
- `src/components/RecommendationCard.tsx` — modal card with override dropdown.
- `src/components/PolygonOverlay.tsx` — read-only polygon outline during Resume.

### App state machine
`appMode` adds: `paused-drawing | paused-computing | paused-recommendation | simulation-resumed` to existing `idle | simulation | historical`.

## Testing

**Unit (vitest):**
- `src/utils/__tests__/pointInPolygon.test.ts` — inside / outside / on edge / vertex / concave polygon.
- `src/utils/__tests__/cheapestRoster.test.ts` — greedy fill correctness; aerial-add threshold; capacity-0 → `[]`.
- `src/simulation/__tests__/extendSimulation.test.ts` — fire spreads from initialGrid; suppression contains; deployment delay measured from initialStep.
- `src/simulation/__tests__/findMinRosterForBoundary.test.ts` — smallest passing roster; null on uncontainable; bisection converges in ≤ 6; passing/failing differ by one capacity step.
- `src/simulation/__tests__/containmentCheck.test.ts` — Burning-outside count; ok=true at zero; breach percent math.

**Manual smoke:**
1. Wildfire-only Cupertino. Pause step 50.
2. Suggest Containment → banner appears.
3. 6–8 vertices around fire → close → ~10 s compute → recommendation appears.
4. Show breach preview shows failing-run + red ring.
5. Override to Initial Attack → warning → second-click Approve.
6. Sim resumes; vehicles drive in, copter orbits, cyan rim grows in polygon.
7. Sim ends → HUD shows containment outcome.
8. Try uncontainable case (small polygon, fast fire) → best-effort path.
9. Cancel and Esc clean up entities and return to paused state.

## Out of scope (v1)

- Multi-polygon / hole-in-polygon containment areas (single simple polygon only).
- SSE-based real-time bisection progress (REST polling shows "1 of 6").
- Continuous-axis resource search (integer counts only).
- Cost optimization beyond greedy chains/hr fill (true LP needs external solver).
- Polygon re-edit after compute (Cancel + Redraw instead).
- Saving / loading polygons across sessions.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Polygon at 360k cells × 6 sims slow | Microsec scale; no concern |
| Bisection oscillates near boundary | 25 chains/hr resolution floor |
| User polygon already contains fire | Short-circuit recommendation: "0 resources needed — already contained" |
| User draws polygon excluding part of fire | Show "X% of fire outside boundary" warning during draw; criterion still applies |
| Network failure mid-compute | Modal shows error + Cancel; existing fallback worker takes over |
| 200-step extendSimulation too slow on workstation | Profile in Phase 1; cap maxSteps for the inverse search to remaining-steps + 100 |

## Success criteria

The feature ships when:

1. Pause + Suggest Containment + Draw + Close produces a recommendation card in ≤ 15 s on the workstation.
2. Recommendation displays a custom roster (not just a tier name).
3. Counterfactual ("breaches at minute N") displays correctly.
4. Override dropdown loads any preset or custom roster.
5. Approve resumes the sim with full visualization activating cleanly.
6. Drawn polygon remains visible as orientation reference during resume.
7. Uncontainable case shows best-effort framing.
8. Cancel/Esc cleanly aborts at every stage.
