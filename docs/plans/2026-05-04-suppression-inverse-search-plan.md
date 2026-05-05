# Suppression Inverse-Search + Local Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Q1 (max-acceptable-delay) and Q2 (min-required-tier) inverse-search analyses on top of the existing suppression sim, ship them precomputed in scenario JSONs, and expose a local Node backend that runs the same analyses live for ad-hoc audience clicks.

**Architecture:** A new pure-TS `inverseSearch.ts` runs in both the browser and Node. The existing `scripts/generate_scenario.ts` is extended to bake Q1/Q2 results into each scenario JSON. A new `scripts/dev-server.ts` (Express) exposes the same code over `localhost:3001`. Frontend gets an `AnalysisPanel` inside `ImpactSection`, a `ScenarioPicker` in `ControlPanel`, and a `simulationApi` client that prefers the local API over the browser worker for live runs. Tier labels switch to verbose Option-A everywhere.

**Tech Stack:** TypeScript + React + Vitest (existing) + Express (new dev dep) + tsx (already added).

**Reference design:** `docs/plans/2026-05-04-suppression-inverse-search-design.md`

---

## Phase A — Inverse-search engine (pure TypeScript)

### Task A1: Scaffold `inverseSearch.ts` and the `finalAreaHa` helper

**Files:**
- Create: `src/simulation/inverseSearch.ts`

**Step 1: Write the file**

```typescript
/**
 * Suppression inverse-search analyses.
 *
 *   Q1 - findMaxDelay: given a fixed bundle, find the largest response
 *        delay where suppression keeps the fire <= thresholdAreaHa.
 *   Q2 - findMinTier: given a fixed delay, find the smallest tier
 *        bundle that meets the same criterion.
 *
 * Pure TypeScript, no browser-only deps - runs in both the worker and
 * the Node dev-server. See:
 * docs/plans/2026-05-04-suppression-inverse-search-design.md
 */
import type {
  FuelType,
  SimulationConfig,
  SimulationState,
  SuppressionConfig,
  SuppressionStepDiag,
  ResourceCount,
} from "./types";
import { CellState, SUPPRESSION_BUNDLES } from "./types";
import { runSimulation } from "./runner";

export type BundleKey = keyof typeof SUPPRESSION_BUNDLES;

// Tier ladder Q2 walks from smallest to largest.
export const TIER_LADDER: BundleKey[] = [
  "initialAttack",
  "type3",
  "type2",
  "type1",
];

export interface InverseSearchInput {
  config: SimulationConfig;
  fuelMap: FuelType[];
  elevationMap?: Float32Array;
  igniteRow: number;
  igniteCol: number;
  centerLat: number;
  centerLng: number;
  maxSteps: number;
  thresholdAreaHa: number;
}

export interface SimRunSummary {
  history: SimulationState[];
  diags: SuppressionStepDiag[];
  finalAreaHa: number;
}

/**
 * Each cell that's Burning OR Burned at the final snapshot counts as
 * burned area. cellSizeMeters^2 / 10_000 = ha per cell.
 */
export function finalAreaHa(
  history: SimulationState[],
  cellSizeMeters: number,
): number {
  if (history.length === 0) return 0;
  const last = history[history.length - 1].grid;
  let burned = 0;
  for (let i = 0; i < last.length; i++) {
    if (last[i] === CellState.Burning || last[i] === CellState.Burned) {
      burned++;
    }
  }
  const haPerCell = (cellSizeMeters * cellSizeMeters) / 10_000;
  return burned * haPerCell;
}
```

**Step 2: Type-check + commit**

```bash
cd /Users/mlstudio/projects/WildFireVisualization && npx tsc -b
git add src/simulation/inverseSearch.ts
git commit -m "feat: scaffold inverseSearch module + finalAreaHa helper"
```

Expected: `tsc -b` clean.

---

### Task A2: Failing tests for `findMaxDelay`

**Files:**
- Create: `src/simulation/__tests__/inverseSearch.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import { finalAreaHa, findMaxDelay } from "../inverseSearch";
import type { SimulationState } from "../types";
import { CellState, DEFAULT_CONFIG, FuelType, SUPPRESSION_BUNDLES } from "../types";

function mkSnapshot(states: number[]): SimulationState {
  return { grid: new Uint8Array(states), timestep: 0 };
}

describe("finalAreaHa", () => {
  it("returns 0 for empty history", () => {
    expect(finalAreaHa([], 50)).toBe(0);
  });

  it("counts Burning + Burned cells, scales by cellSize^2", () => {
    const snap = mkSnapshot([
      CellState.Unburned,
      CellState.Burning,
      CellState.Burned,
      CellState.Suppressed,
    ]);
    // 2 burned cells × (50m × 50m) = 5000 m² = 0.5 ha
    expect(finalAreaHa([snap], 50)).toBeCloseTo(0.5, 5);
  });
});

describe("findMaxDelay (Q1)", () => {
  // We use a deliberately tiny grid so the test runs fast (<1s).
  const tinyConfig = {
    ...DEFAULT_CONFIG,
    gridSize: 50,
    cellSizeMeters: 50,
  };
  const fuelMap: FuelType[] = new Array(50 * 50).fill(FuelType.Grass);

  it("returns null when even delay=0 fails (threshold too low)", async () => {
    const result = await findMaxDelay({
      config: tinyConfig,
      fuelMap,
      igniteRow: 25,
      igniteCol: 25,
      centerLat: 37.3,
      centerLng: -122.1,
      maxSteps: 30,
      thresholdAreaHa: 0.001, // sub-cell, impossible
      bundle: [...SUPPRESSION_BUNDLES.initialAttack],
    });
    expect(result.maxDelayMin).toBeNull();
  });

  it("returns 180 (the max) when even very long delay still passes", async () => {
    // Threshold larger than the entire grid -> always passes.
    const totalGridHa = (tinyConfig.gridSize * tinyConfig.cellSizeMeters / 100) ** 2;
    const result = await findMaxDelay({
      config: tinyConfig,
      fuelMap,
      igniteRow: 25,
      igniteCol: 25,
      centerLat: 37.3,
      centerLng: -122.1,
      maxSteps: 30,
      thresholdAreaHa: totalGridHa * 2,
      bundle: [...SUPPRESSION_BUNDLES.type1],
    });
    expect(result.maxDelayMin).toBe(180);
  });
});
```

