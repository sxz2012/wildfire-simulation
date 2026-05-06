# Suppression Visualization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development for same-session) to implement this plan task-by-task.

**Goal:** Add operational/literal visualization of wildfire suppression — five distinct 3D vehicle models with type-specific motion, a growing cyan containment line, persistent red retardant trails, and an operational dashboard HUD — without changing the simulation engine.

**Architecture:** All visuals are derived in the renderer from existing `SuppressionResult.history` + `SuppressionStepDiag[]` + `SuppressionConfig`. Three new Cesium layers (vehicle entities, containment-line canvas, retardant polylines) plus one React HUD panel. Pure-function helpers for drop scheduling, ground-position derivation, and per-type counts are unit-tested.

**Tech Stack:** TypeScript, React, Cesium (glTF entities, polyline collections, canvas-imagery layers), Vite (`?url` for static glTF assets), Vitest for pure-function tests.

---

## Pre-task: confirm clean baseline

Run `npm test` and `npm run build` once. If either fails on the current branch, fix before starting Task 1 — we don't want to be debugging unrelated breakage during this feature.

---

## Task 1: Pure-function `perTypeCounts`

**Files:**
- Create: `src/utils/perTypeCounts.ts`
- Test: `src/utils/__tests__/perTypeCounts.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/utils/__tests__/perTypeCounts.test.ts
import { describe, it, expect } from "vitest";
import { perTypeCounts } from "../perTypeCounts";
import { SUPPRESSION_BUNDLES } from "../../simulation/types";

describe("perTypeCounts", () => {
  it("returns zeros before deployment", () => {
    const counts = perTypeCounts({
      bundle: SUPPRESSION_BUNDLES.type2,
      step: 5,
      deployStep: 10,
      endStep: 100,
    });
    expect(counts).toEqual({ crews: 0, engines: 0, dozers: 0, helitack: 0, tankers: 0 });
  });

  it("returns full bundle counts at deployment step", () => {
    const counts = perTypeCounts({
      bundle: SUPPRESSION_BUNDLES.type2,
      step: 10,
      deployStep: 10,
      endStep: 100,
    });
    expect(counts).toEqual({ crews: 5, engines: 0, dozers: 3, helitack: 2, tankers: 1 });
  });

  it("returns zeros after end step", () => {
    const counts = perTypeCounts({
      bundle: SUPPRESSION_BUNDLES.type2,
      step: 101,
      deployStep: 10,
      endStep: 100,
    });
    expect(counts).toEqual({ crews: 0, engines: 0, dozers: 0, helitack: 0, tankers: 0 });
  });

  it("matches type1 bundle composition", () => {
    const counts = perTypeCounts({
      bundle: SUPPRESSION_BUNDLES.type1,
      step: 50,
      deployStep: 10,
      endStep: 100,
    });
    expect(counts).toEqual({ crews: 10, engines: 0, dozers: 5, helitack: 3, tankers: 2 });
  });
});
```

**Step 2: Run tests — expect fail**

`npx vitest run src/utils/__tests__/perTypeCounts.test.ts`
Expected: FAIL with "Cannot find module '../perTypeCounts'".

**Step 3: Implement `perTypeCounts`**

```typescript
// src/utils/perTypeCounts.ts
import type { ResourceCount } from "../simulation/types";

export interface PerTypeCountsInput {
  bundle: ResourceCount;
  step: number;
  deployStep: number;
  endStep: number;
}

export interface PerTypeCounts {
  crews: number;
  engines: number;
  dozers: number;
  helitack: number;
  tankers: number;
}

export function perTypeCounts({
  bundle,
  step,
  deployStep,
  endStep,
}: PerTypeCountsInput): PerTypeCounts {
  if (step < deployStep || step > endStep) {
    return { crews: 0, engines: 0, dozers: 0, helitack: 0, tankers: 0 };
  }
  return {
    crews: bundle.crews ?? 0,
    engines: bundle.engines ?? 0,
    dozers: bundle.dozers ?? 0,
    helitack: bundle.helitack ?? 0,
    tankers: bundle.tankers ?? 0,
  };
}
```

**Step 4: Run tests — expect pass**

`npx vitest run src/utils/__tests__/perTypeCounts.test.ts` → all 4 pass.

**Step 5: Commit**

```bash
git add src/utils/perTypeCounts.ts src/utils/__tests__/perTypeCounts.test.ts
git commit -m "feat: per-type resource count derivation"
```

---

