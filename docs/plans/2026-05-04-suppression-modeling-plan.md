# Wildfire Suppression Modeling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a what-if suppression layer to the wildfire simulation. The user picks a response delay and an NWCG-aligned resource bundle; the worker runs the spread twice (baseline + suppressed); the UI visualizes the suppressed footprint, the counterfactual ghost area, fireline cells, resource markers, containment probability, area-saved, and an events timeline.

**Architecture:** Pure-function suppression module (`src/simulation/suppression.ts`) — line-construction math, containment probability, perimeter detection. Worker runs two passes sharing the same fuel/elevation/weather. New `CellState.Suppressed` lets cells become permanent firebreaks. Three new Cesium overlays mirror the existing pattern (canvas-based imagery layers + billboard collections). A `Containment` subsection in the existing `ImpactSection` plus a `SuppressionDetailModal` give the side-panel readout.

**Tech Stack:** TypeScript + React + Vitest + Cesium (existing). No new dependencies.

**Reference design:** `docs/plans/2026-05-04-suppression-modeling-design.md`

---

## Phase A — Backend / simulation engine

### Task A1: Add suppression types and resource constants

**Files:**
- Modify: `src/simulation/types.ts`
- Create: `src/simulation/suppression.ts` (skeleton only)

**Step 1: Extend `CellState` with `Suppressed`**

Open `src/simulation/types.ts`. The current declaration is:

```typescript
export const CellState = {
  Unburned: 0,
  Burning: 1,
  Burned: 2,
} as const;
```

Add `Suppressed: 3` so it becomes:

```typescript
export const CellState = {
  Unburned: 0,
  Burning: 1,
  Burned: 2,
  Suppressed: 3,
} as const;
```

**Step 2: Add the suppression-config types**

In the same file, immediately above `DEFAULT_CONFIG`, add:

```typescript
export const ResourceType = {
  Type1Crew: "Type1Crew",
  Type2Crew: "Type2Crew",
  Engine: "Engine",
  Type1Dozer: "Type1Dozer",
  Helitack: "Helitack",
  AirTanker: "AirTanker",
} as const;
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];

export interface ResourceCount {
  type: ResourceType;
  count: number;
}

export interface SuppressionConfig {
  /** Minutes from ignition until first resources arrive on scene. */
  responseDelayMin: number;
  /** Resource roster — e.g. [{type:"Type1Crew",count:3},...] */
  resources: ResourceCount[];
}

/**
 * NWCG fireline production rates and cost. Sources:
 *  - NWCG Standards for Interagency Incident Business Management
 *  - Reed & McCool (2000), Hirsch & Martell (1996)
 *
 * 1 chain = 20.117 m. Aerial ROS reduction applies to the drop swath only.
 */
export const RESOURCE_RATES: Record<
  ResourceType,
  {
    chainsPerHour: number;       // direct line construction
    rosReductionFactor?: number; // multiplier on R0 in the drop swath
    swathChains?: number;        // length of an aerial swath
    dropsPerHour?: number;       // for tankers
    retardantLineChains?: number;
    costPerHour: number;
    label: string;
  }
> = {
  [ResourceType.Type1Crew]:  { chainsPerHour: 9,  costPerHour: 4_500,  label: "Type 1 Crew" },
  [ResourceType.Type2Crew]:  { chainsPerHour: 6,  costPerHour: 3_000,  label: "Type 2 Crew" },
  [ResourceType.Engine]:     { chainsPerHour: 4,  costPerHour: 2_500,  label: "Engine" },
  [ResourceType.Type1Dozer]: { chainsPerHour: 75, costPerHour: 5_000,  label: "Type 1 Dozer" },
  [ResourceType.Helitack]:   { chainsPerHour: 0,  rosReductionFactor: 0.4, swathChains: 8, costPerHour: 15_000, label: "Helitack" },
  [ResourceType.AirTanker]:  { chainsPerHour: 0,  retardantLineChains: 50, dropsPerHour: 2, costPerHour: 35_000, label: "Air Tanker" },
};

export const SUPPRESSION_BUNDLES: Record<string, ResourceCount[]> = {
  none: [],
  initialAttack: [
    { type: ResourceType.Type2Crew, count: 1 },
    { type: ResourceType.Engine, count: 1 },
    { type: ResourceType.Helitack, count: 1 },
  ],
  type3: [
    { type: ResourceType.Type2Crew, count: 3 },
    { type: ResourceType.Engine, count: 2 },
    { type: ResourceType.Helitack, count: 2 },
  ],
  type2: [
    { type: ResourceType.Type1Crew, count: 5 },
    { type: ResourceType.Type1Dozer, count: 3 },
    { type: ResourceType.Helitack, count: 2 },
    { type: ResourceType.AirTanker, count: 1 },
  ],
  type1: [
    { type: ResourceType.Type1Crew, count: 10 },
    { type: ResourceType.Type1Dozer, count: 5 },
    { type: ResourceType.Helitack, count: 3 },
    { type: ResourceType.AirTanker, count: 2 },
  ],
};

export const CHAINS_TO_METERS = 20.117;
```

**Step 3: Create `src/simulation/suppression.ts` stub**

```typescript
/**
 * Wildfire suppression model — pure functions, no side effects.
 * Uses NWCG production rates, Hirsch-Martell delay decay, and
 * Reed-McCool containment math. See:
 * docs/plans/2026-05-04-suppression-modeling-design.md
 */
import { CHAINS_TO_METERS, type ResourceCount } from "./types";

export function totalChainsPerHour(resources: ResourceCount[]): number {
  // implemented in A3
  void resources;
  return 0;
}

export function delayDecay(delayMinutes: number): number {
  // implemented in A3
  void delayMinutes;
  return 1;
}

export function containmentProbability(
  cumulativeLineMeters: number,
  activePerimeterMeters: number,
): number {
  // implemented in A3
  void cumulativeLineMeters;
  void activePerimeterMeters;
  return 0;
}

void CHAINS_TO_METERS;
```

**Step 4: Type-check + commit**

```bash
cd /Users/mlstudio/projects/WildFireVisualization && npx tsc -b
git add src/simulation/types.ts src/simulation/suppression.ts
git commit -m "feat: scaffold suppression types, resource constants, bundles"
```

Expected: `tsc -b` succeeds with zero errors.

---

### Task A2: Write failing tests for the pure suppression functions