**Step 2: Run — should FAIL** (`findMaxDelay` not defined yet)

```bash
cd /Users/mlstudio/projects/WildFireVisualization && npx vitest run src/simulation/__tests__/inverseSearch.test.ts
```

Expected: ImportError on `findMaxDelay`.

**Step 3: Commit (red)**

```bash
git add src/simulation/__tests__/inverseSearch.test.ts
git commit -m "test: failing tests for finalAreaHa and findMaxDelay"
```

---

### Task A3: Implement `findMaxDelay` (bisection)

**Files:**
- Modify: `src/simulation/inverseSearch.ts`

**Step 1: Append to `inverseSearch.ts`**

```typescript
function runOnce(
  input: InverseSearchInput,
  delayMin: number,
  bundle: ResourceCount[],
): SimRunSummary {
  const suppression: SuppressionConfig = {
    responseDelayMin: delayMin,
    resources: bundle,
  };
  const result = runSimulation(
    input.config,
    input.igniteRow,
    input.igniteCol,
    () => 0,
    input.maxSteps,
    input.centerLat,
    input.centerLng,
    input.fuelMap,
    input.elevationMap,
    suppression,
  );
  // For inverse search we always want the SUPPRESSED history if it
  // exists, else the baseline.
  const history = result.suppressed?.history ?? result.baseline;
  return {
    history,
    diags: result.suppressed?.diags ?? [],
    finalAreaHa: finalAreaHa(history, input.config.cellSizeMeters),
  };
}

export interface FindMaxDelayInput extends InverseSearchInput {
  bundle: ResourceCount[];
}

export interface FindMaxDelayResult {
  /**
   * Largest delay (in minutes) where finalAreaHa <= thresholdAreaHa.
   * `null` when even delay=0 fails (no delay can save this fire).
   */
  maxDelayMin: number | null;
  justWorks: SimRunSummary | null;
  justFails: SimRunSummary | null;
  bisectionTrace: Array<{ delayMin: number; finalAreaHa: number; passed: boolean }>;
}

const Q1_RESOLUTION_MIN = 5;
const Q1_DELAY_LO = 0;
const Q1_DELAY_HI = 180;

export async function findMaxDelay(
  input: FindMaxDelayInput,
): Promise<FindMaxDelayResult> {
  const trace: FindMaxDelayResult["bisectionTrace"] = [];

  const tryDelay = (delay: number): SimRunSummary => {
    const run = runOnce(input, delay, input.bundle);
    trace.push({
      delayMin: delay,
      finalAreaHa: run.finalAreaHa,
      passed: run.finalAreaHa <= input.thresholdAreaHa,
    });
    return run;
  };

  // Boundary 1: if delay=0 already fails, no delay works.
  const at0 = tryDelay(Q1_DELAY_LO);
  if (at0.finalAreaHa > input.thresholdAreaHa) {
    return { maxDelayMin: null, justWorks: null, justFails: at0, bisectionTrace: trace };
  }

  // Boundary 2: if delay=max still passes, return max.
  const atMax = tryDelay(Q1_DELAY_HI);
  if (atMax.finalAreaHa <= input.thresholdAreaHa) {
    return {
      maxDelayMin: Q1_DELAY_HI,
      justWorks: atMax,
      justFails: null,
      bisectionTrace: trace,
    };
  }

  // Bisect between [low=passing, high=failing]
  let low = Q1_DELAY_LO;
  let high = Q1_DELAY_HI;
  let lowRun = at0;
  let highRun = atMax;
  while (high - low > Q1_RESOLUTION_MIN) {
    const mid = Math.floor((low + high) / 2 / Q1_RESOLUTION_MIN) * Q1_RESOLUTION_MIN;
    if (mid === low || mid === high) break;
    const run = tryDelay(mid);
    if (run.finalAreaHa <= input.thresholdAreaHa) {
      low = mid;
      lowRun = run;
    } else {
      high = mid;
      highRun = run;
    }
  }
  return {
    maxDelayMin: low,
    justWorks: lowRun,
    justFails: highRun,
    bisectionTrace: trace,
  };
}
```

**Step 2: Run tests — should PASS**

```bash
npx vitest run src/simulation/__tests__/inverseSearch.test.ts
```

Expected: 4 cases pass.

**Step 3: Commit**

```bash
git add src/simulation/inverseSearch.ts
git commit -m "feat: findMaxDelay (Q1) bisection on response-delay axis"
```