## Task 2: Pure-function `groundPositions`

**Files:**
- Create: `src/utils/groundPositions.ts`
- Test: `src/utils/__tests__/groundPositions.test.ts`

**Step 1: Write the failing tests**

Tests must cover:
- N entities, M flipped cells (M ≥ N) → returns N evenly-spaced positions sampled from flipped set.
- N entities, M flipped cells (M < N) → returns M positions (no duplication).
- Empty flipped set + non-empty `lastFramePositions` → returns `lastFramePositions` unchanged.
- Empty flipped set + empty `lastFramePositions` → returns `[]`.
- Position math: index 5 in a 10×10 grid centered at (37.0, -122.0) with cellSize 30 m → returns the expected lat/lng.

Write five `it(...)` blocks, then run.

**Step 2: Run tests — expect fail.**

**Step 3: Implement.**

```typescript
// src/utils/groundPositions.ts
import { CellState, type SimulationConfig, type SimulationState } from "../simulation/types";

export interface LatLng { lat: number; lng: number }

export function groundPositions(
  prev: SimulationState | null,
  curr: SimulationState,
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
  count: number,
  lastFramePositions: LatLng[],
): LatLng[] {
  if (count === 0) return [];

  // Flipped set: cells that became Suppressed this step
  const flipped: number[] = [];
  if (prev) {
    for (let i = 0; i < curr.grid.length; i++) {
      if (prev.grid[i] === CellState.Burning && curr.grid[i] === CellState.Suppressed) {
        flipped.push(i);
      }
    }
  }
  if (flipped.length === 0) return lastFramePositions;

  const { gridSize, cellSizeMeters } = config;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const cellLat = cellSizeMeters / metersPerDegLat;
  const cellLng = cellSizeMeters / metersPerDegLng;
  const half = gridSize / 2;

  const sampleCount = Math.min(count, flipped.length);
  const stride = flipped.length / sampleCount;
  const out: LatLng[] = [];
  for (let k = 0; k < sampleCount; k++) {
    const idx = flipped[Math.floor(k * stride)];
    const row = Math.floor(idx / gridSize);
    const col = idx - row * gridSize;
    out.push({
      lat: centerLat + (row - half) * cellLat,
      lng: centerLng + (col - half) * cellLng,
    });
  }
  return out;
}
```

**Step 4: Run tests — expect pass.**

**Step 5: Commit.**

```bash
git commit -m "feat: ground-resource position derivation from flipped cells"
```

---

## Task 3: Pure-function `dropScheduler`

**Files:**
- Create: `src/utils/dropScheduler.ts`
- Test: `src/utils/__tests__/dropScheduler.test.ts`

**Step 1: Write tests**

- Given 1 tanker, deployStep 10, timestepMinutes 3, run length 100 steps → drops at steps 10, 20, 30, ..., 100 (every 30 sim-min = every 10 steps).
- Given 2 tankers → drops alternate, so drops at steps 10, 15, 20, 25, ... (15 sim-min cadence per pair).
- Given 0 tankers → returns `[]`.
- For each drop, longest-axis chord computed from the fire bounding box at that step's history snapshot. Test with a hand-crafted history where step 10's bounding box is wider in lat than lng → drop axis is N-S.

**Step 2: Run — fail.**

**Step 3: Implement.** Outline:

```typescript
// src/utils/dropScheduler.ts
import { CellState, type SimulationConfig, type SimulationState, type SuppressionConfig } from "../simulation/types";

export interface DropEvent {
  tankerIdx: number;
  startStep: number;       // when tanker enters frame
  centerStep: number;      // when retardant is painted
  endStep: number;         // when tanker exits frame
  axisStart: { lat: number; lng: number };
  axisEnd: { lat: number; lng: number };
}

const DROP_CADENCE_SIM_MIN = 30;
const DROP_DURATION_SIM_MIN = 3;
const DROP_OFFSET_KM = 5;

export function dropScheduler(
  history: SimulationState[],
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
  suppression: SuppressionConfig,
  deployStep: number,
): DropEvent[] {
  const tankers = suppression.bundle?.tankers ?? 0;
  if (tankers === 0) return [];

  const cadenceSteps = Math.max(1, Math.round(DROP_CADENCE_SIM_MIN / config.timestepMinutes));
  const durationSteps = Math.max(1, Math.round(DROP_DURATION_SIM_MIN / config.timestepMinutes));
  const perTankerCadence = cadenceSteps;
  const interTankerOffset = Math.floor(cadenceSteps / tankers);

  const events: DropEvent[] = [];
  for (let tIdx = 0; tIdx < tankers; tIdx++) {
    for (let s = deployStep + tIdx * interTankerOffset; s < history.length; s += perTankerCadence) {
      const axis = longestAxisChord(history[s], config, centerLat, centerLng);
      if (!axis) continue;
      events.push({
        tankerIdx: tIdx,
        startStep: Math.max(deployStep, s - Math.floor(durationSteps / 2)),
        centerStep: s,
        endStep: Math.min(history.length - 1, s + Math.ceil(durationSteps / 2)),
        axisStart: axis.start,
        axisEnd: axis.end,
      });
    }
  }
  return events.sort((a, b) => a.centerStep - b.centerStep);
}

function longestAxisChord(...): { start, end } | null {
  // Compute bounding box of Burning cells at this step.
  // Pick the longer dimension. Extend ±DROP_OFFSET_KM beyond the bbox along that axis.
  // Return start/end lat/lng for the tanker's flight path.
}
```