**Files:**
- Create: `src/simulation/__tests__/suppression.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import {
  totalChainsPerHour,
  delayDecay,
  containmentProbability,
} from "../suppression";
import { ResourceType } from "../types";

describe("totalChainsPerHour", () => {
  it("returns 0 for an empty roster", () => {
    expect(totalChainsPerHour([])).toBe(0);
  });

  it("sums per-resource rates by count", () => {
    // 3 Type-2 crews @ 6 chains/hr each = 18
    // + 1 Type-1 dozer @ 75 = 93
    const total = totalChainsPerHour([
      { type: ResourceType.Type2Crew, count: 3 },
      { type: ResourceType.Type1Dozer, count: 1 },
    ]);
    expect(total).toBe(18 + 75);
  });

  it("ignores aerial-only resources for direct line", () => {
    // Helitack and AirTanker have chainsPerHour=0; their effect is
    // modeled separately as ROS reduction / retardant.
    const total = totalChainsPerHour([
      { type: ResourceType.Helitack, count: 2 },
      { type: ResourceType.AirTanker, count: 1 },
    ]);
    expect(total).toBe(0);
  });
});

describe("delayDecay (Hirsch-Martell)", () => {
  it("returns ~1.0 for zero delay", () => {
    expect(delayDecay(0)).toBeCloseTo(1.0, 5);
  });

  it("returns ~0.5 at the characteristic time of 90 min", () => {
    // exp(-90/90) = exp(-1) ≈ 0.368
    expect(delayDecay(90)).toBeCloseTo(Math.exp(-1), 5);
  });

  it("monotonically decreases with delay", () => {
    expect(delayDecay(0)).toBeGreaterThan(delayDecay(30));
    expect(delayDecay(30)).toBeGreaterThan(delayDecay(60));
    expect(delayDecay(60)).toBeGreaterThan(delayDecay(180));
  });

  it("never goes negative or above 1", () => {
    expect(delayDecay(1000)).toBeGreaterThan(0);
    expect(delayDecay(-10)).toBeLessThanOrEqual(1);
  });
});

describe("containmentProbability (Reed-McCool)", () => {
  it("returns 0 when no line has been laid", () => {
    expect(containmentProbability(0, 5000)).toBe(0);
  });

  it("returns 0 when perimeter is 0", () => {
    // Avoid divide-by-zero — no fire => no containment metric.
    expect(containmentProbability(100, 0)).toBe(0);
  });

  it("approaches 1 as line laid >> perimeter", () => {
    expect(containmentProbability(50_000, 1_000)).toBeGreaterThan(0.99);
  });

  it("monotonically increases with line laid", () => {
    expect(containmentProbability(100, 1000)).toBeLessThan(
      containmentProbability(500, 1000),
    );
  });

  it("equals 1 - 1/e when line equals perimeter", () => {
    // P = 1 - exp(-1) = 0.632
    expect(containmentProbability(1000, 1000)).toBeCloseTo(1 - Math.exp(-1), 5);
  });
});
```

**Step 2: Run tests — they should FAIL**

```bash
cd /Users/mlstudio/projects/WildFireVisualization && npx vitest run src/simulation/__tests__/suppression.test.ts
```

Expected: most tests fail because the stubs return placeholder values.

**Step 3: Commit (red state)**

```bash
git add src/simulation/__tests__/suppression.test.ts
git commit -m "test: failing tests for suppression pure functions"
```

---

### Task A3: Implement the pure suppression functions

**Files:**
- Modify: `src/simulation/suppression.ts`

**Step 1: Replace the stubs with real implementations**

```typescript
import {
  CHAINS_TO_METERS,
  RESOURCE_RATES,
  type ResourceCount,
} from "./types";

/**
 * Total ground-line construction rate from a resource roster, in
 * chains/hr. Aerial resources (Helitack, AirTanker) contribute 0 here —
 * their effect is modeled separately as ROS reduction / retardant.
 */
export function totalChainsPerHour(resources: ResourceCount[]): number {
  let sum = 0;
  for (const { type, count } of resources) {
    sum += (RESOURCE_RATES[type]?.chainsPerHour ?? 0) * count;
  }
  return sum;
}

/**
 * Hirsch & Martell (1996) delay-decay multiplier. Effectiveness ~ exp
 * (-delay / characteristicTime). characteristicTime = 90 min is the
 * empirical "halving time" of initial-attack effectiveness.
 *
 * Returns a multiplier in (0, 1] (clamped at 1 for negative delays).
 */
export function delayDecay(delayMinutes: number): number {
  const t = Math.max(0, delayMinutes);
  return Math.exp(-t / 90);
}

/**
 * Reed & McCool (2000) simplified containment probability:
 *   P = 1 - exp(-cumulativeLine / activePerimeter)
 *
 * Both inputs in METERS. Returns 0 when the perimeter is 0 (no fire to
 * contain) to avoid divide-by-zero.
 */
export function containmentProbability(
  cumulativeLineMeters: number,
  activePerimeterMeters: number,
): number {
  if (activePerimeterMeters <= 0) return 0;
  if (cumulativeLineMeters <= 0) return 0;
  return 1 - Math.exp(-cumulativeLineMeters / activePerimeterMeters);
}

/**
 * Convenience: chains -> meters for line-length math.
 */
export function chainsToMeters(chains: number): number {
  return chains * CHAINS_TO_METERS;
}
```

**Step 2: Run the tests — should PASS**

```bash
npx vitest run src/simulation/__tests__/suppression.test.ts
```

Expected: all 12 cases green.

**Step 3: Commit**

```bash
git add src/simulation/suppression.ts
git commit -m "feat: implement Hirsch-Martell delay decay and Reed-McCool containment"
```

---

### Task A4: Add perimeter detection + line placement

**Files:**
- Modify: `src/simulation/suppression.ts`
- Modify: `src/simulation/__tests__/suppression.test.ts`

**Step 1: Append failing tests**

Add to the bottom of `suppression.test.ts`:

```typescript
import { activeFirePerimeter, pickFirelineCells } from "../suppression";
import { CellState } from "../types";
import type { GridCell } from "../types";

function mkGrid(rows: number, cols: number): GridCell[] {
  const g: GridCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.push({
        state: CellState.Unburned,
        fuel: "forest",
        elevation: 0,
        burnTimer: 0,
        lat: r,
        lng: c,
      });
    }
  }
  return g;
}

describe("activeFirePerimeter", () => {
  it("returns 0 for an all-unburned grid", () => {
    const g = mkGrid(5, 5);
    expect(activeFirePerimeter(g, 5, 50).cellCount).toBe(0);
    expect(activeFirePerimeter(g, 5, 50).meters).toBe(0);
  });

  it("counts a single burning cell as a perimeter cell with 4×cellSize meters", () => {
    const g = mkGrid(5, 5);
    g[2 * 5 + 2].state = CellState.Burning;
    const p = activeFirePerimeter(g, 5, 50);
    expect(p.cellCount).toBe(1);
    // 4 unburned-neighbor edges × 50m
    expect(p.meters).toBe(4 * 50);
  });

  it("excludes burning cells whose neighbors are all burning (interior)", () => {
    const g = mkGrid(5, 5);
    // 3x3 burning block centered at (2,2)
    for (let r = 1; r <= 3; r++) {
      for (let c = 1; c <= 3; c++) g[r * 5 + c].state = CellState.Burning;
    }
    // Only the 8 outer cells of the 3x3 are perimeter; the 1 inner cell
    // has all-burning neighbors (8-connectivity).
    expect(activeFirePerimeter(g, 5, 50).cellCount).toBe(8);
  });
});

describe("pickFirelineCells", () => {
  it("returns no more than the requested number of cells", () => {
    const g = mkGrid(5, 5);
    g[12].state = CellState.Burning; // single perimeter cell
    const picked = pickFirelineCells(g, 5, 100, 0);
    expect(picked.length).toBeLessThanOrEqual(100);
    expect(picked.length).toBeGreaterThanOrEqual(0);
  });

  it("only returns cells that are currently Burning", () => {
    const g = mkGrid(5, 5);
    g[12].state = CellState.Burning;
    g[7].state = CellState.Burning;
    const picked = pickFirelineCells(g, 5, 5, 0);
    for (const idx of picked) expect(g[idx].state).toBe(CellState.Burning);
  });
});
```

**Step 2: Implement the helpers**

Append to `src/simulation/suppression.ts`:

```typescript
import {
  CellState,
  type GridCell,
} from "./types";

const NEIGHBOR_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/**
 * Compute the active fire perimeter — the set of currently-Burning cells
 * that have at least one Unburned neighbor (8-connectivity). Returns
 * cell count and approximate length in meters (each perimeter cell
 * contributes ~edges_facing_unburned × cellSize).
 *
 * Used as the denominator in the Reed-McCool containment formula.
 */
export function activeFirePerimeter(
  grid: GridCell[],
  gridSize: number,
  cellSizeMeters: number,
): { cellCount: number; meters: number } {
  let cellCount = 0;
  let totalEdges = 0;
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const cell = grid[row * gridSize + col];
      if (cell.state !== CellState.Burning) continue;
      let edgesFacingUnburned = 0;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        // Only count the 4 cardinal edges for length, not diagonals.
        if (dr !== 0 && dc !== 0) continue;
        const nr = row + dr,
          nc = col + dc;
        if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) {
          edgesFacingUnburned++; // edge of grid acts as unburned
          continue;
        }
        if (grid[nr * gridSize + nc].state === CellState.Unburned) {
          edgesFacingUnburned++;
        }
      }
      // 8-connectivity for "is perimeter" but length sums only cardinals.
      let hasAnyUnburnedNeighbor = false;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const nr = row + dr,
          nc = col + dc;
        if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) {
          hasAnyUnburnedNeighbor = true;
          break;
        }
        if (grid[nr * gridSize + nc].state === CellState.Unburned) {
          hasAnyUnburnedNeighbor = true;
          break;
        }
      }
      if (hasAnyUnburnedNeighbor) {
        cellCount++;
        totalEdges += edgesFacingUnburned;
      }
    }
  }
  return { cellCount, meters: totalEdges * cellSizeMeters };
}

/**
 * Pick up to maxCells perimeter cells that should become fireline this
 * step. Currently picks the burning perimeter cells with the LARGEST
 * downwind alignment (head of the fire) — that's where the operational
 * priority is. windDirectionDeg is the direction wind is FROM
 * (0° = north).
 *
 * Returns indices into the grid. Caller flips them to Suppressed.
 */
export function pickFirelineCells(
  grid: GridCell[],
  gridSize: number,
  maxCells: number,
  windDirectionDeg: number,
): number[] {
  if (maxCells <= 0) return [];

  // Wind blows FROM windDirectionDeg TOWARD windDirectionDeg+180.
  // The "head" of the fire is the side facing windward — the cells the
  // fire is racing toward. We score each perimeter cell by how aligned
  // its position is with the head direction relative to the centroid.
  let centroidR = 0,
    centroidC = 0,
    burningCount = 0;
  const candidates: number[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      const cell = grid[idx];
      if (cell.state !== CellState.Burning) continue;
      centroidR += row;
      centroidC += col;
      burningCount++;
      let isPerimeter = false;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const nr = row + dr,
          nc = col + dc;
        if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) {
          isPerimeter = true;
          break;
        }
        if (grid[nr * gridSize + nc].state === CellState.Unburned) {
          isPerimeter = true;
          break;
        }
      }
      if (isPerimeter) candidates.push(idx);
    }
  }
  if (candidates.length === 0 || burningCount === 0) return [];
  centroidR /= burningCount;
  centroidC /= burningCount;

  // Head direction unit vector — wind blows toward (windDir+180).
  const headRad = ((windDirectionDeg + 180) * Math.PI) / 180;
  const headDr = -Math.cos(headRad); // rows increase southward in our grid
  const headDc = Math.sin(headRad);

  const scored = candidates.map((idx) => {
    const row = Math.floor(idx / gridSize);
    const col = idx % gridSize;
    const dr = row - centroidR;
    const dc = col - centroidC;
    const len = Math.sqrt(dr * dr + dc * dc) || 1;
    const alignment = (dr * headDr + dc * headDc) / len;
    return { idx, alignment };
  });
  scored.sort((a, b) => b.alignment - a.alignment);
  return scored.slice(0, maxCells).map((s) => s.idx);
}
```

**Step 3: Run tests, expect PASS**

```bash
npx vitest run src/simulation/__tests__/suppression.test.ts
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add src/simulation/suppression.ts src/simulation/__tests__/suppression.test.ts
git commit -m "feat: perimeter detection and head-aligned fireline picking"
```

---

### Task A5: Make `simulateStep` skip Suppressed cells

**Files:**
- Modify: `src/simulation/spread.ts`

**Step 1: Add the Suppressed check in the spread loop**

Open `src/simulation/spread.ts`. Find the per-neighbor block where the existing water-skip lives (around line 200):

```typescript
if (neighbor.state !== CellState.Unburned) continue;
if (newGrid[nIdx].state === CellState.Burning) continue;
if (neighbor.fuel === "water") continue;
```

The `state !== Unburned` check ALREADY excludes Suppressed cells (state=3). But we still want to be defensive about *Burning* cells in the OUTER loop being suppressed — a Suppressed cell shouldn't continue spreading.

Find the outer `if (cell.state === CellState.Burning)` block (around line 197). Above it, add:

```typescript
// Cells already converted to fireline / Suppressed neither burn longer
// nor spread, even if they were on fire when the suppression module
// flipped them. Skip the entire body.
if (cell.state === CellState.Suppressed) continue;
```