---

### Task A4: Failing tests for `findMinTier`

**Files:**
- Modify: `src/simulation/__tests__/inverseSearch.test.ts`

**Step 1: Append to the test file**

```typescript
import { findMinTier } from "../inverseSearch";

describe("findMinTier (Q2)", () => {
  const tinyConfig = {
    ...DEFAULT_CONFIG,
    gridSize: 50,
    cellSizeMeters: 50,
  };
  const fuelMap: FuelType[] = new Array(50 * 50).fill(FuelType.Grass);

  it("returns null when even Type 1 fails", async () => {
    const result = await findMinTier({
      config: tinyConfig,
      fuelMap,
      igniteRow: 25,
      igniteCol: 25,
      centerLat: 37.3,
      centerLng: -122.1,
      maxSteps: 30,
      thresholdAreaHa: 0.001, // impossible
      delayMin: 0,
    });
    expect(result.minTier).toBeNull();
  });

  it("returns 'initialAttack' when even the smallest tier passes", async () => {
    const totalGridHa = (tinyConfig.gridSize * tinyConfig.cellSizeMeters / 100) ** 2;
    const result = await findMinTier({
      config: tinyConfig,
      fuelMap,
      igniteRow: 25,
      igniteCol: 25,
      centerLat: 37.3,
      centerLng: -122.1,
      maxSteps: 30,
      thresholdAreaHa: totalGridHa * 2,
      delayMin: 0,
    });
    expect(result.minTier).toBe("initialAttack");
  });
});
```

**Step 2: Run — should FAIL** (`findMinTier` not defined yet)

```bash
npx vitest run src/simulation/__tests__/inverseSearch.test.ts
```

Expected: ImportError or 2 failures.

**Step 3: Commit (red)**

```bash
git add src/simulation/__tests__/inverseSearch.test.ts
git commit -m "test: failing tests for findMinTier"
```

---

### Task A5: Implement `findMinTier` (linear scan up the ladder)

**Files:**
- Modify: `src/simulation/inverseSearch.ts`

**Step 1: Append**

```typescript
export interface FindMinTierInput extends InverseSearchInput {
  delayMin: number;
}

export interface FindMinTierResult {
  /** First tier in TIER_LADDER that passes. `null` if all fail. */
  minTier: BundleKey | null;
  minWorking: SimRunSummary | null;
  tierBelow: SimRunSummary | null;
  tierTrace: Array<{ tier: BundleKey; finalAreaHa: number; passed: boolean }>;
}

export async function findMinTier(
  input: FindMinTierInput,
): Promise<FindMinTierResult> {
  const trace: FindMinTierResult["tierTrace"] = [];
  let lastFailingRun: SimRunSummary | null = null;

  for (const tier of TIER_LADDER) {
    const bundle = SUPPRESSION_BUNDLES[tier];
    const run = runOnce(input, input.delayMin, [...bundle]);
    const passed = run.finalAreaHa <= input.thresholdAreaHa;
    trace.push({ tier, finalAreaHa: run.finalAreaHa, passed });
    if (passed) {
      return {
        minTier: tier,
        minWorking: run,
        tierBelow: lastFailingRun,
        tierTrace: trace,
      };
    }
    lastFailingRun = run;
  }
  return {
    minTier: null,
    minWorking: null,
    tierBelow: lastFailingRun,
    tierTrace: trace,
  };
}
```

**Step 2: Run tests — should PASS**

```bash
npx vitest run src/simulation/__tests__/inverseSearch.test.ts
```

Expected: 6 cases pass.

**Step 3: Run all sim tests as a regression check**

```bash
npx vitest run src/simulation/
```

Expected: 39+ pass (33 prior + 6 inverse-search).

**Step 4: Commit**

```bash
git add src/simulation/inverseSearch.ts
git commit -m "feat: findMinTier (Q2) linear scan up the tier ladder"
```

---

## Phase B — Verbose tier labels (Option A)

### Task B1: Update tier labels everywhere

**Files:**
- Modify: `src/simulation/types.ts` (add a `BUNDLE_DISPLAY_LABELS` export)
- Modify: `src/components/SuppressionInputs.tsx`

**Step 1: Add a labels map in `types.ts`**

Append at the bottom:

```typescript
/**
 * Verbose, audience-friendly labels for each suppression bundle.
 * Used by SuppressionInputs and AnalysisPanel so non-fire-ops viewers
 * understand what each tier is.
 */
export const BUNDLE_DISPLAY_LABELS: Record<string, string> = {
  none: "No response",
  initialAttack: "Small (Initial Attack) — 1 crew + 1 engine + 1 helitack",
  type3: "Medium (Type 3) — 3 crews + 2 engines + 2 helitack",
  type2: "Large (Type 2) — 5 crews + 3 dozers + 2 helitack + 1 tanker",
  type1: "Maximum (Type 1) — 10 crews + 5 dozers + 3 helitack + 2 tankers",
};
```

**Step 2: Use the new labels in SuppressionInputs**

In `src/components/SuppressionInputs.tsx`, find the existing `BUNDLE_LABELS` constant and replace it with a re-export of the new types.ts version:

```typescript
import { BUNDLE_DISPLAY_LABELS } from "../simulation/types";
// ...
const BUNDLE_LABELS: Record<string, string> = BUNDLE_DISPLAY_LABELS;
```

**Step 3: Type-check + commit**