**Step 4: Run — pass.**

**Step 5: Commit.**

```bash
git commit -m "feat: tanker drop event scheduler"
```

---

## Task 4: ContainmentLineLayer (cyan rim)

**Files:**
- Create: `src/components/ContainmentLineLayer.tsx`

**Approach:** Mirror the `FireOverlay` pattern (canvas-imagery layer, takes `viewer` prop). Keep one offscreen canvas at `gridSize × gridSize`. On each step change, walk the new state's grid; for any cell that is now `Suppressed`, paint a saturated cyan pixel (or 2×2 block for visibility on small grids). Once painted, never erase. Use `SingleTileImageryProvider` with the canvas as `image`, replace on each step.

No tests — this is glue. Will be smoke-tested.

**Commit:**

```bash
git commit -m "feat: cyan containment-line imagery layer"
```

---

## Task 5: RetardantTrailLayer (red drop trails)

**Files:**
- Create: `src/components/RetardantTrailLayer.tsx`

**Approach:** Cesium `PolylineCollection` with one polyline per `DropEvent` whose `centerStep <= currentStep`. Polyline material is a `PolylineColorAppearance` with red (`#d92121`), width 80 m equivalent (use `width: 8` pixels with `clampToGround: true`). Per-polyline opacity decays with `Math.max(0.3, 1 - (currentStep - centerStep) / decaySteps)` where `decaySteps = 10 / timestepMinutes`.

`useEffect` on `[viewer, dropEvents, currentStep]`. On unmount, clear the collection.

No tests — glue. Smoke-tested.

**Commit:**

```bash
git commit -m "feat: retardant-trail polyline layer"
```

---

## Task 6: SuppressionVehicleLayer — ground entities

**Files:**
- Create: `src/components/SuppressionVehicleLayer.tsx`

**Approach (this task — ground only; helitack/tanker added in next two tasks):**

- Take props: `viewer`, `history`, `config`, `centerLat`, `centerLng`, `suppression`, `deployStep`, `currentStep`.
- Compute `counts = perTypeCounts(...)` for current step.
- Compute `groundPositions(...)` for engines/crews/dozers separately (or reuse one set and assign first N to engines, next M to crews, etc. — engines first by convention).
- Maintain `Cesium.Entity` instances per type in a `Map<entityId, Entity>`. On count change, add/remove entities.
- Each entity uses `model: { uri: glbUrlForType(type), minimumPixelSize: 36, scale: 1 }`.
- Position via `Cartesian3.fromDegrees(lng, lat, terrainHeight + offset)` where `offset = 0` for ground, terrain height fetched once cached.

Use `import engineUrl from "../assets/models/engine.glb?url"` style imports. For Task 6 we may not have real assets yet — see Task 10 for fallback strategy.

**Glue test:** mount with a synthetic 50-step history and a Type 2 bundle in a stub Cesium viewer (or skip; rely on smoke).

**Commit:**

```bash
git commit -m "feat: suppression vehicle layer (ground entities only)"
```

---

## Task 7: SuppressionVehicleLayer — helitack orbits

**Files:**
- Modify: `src/components/SuppressionVehicleLayer.tsx`

**Step 1:** Compute the active-fire centroid (mean lat/lng of cells where `state.grid[i] === Burning`). If no Burning cells, helitack hovers at last centroid.