The closest existing structure is: `for (let row=...) for (let col=...) { ... if (cell.state === Burning) {...spread...} }`. Insert the skip just inside the inner loop, before any state-handling.

**Step 2: Run sim tests**

```bash
npx vitest run src/simulation/__tests__/
```

Expected: all 18 (16 prior + 2 new from suppression) tests pass. No spread tests should regress.

**Step 3: Commit**

```bash
git add src/simulation/spread.ts
git commit -m "feat: simulateStep skips Suppressed cells"
```

---

### Task A6: Modify `runSimulation` for the dual-pass

**Files:**
- Modify: `src/simulation/runner.ts`
- Modify: `src/simulation/types.ts`

**Step 1: Add suppression diagnostics types**

In `types.ts`, after `SimulationState`:

```typescript
export interface SuppressionStepDiag {
  step: number;
  cumulativeLineMeters: number;
  activePerimeterMeters: number;
  containmentProbability: number; // 0..1
  resourcesActive: number;        // 0 before delay, total count after
  newFirelineCells: number;
}

export interface SuppressionResult {
  history: SimulationState[];
  diags: SuppressionStepDiag[];
}

export interface DualSimulationResult {
  config: SimulationConfig;
  baseline: SimulationState[];
  suppressed?: SuppressionResult;
}
```

**Step 2: Refactor `runSimulation` to accept `suppressionConfig`**

Open `src/simulation/runner.ts`. Replace the function with:

```typescript
import {
  CellState,
  type FuelType,
  type SimulationConfig,
  type SuppressionConfig,
  type SuppressionResult,
  type SimulationState,
  type GridCell,
  type DualSimulationResult,
} from "./types";
import { createGrid, igniteCell } from "./grid";
import { simulateStep } from "./spread";
import {
  activeFirePerimeter,
  pickFirelineCells,
  totalChainsPerHour,
  delayDecay,
  chainsToMeters,
  containmentProbability,
} from "./suppression";

function snapshotGrid(grid: GridCell[], gridSize: number): Uint8Array {
  const snapshot = new Uint8Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) snapshot[i] = grid[i].state;
  return snapshot;
}

function runOnePass(
  config: SimulationConfig,
  igniteRow: number,
  igniteCol: number,
  elevationFn: (lat: number, lng: number) => number,
  maxSteps: number,
  centerLat: number,
  centerLng: number,
  fuelMap: FuelType[] | undefined,
  elevationMap: Float32Array | undefined,
  suppression: SuppressionConfig | undefined,
): { history: SimulationState[]; diags: SuppressionStepDiag[] } {
  let grid = createGrid(config, centerLat, centerLng, elevationFn, fuelMap, elevationMap);
  igniteCell(grid, igniteRow, igniteCol, config.gridSize);
  const history: SimulationState[] = [
    { grid: snapshotGrid(grid, config.gridSize), timestep: 0 },
  ];
  const diags: SuppressionStepDiag[] = [];
  let cumulativeChains = 0;

  for (let step = 1; step <= maxSteps; step++) {
    grid = simulateStep(grid, config, step);

    if (suppression && suppression.resources.length > 0) {
      const elapsedMin = step * config.timestepMinutes;
      const onScene = elapsedMin >= suppression.responseDelayMin;
      const stepChainsBudget = onScene
        ? totalChainsPerHour(suppression.resources) *
          (config.timestepMinutes / 60) *
          delayDecay(suppression.responseDelayMin)
        : 0;
      const cellsBudget = Math.floor(
        chainsToMeters(stepChainsBudget) / config.cellSizeMeters,
      );
      const picked = onScene
        ? pickFirelineCells(grid, config.gridSize, cellsBudget, config.windDirection)
        : [];
      for (const idx of picked) grid[idx].state = CellState.Suppressed;
      cumulativeChains += stepChainsBudget;

      const perim = activeFirePerimeter(grid, config.gridSize, config.cellSizeMeters);
      diags.push({
        step,
        cumulativeLineMeters: chainsToMeters(cumulativeChains),
        activePerimeterMeters: perim.meters,
        containmentProbability: containmentProbability(
          chainsToMeters(cumulativeChains),
          perim.meters,
        ),
        resourcesActive: onScene
          ? suppression.resources.reduce((s, r) => s + r.count, 0)
          : 0,
        newFirelineCells: picked.length,
      });
    }

    history.push({ grid: snapshotGrid(grid, config.gridSize), timestep: step });

    const hasBurning = grid.some((c) => c.state === CellState.Burning);
    if (!hasBurning) break;
  }
  return { history, diags };
}

import type { SuppressionStepDiag } from "./types";

export function runSimulation(
  config: SimulationConfig,
  igniteRow: number,
  igniteCol: number,
  elevationFn: (lat: number, lng: number) => number,
  maxSteps: number,
  centerLat = 0,
  centerLng = 0,
  fuelMap?: FuelType[],
  elevationMap?: Float32Array,
  suppression?: SuppressionConfig,
): DualSimulationResult {
  const baseline = runOnePass(
    config, igniteRow, igniteCol, elevationFn, maxSteps,
    centerLat, centerLng, fuelMap, elevationMap, undefined,
  ).history;

  const suppressed: SuppressionResult | undefined =
    suppression && suppression.resources.length > 0
      ? runOnePass(
          config, igniteRow, igniteCol, elevationFn, maxSteps,
          centerLat, centerLng, fuelMap, elevationMap, suppression,
        )
      : undefined;

  return { config, baseline, suppressed };
}
```

**Step 3: Run tests**

```bash
npx vitest run src/simulation/
npx tsc -b
```

Expected: existing tests pass; type-check clean.

**Step 4: Commit**

```bash
git add src/simulation/runner.ts src/simulation/types.ts
git commit -m "feat: dual-pass runSimulation (baseline + suppressed) with diagnostics"
```

---

### Task A7: Worker accepts `suppressionConfig` and returns dual histories

**Files:**
- Modify: `src/simulation/worker.ts`
- Modify: `src/simulation/useSimulation.ts`

**Step 1: Worker types**

Open `src/simulation/worker.ts`. Update `WorkerRequest` to include `suppressionConfig?: SuppressionConfig`. Update `WorkerResponse` to carry both buffers:

```typescript
import type { SimulationConfig, FuelType, SuppressionConfig, SuppressionStepDiag } from "./types";

export interface WorkerRequest {
  type: "run" | "loadModel";
  config?: SimulationConfig;
  igniteRow?: number;
  igniteCol?: number;
  maxSteps?: number;
  centerLat?: number;
  centerLng?: number;
  fuelMap?: FuelType[];
  elevationMap?: Float32Array;
  suppressionConfig?: SuppressionConfig;
  modelJson?: unknown;
  weatherData?: { tempMean: number; tempMax: number; precipitation: number; cumulativePrecip: number };
}

export interface WorkerResponse {
  type: "complete" | "error" | "modelLoaded";
  step: number;
  baselineBuffer?: ArrayBuffer;
  suppressedBuffer?: ArrayBuffer;
  baselineLength?: number;
  suppressedLength?: number;
  suppressionDiags?: SuppressionStepDiag[];
  gridSize?: number;
  error?: string;
}
```