```bash
npx tsc -b
git add src/simulation/types.ts src/components/SuppressionInputs.tsx
git commit -m "feat: verbose Option-A tier labels in SuppressionInputs"
```

---

## Phase C — Local Node backend

### Task C1: Add Express + cors as dev deps

**Files:**
- Modify: `package.json` (and `package-lock.json`)

**Step 1: Install**

```bash
cd /Users/mlstudio/projects/WildFireVisualization && npm install --save-dev express cors @types/express @types/cors
```

**Step 2: Add `npm run server` script to package.json**

In the `scripts` block, add:

```json
"server": "tsx scripts/dev-server.ts"
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add express + cors for local dev server"
```

---

### Task C2: Build `dev-server.ts`

**Files:**
- Create: `scripts/dev-server.ts`

**Step 1: Write the server**

```typescript
/**
 * Local Node API for live what-if queries during demos.
 *
 * Endpoints (all POST, JSON in/out):
 *   /api/simulate - one suppressed simulation
 *   /api/q1       - findMaxDelay inverse search
 *   /api/q2       - findMinTier inverse search
 *
 * Run with `npm run server`. Browser calls localhost:3001.
 */

import express, { type Request, type Response } from "express";
import cors from "cors";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runSimulation } from "../src/simulation/runner.ts";
import { loadModel } from "../src/simulation/mlModel.ts";
import { findMaxDelay, findMinTier, finalAreaHa } from "../src/simulation/inverseSearch.ts";
import { rleEncode } from "../src/utils/rle.ts";
import type {
  SimulationConfig,
  FuelType,
  SuppressionConfig,
  ResourceCount,
} from "../src/simulation/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PORT = 3001;

// Load the ML model once at startup so spread.ts can use it.
const modelJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/xgboost_model.json"), "utf-8"),
);
loadModel(modelJson);

const app = express();
app.use(cors()); // localhost:5173 -> localhost:3001
app.use(express.json({ limit: "100mb" }));

// Common request shape - everything Q1/Q2/single-sim need.
interface SimRequest {
  config: SimulationConfig;
  fuelMap: FuelType[];
  elevationMap?: number[]; // sent as plain array; we'll Float32 it
  igniteRow: number;
  igniteCol: number;
  centerLat: number;
  centerLng: number;
  maxSteps: number;
  weather?: {
    tempMean: number;
    tempMax: number;
    precipitation: number;
    cumulativePrecip: number;
  };
}

interface SimulateRequest extends SimRequest {
  suppression?: SuppressionConfig;
}

interface Q1Request extends SimRequest {
  bundle: ResourceCount[];
  thresholdAreaHa: number;
}

interface Q2Request extends SimRequest {
  delayMin: number;
  thresholdAreaHa: number;
}

function elevationOrUndefined(arr: number[] | undefined): Float32Array | undefined {
  return arr ? new Float32Array(arr) : undefined;
}

function enrichedConfig(config: SimulationConfig, weather?: SimRequest["weather"]) {
  return {
    ...config,
    tempMean: weather?.tempMean ?? 25,
    tempMax: weather?.tempMax ?? 35,
    precipitation: weather?.precipitation ?? 0,
    cumulativePrecip: weather?.cumulativePrecip ?? 0,
  };
}

app.post("/api/simulate", async (req: Request, res: Response) => {
  try {
    const body = req.body as SimulateRequest;
    const t0 = Date.now();
    const result = runSimulation(
      enrichedConfig(body.config, body.weather),
      body.igniteRow,
      body.igniteCol,
      () => 0,
      body.maxSteps,
      body.centerLat,
      body.centerLng,
      body.fuelMap,
      elevationOrUndefined(body.elevationMap),
      body.suppression,
    );
    const baselineRle = result.baseline.map((s) => rleEncode(s.grid));
    const suppressedRle = result.suppressed?.history.map((s) => rleEncode(s.grid));
    res.json({
      elapsedMs: Date.now() - t0,
      gridSize: body.config.gridSize,
      baseline: { rleSteps: baselineRle, length: result.baseline.length },
      suppressed: result.suppressed
        ? {
            rleSteps: suppressedRle,
            length: result.suppressed.history.length,
            diags: result.suppressed.diags,
          }
        : undefined,
      finalAreaHa: finalAreaHa(
        result.suppressed?.history ?? result.baseline,
        body.config.cellSizeMeters,
      ),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/q1", async (req: Request, res: Response) => {
  try {
    const body = req.body as Q1Request;
    const t0 = Date.now();
    const result = await findMaxDelay({
      config: enrichedConfig(body.config, body.weather),
      fuelMap: body.fuelMap,
      elevationMap: elevationOrUndefined(body.elevationMap),
      igniteRow: body.igniteRow,
      igniteCol: body.igniteCol,
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      maxSteps: body.maxSteps,
      thresholdAreaHa: body.thresholdAreaHa,
      bundle: body.bundle,
    });
    res.json({ elapsedMs: Date.now() - t0, ...result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/q2", async (req: Request, res: Response) => {
  try {
    const body = req.body as Q2Request;
    const t0 = Date.now();
    const result = await findMinTier({
      config: enrichedConfig(body.config, body.weather),
      fuelMap: body.fuelMap,
      elevationMap: elevationOrUndefined(body.elevationMap),
      igniteRow: body.igniteRow,
      igniteCol: body.igniteCol,
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      maxSteps: body.maxSteps,
      thresholdAreaHa: body.thresholdAreaHa,
      delayMin: body.delayMin,
    });
    res.json({ elapsedMs: Date.now() - t0, ...result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✓ Wildfire dev server listening on http://localhost:${PORT}`);
  console.log("  POST /api/simulate, /api/q1, /api/q2 — JSON in/out");
});
```

**Step 2: Smoke-test the server**

```bash
cd /Users/mlstudio/projects/WildFireVisualization && npm run server &
sleep 3
curl -s http://localhost:3001/api/health
# Expected: {"ok":true}
kill %1
```

**Step 3: Commit**

```bash
git add scripts/dev-server.ts
git commit -m "feat: local Node API (express) for live simulate/q1/q2"
```

---

## Phase D — Frontend simulation API client

### Task D1: Create `simulationApi.ts`

**Files:**
- Create: `src/services/simulationApi.ts`

**Step 1: Write the client**

```typescript
/**
 * Frontend client for the local Node dev-server. Tries the API first;
 * surfaces a clear error if the server isn't running. Browser-worker
 * fallback is left to the caller (App.tsx) — it can decide to silently
 * fall back, or to surface the error.
 */