**Step 2:** Helitack positions: angle `θ_i = (i / N) * 2π + ω * realTime`, where `ω` is `2π / orbitPeriodSec`. Position in Cartesian uses `Transforms.eastNorthUpToFixedFrame(centroid)` × `(radius * cos θ, radius * sin θ, altitude)`.

**Step 3:** Use a `requestAnimationFrame` loop (driven by Cesium's `viewer.clock.onTick` or React's `useEffect` + `setInterval` at 30 Hz) to refresh helitack positions smoothly between sim steps.

**Step 4:** Smoke-test in Cesium: drop a Type 2 scenario, verify 2 helitack circle the fire visibly.

**Commit:**

```bash
git commit -m "feat: helitack orbit motion"
```

---

## Task 8: SuppressionVehicleLayer — tanker drops

**Files:**
- Modify: `src/components/SuppressionVehicleLayer.tsx`

**Step 1:** Receive `dropEvents` prop (computed once by parent via `dropScheduler`).

**Step 2:** For each step, iterate `dropEvents` where `startStep <= currentStep <= endStep`. For each active drop, compute tanker position by linear interpolation:
```
t = (currentStep - startStep) / (endStep - startStep)   // 0 → 1
pos = lerp(axisStart, axisEnd, t)
altitude = 150 m
```

**Step 3:** Tankers not in any active drop window are not rendered (no entity). When a drop becomes active, spawn the entity; when it ends, remove it.

**Step 4:** Heading: orient model along `(axisEnd - axisStart)` so the tanker faces forward. Use `Transforms.headingPitchRollToFixedFrame`.

**Step 5:** Trigger `RetardantTrailLayer` to paint the trail at `centerStep`. Either via shared state in parent or a callback prop.

**Smoke:** Type 2 run; observe at least one drop pass with red trail painted.

**Commit:**

```bash
git commit -m "feat: tanker drop pass motion"
```

---

## Task 9: Cinematic arrival animation

**Files:**
- Modify: `src/components/SuppressionVehicleLayer.tsx`

**Step 1:** For each ground entity, when it first appears (i.e. at `currentStep === deployStep`), interpolate position over `arrivalDurationSec = 30 * (timestepMinutes / 60)` from an "edge of frame" point toward its computed work-cell position.

**Step 2:** Edge-of-frame point: pick the nearest of (north, south, east, west) bounding-box edge of the fire-region camera view, offset 1 km. Same edge for all ground entities of a given step (avoids visual chaos).

**Step 3:** During arrival window, fade in alpha 0 → 1 (use `model.color = Color.WHITE.withAlpha(t)`).

**Step 4:** Aircraft: at `currentStep === deployStep + 1`, helitack flies in along a straight 5 km approach to its first orbit position over ~3 sim-sec. Tankers handled via existing drop-pass entry.

**Smoke:** verify at deployment moment: visible drive-in for ground, fade-in for all, fly-in for helo.

**Commit:**

```bash
git commit -m "feat: cinematic arrival animation"
```

---

## Task 10: Source and integrate glTF assets

**Files:**
- Create: `src/assets/models/engine.glb`, `crew.glb`, `dozer.glb`, `helitack.glb`, `tanker.glb`
- Create: `src/assets/models/CREDITS.md`

**Step 1: Acquire models**
- Search Kenney CC0 packs for engine + crew (firefighter figure).
- Search Sketchfab for "bulldozer", "UH-1 helicopter", "DC-10 air tanker" filtered by license = CC0 or CC-BY.
- Download glb. Run `npx gltf-transform optimize` on each to compress.
- Save to `src/assets/models/`.

**Step 2: Document credits**
For each CC-BY model, add an entry in `CREDITS.md`:
```markdown
- `helitack.glb` — Bell UH-1 by [Author] (CC-BY 4.0, https://sketchfab.com/...)
```

**Step 3: Wire `glbUrlForType`** in `SuppressionVehicleLayer.tsx` to import the new assets.

**Step 4: Fallback path** — If any asset is missing or licensing doesn't pan out before the demo, fall back to:
- Tanker: Cesium's bundled `Cesium_Air.glb`.
- Engine/crew/dozer/helitack: colored billboard (canvas-text emoji 🚒 / 👷 / 🚜 / 🚁) at the same position. Implement as a fallback branch in `glbUrlForType`.

**Step 5: Smoke** — verify each type renders with the right model at demo zoom.

**Commit:**

```bash
git commit -m "assets: source and integrate suppression vehicle glTF models"
```

---

## Task 11: SuppressionHUD

