# Pause → Draw → Compute → Resume Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development for same-session) to implement this plan task-by-task.

**Goal:** Add an Incident-Commander decision-support flow: pause the live wildfire-only sim, draw a containment boundary, get a system-recommended *minimum custom roster* that holds the line, override if needed, then resume forward with that suppression deployed against the boundary.

**Architecture:** Three pure-function helpers (TDD), one simulation-engine refactor (extract `runOnePassFromGrid`, add `extendSimulation`), one new inverse-search variant (`findMinRosterForBoundary`), one new API endpoint pair, three new React components (Cesium polygon-drawing tool, recommendation modal card, read-only polygon overlay), plus app-level state-machine + timeline-button wiring. Reuses the existing suppression-visualization layers wholesale during Resume — no new entity types.

**Tech Stack:** TypeScript, React, Cesium (entity polylines/polygons + screen-space input), Vitest, Express + cors (local API), Web Worker fallback.

---

## Pre-task: confirm clean baseline

`npm test && npm run build`. Both must pass. Fix anything broken on `version3` before starting Task 1.

---

## Task 1: `pointInPolygon` (pure helper, TDD)

**Files:**
- Create: `src/utils/pointInPolygon.ts`
- Test: `src/utils/__tests__/pointInPolygon.test.ts`

**Public API:**
```typescript
export function pointInPolygon(lat: number, lng: number, polygon: { lat: number; lng: number }[]): boolean;
```

**Algorithm:** Standard ray-casting. Cast a ray from (lat, lng) to (+∞, lng); count edge crossings. Odd → inside.

**Step 1 — Write tests:**
- Square polygon [[0,0],[10,0],[10,10],[0,10]]: (5,5) inside, (-1,5) outside, (5,-1) outside, (15,5) outside.
- Concave (L-shape) polygon: point in the L-cutout returns false; point in the L-arm returns true.
- Polygon with 3 vertices (triangle): inside, outside, on edge (defined behavior is fine — test for whatever the impl does, just lock it).
- Polygon with vertices in CW vs CCW order: same result either way.
- Empty polygon → false. Single-vertex → false. Two-vertex → false.

**Step 2 — Run, expect fail.**

**Step 3 — Implement.**

```typescript
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: { lat: number; lng: number }[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
```

**Step 4 — Run, expect pass.**

**Step 5 — Commit:**
```bash
git commit -m "feat: pointInPolygon ray-casting helper"
```

---

## Task 2: `containmentCheck` (pure helper, TDD)

**Files:**
- Create: `src/utils/containmentCheck.ts`
- Test: `src/utils/__tests__/containmentCheck.test.ts`

**Public API:**
```typescript
export interface ContainmentCheckResult {
  ok: boolean;                  // zero Burning cells outside polygon
  burningOutside: number;       // count
  totalBurning: number;         // count of all Burning cells
  breachPercent: number;        // 0..1
}

export function containmentCheck(
  state: SimulationState,
  polygon: LatLng[],
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
): ContainmentCheckResult;
```