**Step 2: Update the worker `onmessage` to thread `suppressionConfig` through**

Replace the run-handler block:

```typescript
const { config, igniteRow, igniteCol, maxSteps, centerLat, centerLng, fuelMap, elevationMap, weatherData, suppressionConfig } = e.data;

const enrichedConfig = {
  ...config!,
  tempMean: weatherData?.tempMean ?? 25,
  tempMax: weatherData?.tempMax ?? 35,
  precipitation: weatherData?.precipitation ?? 0,
  cumulativePrecip: weatherData?.cumulativePrecip ?? 0,
};

const result = runSimulation(
  enrichedConfig, igniteRow!, igniteCol!, () => 0, maxSteps!,
  centerLat!, centerLng!, fuelMap, elevationMap, suppressionConfig,
);

const gridCells = config!.gridSize * config!.gridSize;
const packBuffer = (history: typeof result.baseline): ArrayBuffer => {
  const buf = new Uint8Array(history.length * gridCells);
  for (let i = 0; i < history.length; i++) buf.set(history[i].grid, i * gridCells);
  return buf.buffer;
};
const baselineBuffer = packBuffer(result.baseline);
const suppressedBuffer = result.suppressed ? packBuffer(result.suppressed.history) : undefined;

const response: WorkerResponse = {
  type: "complete",
  step: result.baseline.length,
  baselineBuffer,
  baselineLength: result.baseline.length,
  suppressedBuffer,
  suppressedLength: result.suppressed?.history.length,
  suppressionDiags: result.suppressed?.diags,
  gridSize: config!.gridSize,
};

const transfer: ArrayBuffer[] = [baselineBuffer];
if (suppressedBuffer) transfer.push(suppressedBuffer);
self.postMessage(response, { transfer });
```

**Step 3: Update `useSimulation` to expose dual histories**

Open `src/simulation/useSimulation.ts`. Add:

```typescript
import type { SuppressionConfig, SuppressionStepDiag } from "./types";

interface DualHistory {
  baseline: SimulationState[];
  suppressed?: SimulationState[];
  diags?: SuppressionStepDiag[];
}
```

Change the return type's `history` field to `DualHistory`:

```typescript
interface UseSimulationReturn {
  history: DualHistory;
  isRunning: boolean;
  startSimulation: (
    config: SimulationConfig,
    igniteRow: number,
    igniteCol: number,
    centerLat: number,
    centerLng: number,
    fuelMap?: FuelType[],
    weatherData?: { tempMean: number; tempMax: number; precipitation: number; cumulativePrecip: number },
    maxSteps?: number,
    elevationMap?: Float32Array,
    suppressionConfig?: SuppressionConfig,
  ) => void;
  reset: () => void;
}
```

Update the `worker.onmessage` complete-handler to unpack the new buffers:

```typescript
worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  if (e.data.type === "complete" && e.data.baselineBuffer) {
    const { baselineBuffer, baselineLength, suppressedBuffer, suppressedLength, suppressionDiags, gridSize } = e.data;
    const gridCells = gridSize! * gridSize!;
    const baseline = new Uint8Array(baselineBuffer);
    const baseStates: SimulationState[] = [];
    for (let i = 0; i < baselineLength!; i++) {
      baseStates.push({ grid: baseline.slice(i * gridCells, (i + 1) * gridCells), timestep: i });
    }
    let suppressedStates: SimulationState[] | undefined;
    if (suppressedBuffer && suppressedLength) {
      const supp = new Uint8Array(suppressedBuffer);
      suppressedStates = [];
      for (let i = 0; i < suppressedLength; i++) {
        suppressedStates.push({ grid: supp.slice(i * gridCells, (i + 1) * gridCells), timestep: i });
      }
    }
    setHistory({ baseline: baseStates, suppressed: suppressedStates, diags: suppressionDiags });
    setIsRunning(false);
  }
  // ...error handling unchanged...
};
```

The state initializer also changes: `useState<DualHistory>({ baseline: [] })`.

The `postMessage` payload now includes `suppressionConfig`.

**Step 4: Type-check + commit**

```bash
npx tsc -b
git add src/simulation/worker.ts src/simulation/useSimulation.ts
git commit -m "feat: worker + useSimulation thread suppression config and dual history"
```

This will likely surface compile errors in `App.tsx` (it reads `history` as an array). That's expected — Task B1 fixes them.

---

## Phase B — UI inputs (panel)

### Task B1: Update App.tsx to consume the new `DualHistory`

**Files:**
- Modify: `src/App.tsx`

**Step 1: Adapt to the new return shape**

Throughout `App.tsx`, replace `history` (as array) with `history.baseline` for the existing visualizations. The active visualization stays on the BASELINE for now — Phase C wires the suppressed view.

Find the existing `useEffect` that calls `convertSimulationToFire`:

```typescript
useEffect(() => {
  if (appMode !== "simulation") return;
  if (history.length === 0) return;
  // ...
}, [history, ...]);
```

Replace `history.length === 0` with `history.baseline.length === 0`, and pass `history.baseline` to `convertSimulationToFire`. Same for any other reads.

**Step 2: Build + tests**

```bash
npx tsc -b
npx vitest run src/simulation/
```

Expected: clean build, 19 tests pass (16 prior + 3 suppression).

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "refactor: App reads history.baseline; preserves existing visualization"
```

---

### Task B2: Create `SuppressionInputs` component

**Files:**
- Create: `src/components/SuppressionInputs.tsx`

**Step 1: Write the component**

```typescript
import { useState } from "react";
import {
  ResourceType,
  RESOURCE_RATES,
  SUPPRESSION_BUNDLES,
  type ResourceCount,
} from "../simulation/types";
import { totalChainsPerHour, chainsToMeters } from "../simulation/suppression";

const BUNDLE_LABELS: Record<keyof typeof SUPPRESSION_BUNDLES, string> = {
  none: "None",
  initialAttack: "Initial Attack",
  type3: "Type 3",
  type2: "Type 2",
  type1: "Type 1 (max)",
} as never;

interface SuppressionInputsProps {
  responseDelayMin: number;
  resources: ResourceCount[];
  onChange: (delay: number, resources: ResourceCount[]) => void;
}