**Files:**
- Create: `src/components/SuppressionHUD.tsx`

**Approach:** Pure React component. Props:
```typescript
interface Props {
  history: SimulationState[];
  diags: SuppressionStepDiag[];
  config: SimulationConfig;
  suppression: SuppressionConfig;
  deployStep: number;
  endStep: number;
  currentStep: number;
  dropEvents: DropEvent[];
  bundleLabel: string;  // e.g. "Type 2"
}
```

Render the dashboard layout from the design (Section 2). Use existing fire-panel styles (`bg-white/[0.04]`, `border-white/[0.06]`, etc.).

Computations:
- `counts = perTypeCounts(...)`
- `lastDropAgo` = `currentStep - max(centerStep where centerStep <= currentStep)`, formatted as MM:SS
- `lineRate` = smoothed delta over last 5 steps; formatted as `X m/min`
- `containmentBar` = 10-char block bar, e.g. `████████░░` for 80%

When `currentStep > endStep`, freeze and show "Fire contained — HH:MM" footer using `endStep * timestepMinutes`.

**Glue test (light):** snapshot test for one canned input set.

**Commit:**

```bash
git commit -m "feat: suppression operational HUD"
```

---

## Task 12: Wire layers into App.tsx

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ImpactSection.tsx` (only if HUD lives there; otherwise mount HUD in App next to the existing replay panel)

**Step 1:** In `App.tsx`, after the existing `viewer` is established and a suppression run is loaded, compute:
```typescript
const deployStep = Math.ceil((suppression.responseDelayMin ?? 0) / config.timestepMinutes);
const endStep = history.length - 1;
const dropEvents = useMemo(() => dropScheduler(history, config, centerLat, centerLng, suppression, deployStep), [history, config, centerLat, centerLng, suppression, deployStep]);
```

**Step 2:** Mount the four new components inside the GlobeView children slot, gated on `suppression.enabled && suppressionDiags`:
```tsx
{suppression.enabled && suppressionDiags && (
  <>
    <ContainmentLineLayer viewer={viewer} state={history[currentStep]} prev={history[currentStep - 1]} config={config} centerLat={...} centerLng={...} />
    <RetardantTrailLayer viewer={viewer} dropEvents={dropEvents} currentStep={currentStep} timestepMinutes={config.timestepMinutes} />
    <SuppressionVehicleLayer viewer={viewer} history={history} prev={history[currentStep - 1]} curr={history[currentStep]} config={config} centerLat={...} centerLng={...} suppression={suppression} deployStep={deployStep} endStep={endStep} currentStep={currentStep} dropEvents={dropEvents} />
  </>
)}
```

**Step 3:** Mount `SuppressionHUD` above the Cesium canvas (top-right, below "REPLAY ACTIVE"). Pass the same props.

**Step 4:** When user toggles to "Wildfire Only" or starts a new sim, ensure all layers unmount cleanly (verify no leaked Cesium entities via dev-tools inspection).

**Smoke-test the full feature.** Acceptance gate is the 8-step manual smoke from the design.

**Commit:**

```bash
git commit -m "feat: wire suppression visualization layers + HUD into App"
```

---

## Task 13: Final smoke + acceptance

Walk through the 8-step manual smoke from the design (Section "Testing"):

1. Cupertino, With Suppression, Type 2, 30 min delay.
2. Deployment moment: ground entities fade in along approach line; aircraft fly in.
3. A tanker drop visibly passes over the fire and paints a red trail.
4. Helitack visibly orbits at altitude.
5. Cyan rim grows on the perimeter.
6. HUD numbers update each step; rate looks plausible.
7. End-of-run state matches outcome (contained / not).
8. Toggle Wildfire Only: all suppression visuals disappear; no Cesium orphans.

If any step fails, file a follow-up task; do not patch in place during the smoke.

**Commit (if any post-smoke fixes):**

```bash
git commit -m "fix: post-smoke adjustments to suppression visualization"
```

---

## After all tasks

1. Run `npm test` — all green.
2. Run `npm run build` — no TS / lint errors.
3. Use `superpowers:finishing-a-development-branch` to wrap up the branch.

## Remember
- DRY, YAGNI, TDD, frequent commits.
- All cosmetic motion (helitack orbit, tanker passes, arrival animation) is decoration — sim accounting must be untouched.
- If asset sourcing slips: ship with fallback path documented in Task 10 Step 4.
- If any unit test exposes a sim-engine bug: file separately, do not patch in this branch.