**Step 1 — Tests (use real `CellState.Burning` from types.ts):**
- Empty polygon → `ok: false` (degenerate; can't contain inside nothing). Actually: clarify — if polygon is invalid we'd never call this. For test: 3-point polygon enclosing the entire grid → `ok: true` even with burning cells (all inside).
- Polygon enclosing all burning cells → `ok: true`, `burningOutside: 0`, `breachPercent: 0`.
- Polygon enclosing some burning, excluding others → `ok: false`, correct `burningOutside` count, `breachPercent ≈ outside/total`.
- Grid with zero Burning cells → `ok: true`, `burningOutside: 0`, `totalBurning: 0`, `breachPercent: 0`.
- Polygon containing ONLY non-Burning cells (Burned, Suppressed, Unburned) → `ok: true` regardless (only Burning matters).

**Step 2 — Run, expect fail.**

**Step 3 — Implement:** iterate `state.grid`, for each `Burning` cell compute its lat/lng (same math as `groundPositions`), call `pointInPolygon`. Count outside.

**Step 4 — Run, expect pass. Step 5 — Commit:** `feat: polygon containment check`.

---

## Task 3: `cheapestRosterForCapacity` (pure helper, TDD)

**Files:**
- Create: `src/utils/cheapestRoster.ts`
- Test: `src/utils/__tests__/cheapestRoster.test.ts`

**Public API:**
```typescript
export function cheapestRosterForCapacity(targetChainsHr: number): ResourceCount[];
```

**Behavior:**
- target = 0 → `[]`
- target > 0: greedy fill. Compute `dozerCount = floor(target / 75)`. Remainder filled with crews (`crewCount = ceil(remainder / 9)`). Add 1 Helitack for any roster of total chains/hr ≥ 50. Add 1 Tanker for any roster ≥ 200 chains/hr.
- Returns ResourceCount[] with non-zero counts only.

**Step 1 — Tests:**
- target 0 → `[]`.
- target 75 → `[{Type1Dozer: 1}, {Helitack: 1}]` (75 ≥ 50 threshold).
- target 100 → `[{Type1Dozer: 1, Type1Crew: 3}, ..., {Helitack: 1}]` (1 dozer + 3 crews = 75+27=102).
- target 250 → `[{Type1Dozer: 3}, ..., {Helitack: 1}, {AirTanker: 1}]` (3 dozers = 225, +1 crew for ≥250, plus aerial).
- target 1000 → returns large but valid mix.
- target negative → `[]`.

**Step 2/3/4:** Implement greedy logic.

**Step 5:** `feat: cheapest roster greedy fill`.

---

## Task 4: Extract `runOnePassFromGrid` + add `extendSimulation`

**Files:**
- Modify: `src/simulation/runner.ts`
- Test: `src/simulation/__tests__/extendSimulation.test.ts`

**Refactor approach:**

Read `runOnePass` carefully. It does:
1. `createGrid + igniteCell` → produce initial grid.
2. Step loop: for each step, call `simulateStep`.

Extract step 2 into a new private function `runOnePassFromGrid(grid: Uint8Array, initialStep: number, ..., suppression, maxSteps): SuppressionResult`. Existing `runOnePass` calls `createGrid + igniteCell` then delegates to `runOnePassFromGrid(initial, 0, ...)`.

**Public API:**

```typescript
export function extendSimulation(
  config: SimulationConfig,
  initialGrid: Uint8Array,
  initialStep: number,
  fuelMap: FuelType[] | undefined,
  elevationMap: Float32Array | undefined,
  centerLat: number,
  centerLng: number,
  weather: WeatherInputs,                    // pass through to step
  suppression: SuppressionConfig | null,
  maxSteps: number,
): SuppressionResult;
```

The function defensively copies `initialGrid` (`new Uint8Array(initialGrid)`), then calls `runOnePassFromGrid`. Suppression deployment respects `responseDelayMin` measured from `initialStep` (i.e. crews deploy when `step >= initialStep + ⌈delay/timestepMinutes⌉`).

**Tests:**
- Hand-craft a 20×20 grid with 5 Burning cells. Run `extendSimulation` with no suppression for 50 steps. Confirm fire spreads (≥ 1 new Burning cell after some steps).
- Same setup with full suppression + delay 0. Confirm at least one cell flips Burning→Suppressed within 30 steps.
- Confirm `extendSimulation` with `initialStep=0, initialGrid=fresh-from-igniteCell` produces identical history to `runOnePass(igniteRow, igniteCol, ...)` (regression sanity for the refactor).
- `initialStep=10, responseDelayMin=30, timestepMinutes=3` → first suppression activity at `step >= 10 + 10 = 20`.

**Step 5 — Commit:** `feat: extendSimulation entry point + runOnePassFromGrid refactor`.

---

## Task 5: `findMinRosterForBoundary` (TDD)

**Files:**
- Modify: `src/simulation/inverseSearch.ts`
- Test: `src/simulation/__tests__/findMinRosterForBoundary.test.ts`

**Public API (matches design):**
```typescript
export interface FindMinRosterForBoundaryInput {
  config: SimulationConfig;
  fuelMap?: FuelType[];
  elevationMap?: Float32Array;
  centerLat: number;
  centerLng: number;
  weather: WeatherInputs;
  initialGrid: Uint8Array;
  initialStep: number;
  polygon: LatLng[];
  maxSteps: number;
}

export interface FindMinRosterForBoundaryResult {
  recommendedRoster: ResourceCount[] | null;
  bestEffortRoster: ResourceCount[];
  passingRun: SuppressionResult | null;
  failingRun: SuppressionResult | null;
  breachStep: number | null;
  breachPercent: number;
  bisectionTrace: Array<{
    capacityChainsHr: number;
    roster: ResourceCount[];
    passed: boolean;
    breachStep: number | null;
    breachPercent: number;
  }>;
}

export async function findMinRosterForBoundary(
  input: FindMinRosterForBoundaryInput,
): Promise<FindMinRosterForBoundaryResult>;
```

**Algorithm (bisection on chains/hr):**
1. Range: `[0, 1000]`, resolution 25.
2. For each candidate capacity, build roster via `cheapestRosterForCapacity`. Run `extendSimulation`. Check `containmentCheck` at the FINAL step of returned history. If `ok=true`, mark passed. Track `breachStep` (first step where `containmentCheck.ok === false` during the run, scanning history) and `breachPercent` at that step.
3. Standard bisection: lo=0, hi=1000. While `hi - lo > 25`: mid = round((lo+hi)/2 / 25) * 25; run candidate; if passed, hi=mid; else lo=mid.
4. After bisection, `recommendedRoster = passing roster at hi (or null if hi=1000 still failed)`. `bestEffortRoster = passing roster at hi (or roster at hi=1000 if all failed)`. `failingRun = run at lo (just below recommended)`. `passingRun = run at hi`.
5. If polygon already contains zero Burning at `initialGrid` AND no spread is possible (suppression at 0 capacity passes the containment check at end-of-sim because fire never escapes anyway): `recommendedRoster = []` (empty), `passingRun = baseline-extension run`.

**Tests:**
- Tiny grid + polygon enclosing all burning cells + slow-spreading scenario → returns `recommendedRoster = []` (zero capacity passes).
- Tiny grid where even max capacity fails → `recommendedRoster = null`, `bestEffortRoster` populated.
- Mid-range scenario → `recommendedRoster.length > 0`, `passingRun` and `failingRun` both populated, `breachStep` and `breachPercent` correct on `failingRun`.
- Bisection converges in ≤ 6 sims (assert `bisectionTrace.length <= 6`).

**Step 5 — Commit:** `feat: findMinRosterForBoundary inverse search`.

---

## Task 6: API endpoints `/api/extend` and `/api/q-boundary`

**Files:**
- Modify: `scripts/dev-server.ts`

**Step 1 — `/api/extend`:**

```typescript
app.post("/api/extend", async (req, res) => {
  const { config, initialGridRle, initialStep, fuelMap, elevationMap,
          centerLat, centerLng, weather, suppression, maxSteps } = req.body;
  const initialGrid = rleDecode(initialGridRle, config.gridSize * config.gridSize);
  const result = extendSimulation(config, initialGrid, initialStep, fuelMap,
    elevationMap ? new Float32Array(elevationMap) : undefined,
    centerLat, centerLng, weather, suppression, maxSteps);
  res.json({
    rleSteps: result.history.map(s => rleEncode(s.grid)),
    diags: result.diags,
  });
});
```

**Step 2 — `/api/q-boundary`:**

```typescript
app.post("/api/q-boundary", async (req, res) => {
  const { config, initialGridRle, initialStep, fuelMap, elevationMap,
          centerLat, centerLng, weather, polygon, maxSteps } = req.body;
  const initialGrid = rleDecode(initialGridRle, config.gridSize * config.gridSize);
  const result = await findMinRosterForBoundary({
    config, initialGrid, initialStep, fuelMap,
    elevationMap: elevationMap ? new Float32Array(elevationMap) : undefined,
    centerLat, centerLng, weather, polygon, maxSteps,
  });
  res.json({
    recommendedRoster: result.recommendedRoster,
    bestEffortRoster: result.bestEffortRoster,
    passingRun: result.passingRun ? {
      rleSteps: result.passingRun.history.map(s => rleEncode(s.grid)),
      diags: result.passingRun.diags,
    } : null,
    failingRun: result.failingRun ? {
      rleSteps: result.failingRun.history.map(s => rleEncode(s.grid)),
      diags: result.failingRun.diags,
    } : null,
    breachStep: result.breachStep,
    breachPercent: result.breachPercent,
    bisectionTrace: result.bisectionTrace,
  });
});
```

**Step 3 — Smoke (curl):** start the server, post a tiny grid + polygon, get a response. (Test by hand; no automation.)

**Commit:** `feat: /api/extend and /api/q-boundary endpoints`.

---

## Task 7: `simulationApi` client extensions

**Files:**
- Modify: `src/services/simulationApi.ts`

Add two new functions:

```typescript
export async function apiExtend(
  config, initialGrid, initialStep, fuelMap, elevationMap,
  centerLat, centerLng, weather, suppression, maxSteps,
): Promise<{ rleSteps: number[][]; diags: SuppressionStepDiag[] }>;

export async function apiQBoundary(
  config, initialGrid, initialStep, fuelMap, elevationMap,
  centerLat, centerLng, weather, polygon, maxSteps,
): Promise<FindMinRosterForBoundaryResult>;
```

Both follow the same fetch-then-throw-on-non-200 pattern as `apiSimulate`. Encode `initialGrid` via `rleEncode` before posting.

**Commit:** `feat: apiExtend + apiQBoundary frontend clients`.

---

## Task 8: `BoundaryDrawTool` component

**Files:**
- Create: `src/components/BoundaryDrawTool.tsx`

**Props:**
```typescript
interface BoundaryDrawToolProps {
  viewer: CesiumViewer | null;
  active: boolean;                                       // mounted but inactive = no-op
  onClose: (polygon: LatLng[]) => void;                  // double-click / first-vertex-click
  onCancel: () => void;                                  // Esc
}
```

**Implementation outline:**
- `useState` for `vertices: LatLng[]`.
- `useEffect` on `[viewer, active]`:
  - If active, register `ScreenSpaceEventHandler` with `LEFT_CLICK`, `LEFT_DOUBLE_CLICK`, `RIGHT_CLICK` callbacks. On `LEFT_CLICK`, ray-cast `viewer.scene.pick` then `viewer.camera.pickEllipsoid` for lat/lng, push to vertices. On `LEFT_DOUBLE_CLICK` or click within 30 px of first vertex, call `onClose(vertices)`. On `RIGHT_CLICK`, pop last vertex.
  - Register `keydown` listener on `window` for Escape → `onCancel()`.
  - Cleanup: destroy handler, remove keydown listener.
- `useEffect` on `[viewer, vertices]`: re-render the visual entities (vertex points, polyline, polygon fill). Use refs for the entities; `viewer.entities.remove(...)` on cleanup.

**Validation:** before calling `onClose`, check `vertices.length >= 3` and self-intersection (segment-pair test). If invalid, show no-op + brief banner toast (use a callback prop `onValidationError(msg: string)`).

**Commit:** `feat: BoundaryDrawTool Cesium polygon drawing`.

---

## Task 9: `RecommendationCard` component

**Files:**
- Create: `src/components/RecommendationCard.tsx`

**Props:**
```typescript
interface RecommendationCardProps {
  result: FindMinRosterForBoundaryResult;
  onApprove: (roster: ResourceCount[]) => void;
  onShowBreachPreview: () => void;
  onCancel: () => void;
  onRedraw: () => void;
}
```

Renders the headline (custom roster) + counterfactual + override dropdown per the design's Section 4 layout. Uncontainable case shows the "best effort" framing.

**Override dropdown:**
- "Recommended (3 dozers · 2 crews · 1 helitack)" — selected by default
- "Initial Attack — 1 crew + 1 engine + 1 helitack"
- "Type 3 — 3 crews + 2 engines + 2 helitack"
- "Type 2 — 5 crews + 3 dozers + 2 helitack + 1 tanker"
- "Type 1 — 10 crews + 5 dozers + 3 helitack + 2 tankers"
- "Custom..." — opens inline `SuppressionInputs` slider panel below

**Approve flow:** if user-selected roster has lower total chains/hr than recommended, show inline warning and require a second click (track via local `confirmedDangerous: boolean` state).

**Commit:** `feat: RecommendationCard with override dropdown`.

---

## Task 10: `PolygonOverlay` component

**Files:**
- Create: `src/components/PolygonOverlay.tsx`

Read-only polygon outline + fill rendered during the Resume phase. Mirrors `BoundaryDrawTool`'s rendering but without input handling. Cyan stroke (alpha 0.5), translucent cyan fill (alpha 0.1).

**Props:**
```typescript
interface PolygonOverlayProps {
  viewer: CesiumViewer | null;
  polygon: LatLng[] | null;
  contained: boolean;                  // if true, fade alpha to 0.2 + green flash once
}
```

**Commit:** `feat: PolygonOverlay read-only outline during resume`.

---

## Task 11: App state machine + TimelineBar "Suggest Containment" button

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TimelineBar.tsx`

**Step 1:** Extend `appMode` enum: add `paused-drawing | paused-computing | paused-recommendation | simulation-resumed`.

**Step 2:** Add state vars in App:
- `pausedGrid: Uint8Array | null` — captured snapshot at pause time
- `pausedStep: number` — currentStep at pause time
- `boundaryPolygon: LatLng[] | null`
- `boundaryResult: FindMinRosterForBoundaryResult | null`

**Step 3:** Add handlers:
- `handleSuggestContainment()` — captures grid/step, sets `appMode='paused-drawing'`.
- `handleBoundaryClose(polygon)` — sets boundaryPolygon, `appMode='paused-computing'`. Calls `apiQBoundary(...)` (with worker fallback). On success → `setBoundaryResult` + `appMode='paused-recommendation'`.
- `handleApproveRoster(roster)` — sets suppressionResources/Delay, calls `apiExtend(...)`, stitches the returned history onto existing baseline (Section 5 of design), `appMode='simulation-resumed'`, autoPlay=true.
- `handleCancel()` — clears boundary state, returns to paused simulation mode.

**Step 4:** Mount `BoundaryDrawTool` when `appMode === 'paused-drawing'`. Mount `RecommendationCard` when `'paused-recommendation'`. Mount `PolygonOverlay` when `'simulation-resumed'`.

**Step 5 — TimelineBar:** Add a "Suggest Containment" button visible when `autoPlay === false && appMode === 'simulation' && history.suppressed` is empty (wildfire-only). Calls a new prop `onSuggestContainment`.

**Commit:** `feat: pause→draw→compute→resume state machine + timeline button`.

---

## Task 12: Resume flow — stitched history

**Files:**
- Modify: `src/App.tsx`

In `handleApproveRoster`, after `apiExtend` returns:

```typescript
const stitchedSuppressed = [
  ...history.baseline.slice(0, pausedStep + 1),    // identical to wildfire pre-pause
  ...resumedResult.history,                          // suppression-active forward
];
const stitchedDiags = [
  ...new Array(pausedStep + 1).fill(null).map((_, step) => ({
    step,
    cumulativeLineMeters: 0,
    activePerimeterMeters: 0,
    containmentProbability: 0,
    resourcesActive: 0,
    newFirelineCells: 0,
  })),
  ...resumedResult.diags,
];
setHistory({ baseline: history.baseline, suppressed: stitchedSuppressed, diags: stitchedDiags });
```

Verify the existing suppression-visualization layers (cyan rim, vehicles, retardant trails, HUD) auto-mount because `suppressionActive` becomes true.

**Commit:** `feat: stitched history for resume flow`.

---

## Task 13: Worker fallback paths

**Files:**
- Modify: `src/simulation/worker.ts`

Add two new message types: `"extendSim"` and `"qBoundary"`. Both call the corresponding sim engine functions with the inputs from the message and post back the results.

This is purely a fallback for when the API server is down. The frontend `simulationApi` client already has the `ApiUnreachableError` fallback pattern; honor it for these new methods.

**Commit:** `feat: worker fallback for extendSim and qBoundary`.

---

## Task 14: Final smoke + acceptance

Walk the 9-step manual smoke from the design's Testing section:

1. Wildfire-only Cupertino. Pause step 50.
2. Suggest Containment → banner appears.
3. 6–8 vertices around fire → close → ~10 s compute → recommendation appears.
4. Show breach preview → red ring at breach moment.
5. Override to Initial Attack → warning → second-click Approve.
6. Sim resumes; vehicles drive in, copter orbits, cyan rim grows in polygon.
7. Sim ends → HUD shows containment outcome.
8. Try uncontainable case (small polygon, fast fire) → best-effort path.
9. Cancel and Esc cleanly abort at every stage.

**Commit (any post-smoke fixes):** `fix: post-smoke adjustments to pause-draw-resume`.

---

## After all tasks

1. `npm test` — all green.
2. `npm run build` — no TS / lint errors.
3. Use `superpowers:finishing-a-development-branch` to wrap up.

## Remember
- DRY, YAGNI, TDD, frequent commits.
- Strict polygon containment criterion: zero Burning cells outside polygon at end of sim.
- All cosmetic motion (helitack orbit, tanker passes, arrival animation) is decoration — sim accounting stays untouched.
- The bisection budget is ~6 sims max; profile if it slips on full-grid scenarios.
- Polygon validity: ≥ 3 vertices, no self-intersection, ≥ 1 ha area.