import type {
  FuelType,
  ResourceCount,
  SimulationConfig,
  SuppressionConfig,
} from "../simulation/types";

const API_BASE = "http://localhost:3001";

export class ApiUnreachableError extends Error {
  constructor() {
    super("Local Node server unreachable. Run `npm run server` on the workstation.");
    this.name = "ApiUnreachableError";
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiUnreachableError();
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function isServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface ApiSimulateRequest {
  config: SimulationConfig;
  fuelMap: FuelType[];
  elevationMap?: number[];
  igniteRow: number;
  igniteCol: number;
  centerLat: number;
  centerLng: number;
  maxSteps: number;
  weather?: { tempMean: number; tempMax: number; precipitation: number; cumulativePrecip: number };
  suppression?: SuppressionConfig;
}

export async function apiSimulate(req: ApiSimulateRequest) {
  return postJson<{
    elapsedMs: number;
    gridSize: number;
    baseline: { rleSteps: number[][]; length: number };
    suppressed?: { rleSteps: number[][]; length: number; diags: unknown[] };
    finalAreaHa: number;
  }>("/api/simulate", req);
}

export interface ApiQ1Request extends Omit<ApiSimulateRequest, "suppression"> {
  bundle: ResourceCount[];
  thresholdAreaHa: number;
}

export async function apiQ1(req: ApiQ1Request) {
  return postJson<{
    elapsedMs: number;
    maxDelayMin: number | null;
    bisectionTrace: Array<{ delayMin: number; finalAreaHa: number; passed: boolean }>;
  }>("/api/q1", req);
}

export interface ApiQ2Request extends Omit<ApiSimulateRequest, "suppression"> {
  delayMin: number;
  thresholdAreaHa: number;
}

export async function apiQ2(req: ApiQ2Request) {
  return postJson<{
    elapsedMs: number;
    minTier: string | null;
    tierTrace: Array<{ tier: string; finalAreaHa: number; passed: boolean }>;
  }>("/api/q2", req);
}
```

**Step 2: Type-check + commit**

```bash
npx tsc -b
git add src/services/simulationApi.ts
git commit -m "feat: frontend simulationApi client (simulate/q1/q2)"
```

---

## Phase E — Scenario format extension + regenerate Cupertino

### Task E1: Extend `generate_scenario.ts` to bake Q1 + Q2

**Files:**
- Modify: `scripts/generate_scenario.ts`

**Step 1: Add the analysis block to the generator**

In `scripts/generate_scenario.ts`, near the top alongside the existing imports add:

```typescript
import { findMaxDelay, findMinTier } from "../src/simulation/inverseSearch.ts";
import { SUPPRESSION_BUNDLES } from "../src/simulation/types.ts";
```

In the `ScenarioSpec` interface, add:

```typescript
thresholdAreaHa: number;
defaultBundleKey: "initialAttack" | "type3" | "type2" | "type1";
defaultDelayMin: number;
```

In the `cupertino-wui` spec, add:

```typescript
thresholdAreaHa: 500,
defaultBundleKey: "initialAttack",
defaultDelayMin: 30,
```

In the `generate(spec)` function, AFTER the existing `runSimulation` call but BEFORE writing the JSON, run the inverse searches:

```typescript
console.log("  running Q1 (max delay for default bundle)...");
const q1 = await findMaxDelay({
  config: enriched,
  fuelMap,
  elevationMap,
  igniteRow: center,
  igniteCol: center,
  centerLat: spec.location.lat,
  centerLng: spec.location.lng,
  maxSteps: spec.maxSteps,
  thresholdAreaHa: spec.thresholdAreaHa,
  bundle: [...SUPPRESSION_BUNDLES[spec.defaultBundleKey]],
});
console.log(`    Q1: maxDelayMin = ${q1.maxDelayMin}`);

console.log("  running Q2 (min tier for default delay)...");
const q2 = await findMinTier({
  config: enriched,
  fuelMap,
  elevationMap,
  igniteRow: center,
  igniteCol: center,
  centerLat: spec.location.lat,
  centerLng: spec.location.lng,
  maxSteps: spec.maxSteps,
  thresholdAreaHa: spec.thresholdAreaHa,
  delayMin: spec.defaultDelayMin,
});
console.log(`    Q2: minTier = ${q2.minTier}`);

// RLE-encode the boundary sims so they fit the JSON budget.
const compactQ1 = {
  bundle: spec.defaultBundleKey,
  maxDelayMin: q1.maxDelayMin,
  bisectionTrace: q1.bisectionTrace,
  justWorks: q1.justWorks
    ? {
        delayMin: q1.bisectionTrace.find((t) => t.passed && t.delayMin === q1.maxDelayMin)?.delayMin ?? 0,
        rleSteps: q1.justWorks.history.map((s) => rleEncode(s.grid)),
        finalAreaHa: q1.justWorks.finalAreaHa,
      }
    : null,
  justFails: q1.justFails
    ? {
        delayMin: q1.bisectionTrace.find((t) => !t.passed)?.delayMin ?? 0,
        rleSteps: q1.justFails.history.map((s) => rleEncode(s.grid)),
        finalAreaHa: q1.justFails.finalAreaHa,
      }
    : null,
};

const compactQ2 = {
  delayMin: spec.defaultDelayMin,
  minTier: q2.minTier,
  tierTrace: q2.tierTrace,
  minWorking: q2.minWorking
    ? {
        tier: q2.minTier!,
        rleSteps: q2.minWorking.history.map((s) => rleEncode(s.grid)),
        finalAreaHa: q2.minWorking.finalAreaHa,
      }
    : null,
  tierBelow: q2.tierBelow
    ? {
        tier: q2.tierTrace[q2.tierTrace.findIndex((t) => t.passed) - 1]?.tier ?? null,
        rleSteps: q2.tierBelow.history.map((s) => rleEncode(s.grid)),
        finalAreaHa: q2.tierBelow.finalAreaHa,
      }
    : null,
};
```

In the `payload` object, add a new top-level key:

```typescript
analysis: { q1: compactQ1, q2: compactQ2 },
```

And update `meta` to include `thresholdAreaHa`:

```typescript
meta: {
  // ...existing...
  thresholdAreaHa: spec.thresholdAreaHa,
  // ...
}
```

**Step 2: Regenerate cupertino-wui**

```bash
cd /Users/mlstudio/projects/WildFireVisualization && npx tsx scripts/generate_scenario.ts
```

Expected output (numbers approximate):
```
=== Generating cupertino-wui ===
Location: 37.3, -122.1
  ran in 14-30s
  baseline: 200 steps
  suppressed: 200 steps
  running Q1 (max delay for default bundle)...
    Q1: maxDelayMin = 25  (or similar)
  running Q2 (min tier for default delay)...
    Q2: minTier = type3   (or similar)
  wrote .../cupertino-wui.json (15-25 MB)
```

If runtime exceeds 5 minutes, reduce `maxSteps` to 100 in the spec.

**Step 3: Commit**

```bash
git add scripts/generate_scenario.ts src/data/scenarios/cupertino-wui.json
git commit -m "feat: bake Q1 + Q2 inverse-search results into scenario JSON"
```

---

## Phase F — Scenario picker UI

### Task F1: Create `ScenarioPicker.tsx` component

**Files:**
- Create: `src/components/ScenarioPicker.tsx`

**Step 1: Write the component**

```typescript
import { useState } from "react";

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  jsonPath: string; // import.meta.url-relative path
}

const SCENARIOS: ScenarioSummary[] = [
  {
    id: "cupertino-wui",
    name: "Cupertino WUI",
    description: "Westerly wind pushes a fire from the Santa Cruz foothills toward Cupertino.",
    jsonPath: new URL("../data/scenarios/cupertino-wui.json", import.meta.url).href,
  },
];

interface ScenarioPickerProps {
  onPick: (scenario: ScenarioSummary) => void;
  onLive: () => void;
}

export default function ScenarioPicker({ onPick, onLive }: ScenarioPickerProps) {
  const [selectedId, setSelectedId] = useState<string | "live">("live");

  return (
    <div>
      <div
        className="text-label font-medium tracking-[0.15em] uppercase mb-1.5"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        Quick Start
      </div>
      <select
        value={selectedId}
        onChange={(e) => {
          const id = e.target.value;
          setSelectedId(id);
          if (id === "live") {
            onLive();
          } else {
            const s = SCENARIOS.find((sc) => sc.id === id);
            if (s) onPick(s);
          }
        }}
        className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-amber-500/40"
      >
        <option value="live">Run a new simulation (live)</option>
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {selectedId !== "live" && (
        <p className="text-micro text-gray-500 mt-1.5">
          {SCENARIOS.find((s) => s.id === selectedId)?.description}
        </p>
      )}
    </div>
  );
}
```

**Step 2: Type-check + commit**

```bash
npx tsc -b
git add src/components/ScenarioPicker.tsx
git commit -m "feat: ScenarioPicker dropdown for precomputed scenarios"
```

---

### Task F2: Wire ScenarioPicker into ControlPanel

**Files:**
- Modify: `src/components/ControlPanel.tsx`

**Step 1: Add prop + render**

Add a new prop to `ControlPanelProps`:

```typescript
onScenarioPick?: (scenarioId: string) => void;
onScenarioLive?: () => void;
```

Add the import:

```typescript
import ScenarioPicker, { type ScenarioSummary } from "./ScenarioPicker";
```

Inside the `mode === "ignite"` block, BEFORE the existing `LocationSearch`, add:

```tsx
{onScenarioPick && onScenarioLive && (
  <ScenarioPicker
    onPick={(s: ScenarioSummary) => onScenarioPick(s.id)}
    onLive={onScenarioLive}
  />
)}
```

**Step 2: Type-check + commit**

```bash
npx tsc -b
git add src/components/ControlPanel.tsx
git commit -m "feat: ControlPanel hosts ScenarioPicker in simulate mode"
```

---

### Task F3: Scenario loader in App.tsx

**Files:**
- Modify: `src/App.tsx`
- Create: `src/services/scenarioLoader.ts`

**Step 1: Loader service**

Create `src/services/scenarioLoader.ts`:

```typescript
import { rleDecode } from "../utils/rle";
import type { SimulationState, SuppressionStepDiag } from "../simulation/types";

export interface LoadedScenario {
  meta: {
    id: string;
    name: string;
    description: string;
    location: { lat: number; lng: number };
    config: { gridSize: number; cellSizeMeters: number; timestepMinutes: number; windSpeed: number; windDirection: number; humidity: number };
    thresholdAreaHa: number;
  };
  fuelMap: number[];
  elevations: number[];
  primary: { history: SimulationState[]; diags?: SuppressionStepDiag[] };
  analysis: {
    q1: { bundle: string; maxDelayMin: number | null; bisectionTrace: unknown[] };
    q2: { delayMin: number; minTier: string | null; tierTrace: unknown[] };
  };
}

function rleStepsToHistory(rleSteps: number[][], gridCells: number): SimulationState[] {
  return rleSteps.map((rle, i) => ({
    grid: rleDecode(rle, gridCells),
    timestep: i,
  }));
}

export async function loadScenario(jsonPath: string): Promise<LoadedScenario> {
  const res = await fetch(jsonPath);
  if (!res.ok) throw new Error(`Failed to load scenario: ${res.status}`);
  const raw = await res.json();
  const gridCells = raw.meta.config.gridSize * raw.meta.config.gridSize;
  // Backwards compat: older JSONs use `baseline` / `suppressed` instead of `primary`.
  const primarySource = raw.primary ?? raw.suppressed ?? raw.baseline;
  return {
    meta: raw.meta,
    fuelMap: raw.fuelMap,
    elevations: raw.elevations,
    primary: {
      history: rleStepsToHistory(primarySource.rleSteps, gridCells),
      diags: primarySource.diags,
    },
    analysis: raw.analysis ?? { q1: {}, q2: {} },
  };
}
```

**Step 2: App.tsx hook**

In `src/App.tsx`, add a new state:

```typescript
const [activeScenario, setActiveScenario] = useState<LoadedScenario | null>(null);
```

Add handlers near `handleStartWildfire`:

```typescript
const handleScenarioPick = useCallback(async (scenarioId: string) => {
  // Find the scenario JSON path by id (only one for now).
  const jsonUrl = new URL(`./data/scenarios/${scenarioId}.json`, import.meta.url).href;
  fullReset();
  const scenario = await loadScenario(jsonUrl);
  setActiveScenario(scenario);
  setIgnitionPoint({ lat: scenario.meta.location.lat, lng: scenario.meta.location.lng });
  setActiveConfig({ ...DEFAULT_CONFIG, ...scenario.meta.config });
  setFlyTo({ lat: scenario.meta.location.lat, lng: scenario.meta.location.lng, altitude: 15000, _t: Date.now() });
  setAppMode("simulation");
  // Convert to fire frames for the existing animator
  const fire = convertSimulationToFire(
    scenario.primary.history,
    { ...DEFAULT_CONFIG, ...scenario.meta.config },
    scenario.meta.location.lat,
    scenario.meta.location.lng,
  );
  setActiveFire(fire);
  setAutoPlay(true);
}, [fullReset]);

const handleScenarioLive = useCallback(() => {
  fullReset();
  setActiveScenario(null);
}, [fullReset]);
```

Pass them to ControlPanel:

```tsx
<ControlPanel
  // ...existing
  onScenarioPick={handleScenarioPick}
  onScenarioLive={handleScenarioLive}
  // ...
/>
```

Add the import at the top of App.tsx:

```typescript
import { loadScenario, type LoadedScenario } from "./services/scenarioLoader";
```

**Step 3: Type-check + smoke**

```bash
npx tsc -b
npm run dev
# Open the app, pick "Cupertino WUI" from the Quick Start dropdown.
# Verify the map flies there and a precomputed sim plays.
# Stop the dev server.
```

**Step 4: Commit**

```bash
git add src/App.tsx src/services/scenarioLoader.ts
git commit -m "feat: load precomputed scenarios from JSON in App"
```

---

## Phase G — AnalysisPanel UI (Q1 + Q2 cards)

### Task G1: Create `AnalysisPanel.tsx`

**Files:**
- Create: `src/components/AnalysisPanel.tsx`

**Step 1: Write the component**

```typescript
import { BUNDLE_DISPLAY_LABELS } from "../simulation/types";

interface AnalysisPanelProps {
  q1?: {
    bundle: string;
    maxDelayMin: number | null;
  };
  q2?: {
    delayMin: number;
    minTier: string | null;
  };
  thresholdAreaHa: number;
}

export default function AnalysisPanel({ q1, q2, thresholdAreaHa }: AnalysisPanelProps) {
  if (!q1 && !q2) return null;

  return (
    <div className="border-t border-white/[0.04] pt-3 space-y-3">
      <div
        className="text-label font-medium tracking-[0.15em] uppercase mb-1"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        What-If Analysis
      </div>

      {q1 && (
        <Card title="Max delay before suppression fails">
          <div className="text-2xl font-bold text-amber-400 tabular-nums">
            {q1.maxDelayMin === null ? "Cannot contain" : `${q1.maxDelayMin} min`}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            With {BUNDLE_DISPLAY_LABELS[q1.bundle]}
          </div>
          <div className="text-xs text-gray-500">
            Keeping fire ≤ {thresholdAreaHa.toFixed(0)} ha
          </div>
        </Card>
      )}

      {q2 && (
        <Card title="Minimum effective response">
          <div className="text-base font-bold text-amber-400">
            {q2.minTier === null ? "Cannot contain" : BUNDLE_DISPLAY_LABELS[q2.minTier]}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            With {q2.delayMin} min response delay
          </div>
          <div className="text-xs text-gray-500">
            Keeping fire ≤ {thresholdAreaHa.toFixed(0)} ha
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div
        className="text-micro tracking-wider uppercase mb-1.5"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
```

**Step 2: Type-check + commit**

```bash
npx tsc -b
git add src/components/AnalysisPanel.tsx
git commit -m "feat: AnalysisPanel renders Q1 + Q2 result cards"
```

---

### Task G2: Mount AnalysisPanel in ImpactSection

**Files:**
- Modify: `src/components/ImpactSection.tsx`
- Modify: `src/components/ControlPanel.tsx` (forward analysis props)
- Modify: `src/App.tsx` (pass analysis from activeScenario)

**Step 1: Add prop + render in ImpactSection**

Add to `ImpactSectionProps`:

```typescript
analysis?: {
  q1?: { bundle: string; maxDelayMin: number | null };
  q2?: { delayMin: number; minTier: string | null };
};
thresholdAreaHa?: number;
```

Import:

```typescript
import AnalysisPanel from "./AnalysisPanel";
```

In the JSX, BELOW the Containment subsection (added in D1) and ABOVE the Emissions block:

```tsx
{analysis && thresholdAreaHa !== undefined && (
  <AnalysisPanel
    q1={analysis.q1}
    q2={analysis.q2}
    thresholdAreaHa={thresholdAreaHa}
  />
)}
```

**Step 2: Forward through ControlPanel**

Add `analysis` and `thresholdAreaHa` to `ControlPanelProps`. Destructure them and pass to `<ImpactSection ...>`.

**Step 3: Forward from App.tsx**

```tsx
<ControlPanel
  // ...existing
  analysis={activeScenario?.analysis}
  thresholdAreaHa={activeScenario?.meta.thresholdAreaHa}
  // ...
/>
```

**Step 4: Type-check + smoke**

```bash
npx tsc -b
npm run dev
# Pick the Cupertino scenario; verify the AnalysisPanel cards appear.
```

**Step 5: Commit**

```bash
git add src/components/ImpactSection.tsx src/components/ControlPanel.tsx src/App.tsx
git commit -m "feat: AnalysisPanel mounted in ImpactSection (Q1+Q2 cards)"
```

---

## Phase H — Verification

### Task H1: Tests + type-check sweep

```bash
cd /Users/mlstudio/projects/WildFireVisualization
npx tsc -b
npx vitest run
```

Expected: 0 type errors, all tests pass (39+ in src/simulation, 3 in src/utils).

### Task H2: End-to-end smoke (manual)

```bash
# Terminal 1
npm run server
# Expected: "✓ Wildfire dev server listening on http://localhost:3001"

# Terminal 2
npm run dev
```

Open `http://localhost:5173/`. In sequence:

1. **Scenario load**: Switch to Simulate, pick "Cupertino WUI" from Quick Start.
   - Map flies to Cupertino.
   - The precomputed sim animates.
   - AnalysisPanel cards show Q1 (max delay) and Q2 (min tier) with non-`null` values.

2. **Live click**: Switch Quick Start to "Run a new simulation (live)". Click somewhere on the globe.
   - Browser POSTs to `localhost:3001/api/simulate`.
   - Sim returns within ~5–15 s on the workstation.
   - Map plays back the suppressed history.

3. **Server-down behavior**: Stop the local server (Ctrl-C in terminal 1). Click somewhere again.
   - User sees a clear toast / console error: "Local server unreachable. Run `npm run server`."
   - (Optional) browser-worker fallback runs if you choose to wire it in this task; otherwise document and accept the failure mode.

### Task H3: Push

```bash
git push origin version3
```

---

## Done — checklist

- `inverseSearch.ts` with `findMaxDelay` and `findMinTier`, fully unit-tested.
- `dev-server.ts` exposes `/api/simulate`, `/api/q1`, `/api/q2` on `localhost:3001`.
- `npm run server` script in `package.json`.
- Verbose Option-A tier labels everywhere (picker, modal, analysis cards).
- Cupertino scenario JSON regenerated with `analysis.q1` and `analysis.q2` baked in.
- `ScenarioPicker` dropdown loads precomputed scenarios instantly.
- `AnalysisPanel` displays Q1/Q2 boundaries inside `ImpactSection`.
- `simulationApi.ts` client with reachability check and clear errors.
- All tests + type-check green.
- Pushed to `origin/version3`.