export default function SuppressionInputs({
  responseDelayMin,
  resources,
  onChange,
}: SuppressionInputsProps) {
  const [bundleKey, setBundleKey] = useState<string>("initialAttack");
  const [showCustom, setShowCustom] = useState(false);

  const selectBundle = (key: string) => {
    setBundleKey(key);
    if (key !== "custom") {
      const preset = SUPPRESSION_BUNDLES[key as keyof typeof SUPPRESSION_BUNDLES];
      onChange(responseDelayMin, [...preset]);
      setShowCustom(false);
    } else {
      setShowCustom(true);
    }
  };

  const updateResource = (type: ResourceType, count: number) => {
    const next = resources.filter((r) => r.type !== type);
    if (count > 0) next.push({ type, count });
    onChange(responseDelayMin, next);
  };

  const chainsHr = totalChainsPerHour(resources);
  const lineMetersHr = chainsToMeters(chainsHr);

  return (
    <div>
      <div
        className="text-label font-medium tracking-[0.15em] uppercase mb-1.5"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        Suppression Response
      </div>

      {/* Response delay slider */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-micro text-gray-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Response delay
          </span>
          <span className="text-sm text-amber-400 tabular-nums" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {responseDelayMin} min
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={180}
          step={5}
          value={responseDelayMin}
          onChange={(e) => onChange(parseInt(e.target.value, 10), resources)}
          className="w-full accent-amber-500"
        />
      </div>

      {/* Bundle selector */}
      <div className="mb-2">
        <select
          value={bundleKey}
          onChange={(e) => selectBundle(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5
            text-sm text-gray-200 outline-none focus:border-amber-500/40"
        >
          {Object.entries(SUPPRESSION_BUNDLES).map(([key]) => (
            <option key={key} value={key}>{BUNDLE_LABELS[key as keyof typeof BUNDLE_LABELS] ?? key}</option>
          ))}
          <option value="custom">Custom...</option>
        </select>
      </div>

      {/* Custom roster (when shown) */}
      {showCustom && (
        <div className="space-y-1.5 pl-2 border-l border-amber-500/20 mb-3">
          {Object.values(ResourceType).map((rt) => {
            const cur = resources.find((r) => r.type === rt)?.count ?? 0;
            const meta = RESOURCE_RATES[rt];
            return (
              <div key={rt} className="flex items-center justify-between text-sm">
                <span className="text-gray-300">
                  {meta.label}
                  <span className="text-micro text-gray-500 ml-1">
                    ({meta.chainsPerHour > 0 ? `${meta.chainsPerHour} ch/hr` : "aerial"})
                  </span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={cur}
                  onChange={(e) => updateResource(rt, Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-12 bg-white/[0.04] border border-white/[0.06] rounded text-center
                    text-sm text-gray-200 outline-none focus:border-amber-500/40"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Estimated production readout */}
      <div className="text-micro text-gray-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        Estimated production: {chainsHr} chains/hr ({Math.round(lineMetersHr)} m/hr)
      </div>
    </div>
  );
}
```

**Step 2: Type-check**

```bash
npx tsc -b
```

Expected: clean.

**Step 3: Commit**

```bash
git add src/components/SuppressionInputs.tsx
git commit -m "feat: SuppressionInputs panel control (delay slider + bundle dropdown)"
```

---

### Task B3: Wire `SuppressionInputs` into `ControlPanel`

**Files:**
- Modify: `src/components/ControlPanel.tsx`

**Step 1: Add a new prop**

```typescript
interface ControlPanelProps {
  // ...existing props...
  suppressionDelay?: number;
  suppressionResources?: ResourceCount[];
  onSuppressionChange?: (delay: number, resources: ResourceCount[]) => void;
}
```

Import:

```typescript
import SuppressionInputs from "./SuppressionInputs";
import type { ResourceCount } from "../simulation/types";
```

**Step 2: Render in Simulate mode**

Inside the Simulate-tab content, AFTER the Weather Source block, add:

```tsx
{onSuppressionChange && suppressionResources !== undefined && suppressionDelay !== undefined && (
  <SuppressionInputs
    responseDelayMin={suppressionDelay}
    resources={suppressionResources}
    onChange={onSuppressionChange}
  />
)}
```

**Step 3: Commit**

```bash
git add src/components/ControlPanel.tsx
git commit -m "feat: ControlPanel hosts SuppressionInputs in simulate mode"
```

---

### Task B4: Hold suppression state in App.tsx and thread to worker

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add state**

```typescript
import { SUPPRESSION_BUNDLES, type ResourceCount } from "./simulation/types";

// Inside App():
const [suppressionDelay, setSuppressionDelay] = useState(30);
const [suppressionResources, setSuppressionResources] = useState<ResourceCount[]>(
  SUPPRESSION_BUNDLES.initialAttack,
);

const handleSuppressionChange = useCallback(
  (delay: number, resources: ResourceCount[]) => {
    setSuppressionDelay(delay);
    setSuppressionResources(resources);
  },
  [],
);
```

**Step 2: Pass to ControlPanel**

```tsx
<ControlPanel
  // ...existing props...
  suppressionDelay={suppressionDelay}
  suppressionResources={suppressionResources}
  onSuppressionChange={handleSuppressionChange}
  // ...
/>
```

**Step 3: Pass to startSimulation in `handleStartWildfire`**

Find the `startSimulation(config, center, center, lat, lng, fuelMap, ...)` call and add the suppression config as the last argument:

```typescript
startSimulation(
  config, center, center, lat, lng, fuelMap,
  { tempMean: weather.temperature, tempMax: weather.temperature + 5, precipitation: 0, cumulativePrecip: 0 },
  undefined, elevationMap,
  { responseDelayMin: suppressionDelay, resources: suppressionResources },
);
```

**Step 4: Reset to default in `fullReset`**

In the `fullReset` callback, add:

```typescript
setSuppressionDelay(30);
setSuppressionResources(SUPPRESSION_BUNDLES.initialAttack);
```

**Step 5: Type-check + commit**

```bash
npx tsc -b
git add src/App.tsx
git commit -m "feat: App holds suppression state and passes to worker"
```

---

## Phase C — Map visualization

### Task C1: `FirelineOverlay` component

**Files:**
- Create: `src/components/FirelineOverlay.tsx`

**Step 1: Write the component**

Mirror the structure of `WaterOverlay`. It draws cells with state=Suppressed in dark amber.

```typescript
import { useEffect, useRef } from "react";
import {
  SingleTileImageryProvider,
  Rectangle,
  ImageryLayer,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import { CellState, type SimulationConfig } from "../simulation/types";

interface FirelineOverlayProps {
  /** A snapshot of the suppressed run's grid at the current step. */
  gridSnapshot: Uint8Array | null;
  centerLat: number;
  centerLng: number;
  config: SimulationConfig;
  viewer: CesiumViewer | null;
  alpha?: number;
}

export default function FirelineOverlay({
  gridSnapshot,
  centerLat,
  centerLng,
  config,
  viewer,
  alpha = 0.8,
}: FirelineOverlayProps) {
  const layerRef = useRef<ImageryLayer | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !gridSnapshot) return;

    const { gridSize, cellSizeMeters } = config;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
    const halfGrid = gridSize / 2;
    const halfLat = (halfGrid * cellSizeMeters) / metersPerDegreeLat;
    const halfLng = (halfGrid * cellSizeMeters) / metersPerDegreeLng;

    const canvas = document.createElement("canvas");
    canvas.width = gridSize;
    canvas.height = gridSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imgData = ctx.createImageData(gridSize, gridSize);
    const px = imgData.data;

    let count = 0;
    for (let row = 0; row < gridSize; row++) {
      const canvasRow = gridSize - 1 - row;
      for (let col = 0; col < gridSize; col++) {
        if (gridSnapshot[row * gridSize + col] !== CellState.Suppressed) continue;
        count++;
        const i = (canvasRow * gridSize + col) * 4;
        px[i] = 124;     // dark amber R
        px[i + 1] = 45;  // G
        px[i + 2] = 18;  // B
        px[i + 3] = 255;
      }
    }
    if (count === 0) return;
    ctx.putImageData(imgData, 0, 0);

    let cancelled = false;
    let createdLayer: ImageryLayer | null = null;

    SingleTileImageryProvider.fromUrl(canvas.toDataURL("image/png"), {
      rectangle: Rectangle.fromDegrees(
        centerLng - halfLng, centerLat - halfLat,
        centerLng + halfLng, centerLat + halfLat,
      ),
    }).then((provider) => {
      if (cancelled || !viewer || viewer.isDestroyed()) return;
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = alpha;
      layerRef.current = layer;
      createdLayer = layer;
    }).catch((err) => console.warn("FirelineOverlay failed:", err));

    return () => {
      cancelled = true;
      const layer = layerRef.current ?? createdLayer;
      if (layer && viewer && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layer);
      }
      layerRef.current = null;
    };
  }, [viewer, gridSnapshot, centerLat, centerLng, config, alpha]);

  return null;
}
```

**Step 2: Build, commit**

```bash
npx tsc -b
git add src/components/FirelineOverlay.tsx
git commit -m "feat: FirelineOverlay renders Suppressed cells as dark-amber stripes"
```

---

### Task C2: `GhostFireOverlay` component

**Files:**
- Create: `src/components/GhostFireOverlay.tsx`

**Step 1: Write it**

Same shape as FirelineOverlay, but takes BOTH the baseline snapshot and the suppressed snapshot, and paints translucent red where baseline = Burning/Burned but suppressed != Burning/Burned/Suppressed.

```typescript
import { useEffect, useRef } from "react";
import {
  SingleTileImageryProvider,
  Rectangle,
  ImageryLayer,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import { CellState, type SimulationConfig } from "../simulation/types";

interface GhostFireOverlayProps {
  baselineSnapshot: Uint8Array | null;
  suppressedSnapshot: Uint8Array | null;
  centerLat: number;
  centerLng: number;
  config: SimulationConfig;
  viewer: CesiumViewer | null;
  alpha?: number;
}

const burnedLike = (s: number) =>
  s === CellState.Burning || s === CellState.Burned;

export default function GhostFireOverlay({
  baselineSnapshot,
  suppressedSnapshot,
  centerLat,
  centerLng,
  config,
  viewer,
  alpha = 0.25,
}: GhostFireOverlayProps) {
  const layerRef = useRef<ImageryLayer | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !baselineSnapshot || !suppressedSnapshot) return;

    const { gridSize, cellSizeMeters } = config;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
    const halfGrid = gridSize / 2;
    const halfLat = (halfGrid * cellSizeMeters) / metersPerDegreeLat;
    const halfLng = (halfGrid * cellSizeMeters) / metersPerDegreeLng;

    const canvas = document.createElement("canvas");
    canvas.width = gridSize;
    canvas.height = gridSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imgData = ctx.createImageData(gridSize, gridSize);
    const px = imgData.data;

    let count = 0;
    for (let row = 0; row < gridSize; row++) {
      const canvasRow = gridSize - 1 - row;
      for (let col = 0; col < gridSize; col++) {
        const idx = row * gridSize + col;
        if (!burnedLike(baselineSnapshot[idx])) continue;
        if (burnedLike(suppressedSnapshot[idx])) continue;
        if (suppressedSnapshot[idx] === CellState.Suppressed) continue;
        count++;
        const i = (canvasRow * gridSize + col) * 4;
        px[i] = 220;   // counterfactual red
        px[i + 1] = 60;
        px[i + 2] = 30;
        px[i + 3] = 255;
      }
    }
    if (count === 0) return;
    ctx.putImageData(imgData, 0, 0);

    let cancelled = false;
    let createdLayer: ImageryLayer | null = null;

    SingleTileImageryProvider.fromUrl(canvas.toDataURL("image/png"), {
      rectangle: Rectangle.fromDegrees(
        centerLng - halfLng, centerLat - halfLat,
        centerLng + halfLng, centerLat + halfLat,
      ),
    }).then((provider) => {
      if (cancelled || !viewer || viewer.isDestroyed()) return;
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = alpha;
      layerRef.current = layer;
      createdLayer = layer;
    }).catch((err) => console.warn("GhostFireOverlay failed:", err));

    return () => {
      cancelled = true;
      const layer = layerRef.current ?? createdLayer;
      if (layer && viewer && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layer);
      }
      layerRef.current = null;
    };
  }, [viewer, baselineSnapshot, suppressedSnapshot, centerLat, centerLng, config, alpha]);

  return null;
}
```

**Step 2: Commit**

```bash
git add src/components/GhostFireOverlay.tsx
git commit -m "feat: GhostFireOverlay shows counterfactual area saved by suppression"
```

---

### Task C3: Wire both new overlays into App.tsx

**Files:**
- Modify: `src/App.tsx`

**Step 1: Render conditionally**

Add the imports:

```typescript
import FirelineOverlay from "./components/FirelineOverlay";
import GhostFireOverlay from "./components/GhostFireOverlay";
```

Compute the active snapshots in the render body (above the JSX return):

```typescript
const baselineSnapshot =
  history.baseline.length > 0
    ? history.baseline[Math.min(currentStep, history.baseline.length - 1)].grid
    : null;
const suppressedSnapshot =
  history.suppressed && history.suppressed.length > 0
    ? history.suppressed[Math.min(currentStep, history.suppressed.length - 1)].grid
    : null;
```

In the JSX, after the existing `WaterOverlay`, add:

```tsx
{suppressedSnapshot && ignitionPoint && (
  <FirelineOverlay
    key={`fireline-${simKey}`}
    gridSnapshot={suppressedSnapshot}
    centerLat={ignitionPoint.lat}
    centerLng={ignitionPoint.lng}
    config={activeConfig}
    viewer={viewerRef.current}
  />
)}

{baselineSnapshot && suppressedSnapshot && ignitionPoint && (
  <GhostFireOverlay
    key={`ghost-${simKey}`}
    baselineSnapshot={baselineSnapshot}
    suppressedSnapshot={suppressedSnapshot}
    centerLat={ignitionPoint.lat}
    centerLng={ignitionPoint.lng}
    config={activeConfig}
    viewer={viewerRef.current}
  />
)}
```

**Step 2: Type-check + commit**

```bash
npx tsc -b
git add src/App.tsx
git commit -m "feat: render Fireline and Ghost overlays for suppressed runs"
```

---

### Task C4: Switch active fire viz to suppressed history

**Files:**
- Modify: `src/App.tsx`

**Step 1: Drive `convertSimulationToFire` from suppressed history when present**

In the `useEffect` that builds `activeFire`:

```typescript
useEffect(() => {
  if (appMode !== "simulation") return;
  const active = history.suppressed && history.suppressed.length > 0 ? history.suppressed : history.baseline;
  if (active.length === 0) return;
  if (!ignitionPoint) return;
  const fire = convertSimulationToFire(
    active, activeConfig, ignitionPoint.lat, ignitionPoint.lng,
    activeOriginDate ?? undefined,
  );
  setActiveFire(fire);
  setAutoPlay(true);
}, [history, appMode, ignitionPoint, activeConfig, activeOriginDate]);
```

**Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: animate suppressed history as the foreground fire"
```

---

## Phase D — Stats panel

### Task D1: Containment subsection in `ImpactSection`

**Files:**
- Modify: `src/components/ImpactSection.tsx`
- Modify: `src/App.tsx` (passes `suppressionDiags` and `baselineHistory` to ImpactSection)

**Step 1: Pass diags through**

In `App.tsx`, when rendering ControlPanel/ImpactSection, also pass:

```typescript
<ControlPanel
  // ...
  suppressionDiags={history.diags}
  baselineHistory={history.baseline}
  suppressedHistory={history.suppressed}
/>
```

ControlPanel forwards to ImpactSection. Add the props to both interfaces.

**Step 2: Compute containment metrics in ImpactSection**

Add before the JSX return:

```typescript
const diag = props.suppressionDiags && props.suppressionDiags.length > 0
  ? props.suppressionDiags[Math.min(currentFrame - 1, props.suppressionDiags.length - 1)]
  : undefined;

// Approx area saved using cells that differ between baseline and suppressed
let savedHa: number | null = null;
if (props.baselineHistory && props.suppressedHistory && currentFrame > 0) {
  const b = props.baselineHistory[Math.min(currentFrame, props.baselineHistory.length - 1)].grid;
  const s = props.suppressedHistory[Math.min(currentFrame, props.suppressedHistory.length - 1)].grid;
  let savedCells = 0;
  for (let i = 0; i < b.length; i++) {
    const burned = b[i] === 1 || b[i] === 2;
    const sBurned = s[i] === 1 || s[i] === 2;
    if (burned && !sBurned) savedCells++;
  }
  // Each cell = 50m × 50m = 0.25 ha
  savedHa = savedCells * 0.25;
}
```

Add a new section above the existing Emissions block:

```tsx
{diag && (
  <div className="border-t border-white/[0.04] pt-3 space-y-1.5">
    <div className="text-label font-medium tracking-[0.15em] uppercase mb-1"
      style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}>
      Containment
    </div>
    <Row label="P(contained)" value={`${(diag.containmentProbability * 100).toFixed(0)}%`} accent />
    <Row label="Line laid" value={`${(diag.cumulativeLineMeters / 1000).toFixed(1)} km`} />
    <Row label="Active perimeter" value={`${(diag.activePerimeterMeters / 1000).toFixed(1)} km`} />
    <Row label="Resources on scene" value={`${diag.resourcesActive}`} />
    {savedHa !== null && (
      <Row label="Area saved vs baseline" value={`${savedHa.toFixed(0)} ha`} accent />
    )}
  </div>
)}
```

(Implement a tiny `Row` helper inside the component that renders a flex row with monospace label/value, similar to the existing emission cards.)

**Step 3: Commit**

```bash
git add src/components/ImpactSection.tsx src/App.tsx src/components/ControlPanel.tsx
git commit -m "feat: Containment subsection in ImpactSection (P, line laid, area saved)"
```

---

### Task D2: `SuppressionDetailModal` (optional Phase 2 — keep simple for now)

**Files:** none

Skip in v1. The Containment subsection from D1 is enough for the minimum viable feature. The detail-modal pattern from `EmissionsDetailModal` can be reused later if the user wants charts.

---

## Phase E — Verification

### Task E1: Full test + type-check sweep

```bash
cd /Users/mlstudio/projects/WildFireVisualization
npx tsc -b
npx vitest run
```

Expected: zero errors, all tests pass.

### Task E2: Manual smoke test

```bash
npm run dev
```

Open the URL. In the simulation panel:
1. Pick a forest area on the globe with the search.
2. Drop the ignition pin somewhere with continuous fuels.
3. Leave the default `Initial Attack` bundle, +30 min delay.
4. Click Start.
5. Verify the dark-amber fireline cells appear after the response delay elapses.
6. Verify a translucent red ghost area appears OUTSIDE the suppressed footprint.
7. Verify the Containment subsection updates with non-zero P(contained), line laid, area saved.
8. Reset, switch to None bundle, run again. Verify there's no fireline / no ghost / no Containment readout, and the fire grows larger than the suppressed run.
9. Reset, switch to Type 1 bundle. Verify fire is much more contained than Initial Attack on the same fuel/weather.

### Task E3: Push

```bash
git push -u origin version3
```

---

## Done — checklist

- New `src/simulation/suppression.ts` with NWCG / Reed–McCool / Hirsch–Martell math, fully unit-tested.
- New `CellState.Suppressed`, threaded through `spread.ts`, `runner.ts`, `worker.ts`, `useSimulation.ts`.
- Worker returns dual histories + diagnostics.
- New `SuppressionInputs` panel control with delay slider + bundle picker + custom roster.
- New `FirelineOverlay` and `GhostFireOverlay` Cesium imagery layers, mounted in `App.tsx`.
- New `Containment` subsection in `ImpactSection` with P(contained), line laid, area saved.
- All changes committed with conventional-commits messages.
- `version3` pushed to origin.
