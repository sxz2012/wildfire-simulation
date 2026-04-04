# Wildfire Spread 3D Visualization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a web app that visualizes wildfire spread on a photorealistic 3D globe using CesiumJS + Google 3D Tiles, with an interactive simulation engine, timeline scrubber, and pre-built scenarios.

**Architecture:** React + TypeScript SPA bundled with Vite. CesiumJS (via resium) renders the 3D globe with Google Photorealistic 3D Tiles. A Web Worker runs the fire spread simulation (simplified Rothermel model on a 200x200 grid). UI controls in a left sidebar, timeline scrubber at the bottom.

**Tech Stack:** React 18, TypeScript, Vite, CesiumJS, resium, Tailwind CSS, Vitest

**Design doc:** `docs/plans/2026-04-04-wildfire-visualization-design.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`

**Step 1: Initialize Vite + React + TypeScript project**

Run:
```bash
cd /Users/mlstudio/projects/WildFireVisualization
npm create vite@latest . -- --template react-ts
```

If prompted about non-empty directory, proceed (only `docs/` exists).

Expected: Scaffolded React + TS project.

**Step 2: Install dependencies**

Run:
```bash
npm install cesium resium
npm install -D tailwindcss @tailwindcss/vite vitest @testing-library/react @testing-library/jest-dom jsdom vite-plugin-cesium
```

**Step 3: Configure Tailwind**

Replace `src/index.css` with:
```css
@import "tailwindcss";
```

Update `vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), cesium(), tailwindcss()],
});
```

**Step 4: Configure Vitest**

Add to `vite.config.ts` (or create `vitest.config.ts`):
```ts
/// <reference types="vitest/config" />
// Add to defineConfig:
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
```

Create `src/test-setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

**Step 5: Create minimal App component**

Replace `src/App.tsx`:
```tsx
function App() {
  return (
    <div className="h-screen w-screen bg-black text-white flex items-center justify-center">
      <p>Wildfire Visualization</p>
    </div>
  );
}

export default App;
```

**Step 6: Verify dev server runs**

Run: `npm run dev`
Expected: App renders at localhost with "Wildfire Visualization" text.

**Step 7: Add scripts to package.json**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 8: Commit**

```bash
git init
echo "node_modules\ndist\n.env" > .gitignore
git add -A
git commit -m "feat: scaffold Vite + React + TS + Cesium + Tailwind project"
```

---

## Task 2: CesiumJS Globe with Google 3D Tiles

**Files:**
- Create: `src/components/GlobeView.tsx`
- Modify: `src/App.tsx`

**Step 1: Create GlobeView component**

Create `src/components/GlobeView.tsx`:
```tsx
import { Viewer, Globe } from "resium";
import {
  Ion,
  createGooglePhotorealistic3DTileset,
  Terrain,
  Cartesian3,
} from "cesium";
import { useEffect, useRef } from "react";
import type { CesiumComponentRef } from "resium";
import type { Viewer as CesiumViewer } from "cesium";

// User must provide their own API keys
Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";

export default function GlobeView() {
  const viewerRef = useRef<CesiumComponentRef<CesiumViewer>>(null);

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    // Add Google Photorealistic 3D Tiles
    const addTileset = async () => {
      try {
        const tileset = await createGooglePhotorealistic3DTileset(
          import.meta.env.VITE_GOOGLE_MAPS_API_KEY
            ? { key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY }
            : undefined
        );
        viewer.scene.primitives.add(tileset);
      } catch (e) {
        console.error("Failed to load Google 3D Tiles:", e);
      }
    };
    addTileset();

    // Set initial camera to overview of California
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(-119.5, 36.7, 500000),
    });
  }, []);

  return (
    <Viewer
      ref={viewerRef}
      full
      timeline={false}
      animation={false}
      homeButton={false}
      baseLayerPicker={false}
      navigationHelpButton={false}
      sceneModePicker={false}
      geocoder={false}
      terrain={Terrain.fromWorldTerrain()}
    >
      <Globe depthTestAgainstTerrain />
    </Viewer>
  );
}
```

**Step 2: Wire into App**

Replace `src/App.tsx`:
```tsx
import GlobeView from "./components/GlobeView";

function App() {
  return (
    <div className="h-screen w-screen relative">
      <GlobeView />
    </div>
  );
}

export default App;
```

**Step 3: Create `.env.example`**

```
VITE_CESIUM_ION_TOKEN=your_cesium_ion_token_here
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

**Step 4: Verify globe renders**

Run: `npm run dev`
Expected: 3D globe with terrain renders. If API keys provided, Google 3D Tiles load.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add CesiumJS globe with Google 3D Tiles"
```

---

## Task 3: Simulation Engine — Types & Grid

**Files:**
- Create: `src/simulation/types.ts`, `src/simulation/grid.ts`
- Test: `src/simulation/__tests__/grid.test.ts`

**Step 1: Define simulation types**

Create `src/simulation/types.ts`:
```ts
export enum CellState {
  Unburned = 0,
  Burning = 1,
  Burned = 2,
}

export enum FuelType {
  Grass = "grass",
  Shrub = "shrub",
  Forest = "forest",
}

export interface GridCell {
  state: CellState;
  fuel: FuelType;
  elevation: number; // meters
  burnTimer: number; // timesteps remaining before burned out
  lat: number;
  lng: number;
}

export interface SimulationConfig {
  gridSize: number; // cells per side (default 200)
  cellSizeMeters: number; // meters per cell (default 50)
  windSpeed: number; // km/h (0-60)
  windDirection: number; // degrees (0-360, 0=north)
  humidity: number; // 0-100
  defaultFuel: FuelType;
  timestepMinutes: number; // simulated minutes per step
}

export interface SimulationState {
  grid: Uint8Array; // flat array of CellState values (gridSize * gridSize)
  timestep: number;
}

export interface SimulationResult {
  history: SimulationState[];
  config: SimulationConfig;
}

// Fuel properties: how fast it ignites, how long it burns
export const FUEL_PROPERTIES: Record<
  FuelType,
  { ignitionRate: number; burnDuration: number; spreadRate: number }
> = {
  [FuelType.Grass]: { ignitionRate: 0.8, burnDuration: 3, spreadRate: 1.2 },
  [FuelType.Shrub]: { ignitionRate: 0.5, burnDuration: 6, spreadRate: 1.0 },
  [FuelType.Forest]: { ignitionRate: 0.3, burnDuration: 12, spreadRate: 0.7 },
};

export const DEFAULT_CONFIG: SimulationConfig = {
  gridSize: 200,
  cellSizeMeters: 50,
  windSpeed: 20,
  windDirection: 270, // westerly
  humidity: 30,
  defaultFuel: FuelType.Grass,
  timestepMinutes: 15,
};
```

**Step 2: Write failing test for grid creation**

Create `src/simulation/__tests__/grid.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createGrid, igniteCell, getCell } from "../grid";
import { CellState, FuelType, DEFAULT_CONFIG } from "../types";

describe("createGrid", () => {
  it("creates a grid of correct size with all cells unburned", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 10 };
    const grid = createGrid(config, 36.7, -119.5, () => 100);

    expect(grid.length).toBe(10 * 10);
    for (let i = 0; i < grid.length; i++) {
      const cell = grid[i];
      expect(cell.state).toBe(CellState.Unburned);
      expect(cell.fuel).toBe(FuelType.Grass);
      expect(cell.burnTimer).toBe(0);
    }
  });

  it("assigns lat/lng based on center and cell size", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 3, cellSizeMeters: 1000 };
    const grid = createGrid(config, 0, 0, () => 0);

    // Center cell (1,1) should be closest to (0, 0)
    const center = grid[1 * 3 + 1];
    expect(Math.abs(center.lat)).toBeLessThan(0.01);
    expect(Math.abs(center.lng)).toBeLessThan(0.01);
  });
});

describe("igniteCell", () => {
  it("sets cell to burning with correct burn timer", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 5 };
    const grid = createGrid(config, 0, 0, () => 0);

    igniteCell(grid, 2, 2, config.gridSize);

    const cell = getCell(grid, 2, 2, config.gridSize);
    expect(cell.state).toBe(CellState.Burning);
    expect(cell.burnTimer).toBeGreaterThan(0);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run src/simulation/__tests__/grid.test.ts`
Expected: FAIL — module `../grid` not found.

**Step 4: Implement grid**

Create `src/simulation/grid.ts`:
```ts
import {
  CellState,
  FuelType,
  FUEL_PROPERTIES,
  type GridCell,
  type SimulationConfig,
} from "./types";

/**
 * Create the simulation grid centered on (centerLat, centerLng).
 * elevationFn returns elevation in meters for a given (lat, lng).
 */
export function createGrid(
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
  elevationFn: (lat: number, lng: number) => number
): GridCell[] {
  const { gridSize, cellSizeMeters, defaultFuel } = config;
  const grid: GridCell[] = new Array(gridSize * gridSize);

  // Approximate degrees per meter at this latitude
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

  const halfGrid = gridSize / 2;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const offsetRow = row - halfGrid;
      const offsetCol = col - halfGrid;

      const lat = centerLat + (offsetRow * cellSizeMeters) / metersPerDegreeLat;
      const lng =
        centerLng + (offsetCol * cellSizeMeters) / metersPerDegreeLng;

      grid[row * gridSize + col] = {
        state: CellState.Unburned,
        fuel: defaultFuel,
        elevation: elevationFn(lat, lng),
        burnTimer: 0,
        lat,
        lng,
      };
    }
  }

  return grid;
}

export function getCell(
  grid: GridCell[],
  row: number,
  col: number,
  gridSize: number
): GridCell {
  return grid[row * gridSize + col];
}

export function igniteCell(
  grid: GridCell[],
  row: number,
  col: number,
  gridSize: number
): void {
  const cell = grid[row * gridSize + col];
  cell.state = CellState.Burning;
  cell.burnTimer = FUEL_PROPERTIES[cell.fuel].burnDuration;
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/simulation/__tests__/grid.test.ts`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add src/simulation/
git commit -m "feat: add simulation grid types and creation"
```

---

## Task 4: Simulation Engine — Spread Logic

**Files:**
- Create: `src/simulation/spread.ts`
- Test: `src/simulation/__tests__/spread.test.ts`

**Step 1: Write failing tests for spread logic**

Create `src/simulation/__tests__/spread.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { simulateStep, computeSpreadRate } from "../spread";
import { createGrid, igniteCell, getCell } from "../grid";
import { CellState, FuelType, DEFAULT_CONFIG } from "../types";

describe("computeSpreadRate", () => {
  it("returns higher rate when spreading uphill", () => {
    const downhill = computeSpreadRate({
      slopeAngle: -10,
      windAlignment: 0,
      humidity: 30,
      fuel: FuelType.Grass,
    });
    const uphill = computeSpreadRate({
      slopeAngle: 10,
      windAlignment: 0,
      humidity: 30,
      fuel: FuelType.Grass,
    });
    expect(uphill).toBeGreaterThan(downhill);
  });

  it("returns higher rate when wind-aligned", () => {
    const against = computeSpreadRate({
      slopeAngle: 0,
      windAlignment: -1,
      humidity: 30,
      fuel: FuelType.Grass,
    });
    const aligned = computeSpreadRate({
      slopeAngle: 0,
      windAlignment: 1,
      humidity: 30,
      fuel: FuelType.Grass,
    });
    expect(aligned).toBeGreaterThan(against);
  });

  it("returns lower rate with high humidity", () => {
    const dry = computeSpreadRate({
      slopeAngle: 0,
      windAlignment: 0,
      humidity: 10,
      fuel: FuelType.Grass,
    });
    const wet = computeSpreadRate({
      slopeAngle: 0,
      windAlignment: 0,
      humidity: 90,
      fuel: FuelType.Grass,
    });
    expect(dry).toBeGreaterThan(wet);
  });
});

describe("simulateStep", () => {
  it("spreads fire to adjacent cells from a burning cell", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 5, windSpeed: 0, humidity: 0 };
    const grid = createGrid(config, 0, 0, () => 0);
    igniteCell(grid, 2, 2, config.gridSize);

    // Run several steps — fire should spread to at least one neighbor
    let currentGrid = grid;
    for (let i = 0; i < 3; i++) {
      currentGrid = simulateStep(currentGrid, config);
    }

    // At least one neighbor of (2,2) should be burning or burned
    const neighbors = [
      [1, 1], [1, 2], [1, 3],
      [2, 1],         [2, 3],
      [3, 1], [3, 2], [3, 3],
    ];
    const anySpread = neighbors.some(([ r, c ]) => {
      const cell = getCell(currentGrid, r, c, config.gridSize);
      return cell.state !== CellState.Unburned;
    });
    expect(anySpread).toBe(true);
  });

  it("burning cells eventually burn out", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 3 };
    const grid = createGrid(config, 0, 0, () => 0);
    igniteCell(grid, 1, 1, config.gridSize);

    let currentGrid = grid;
    for (let i = 0; i < 20; i++) {
      currentGrid = simulateStep(currentGrid, config);
    }

    const cell = getCell(currentGrid, 1, 1, config.gridSize);
    expect(cell.state).toBe(CellState.Burned);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/simulation/__tests__/spread.test.ts`
Expected: FAIL — module `../spread` not found.

**Step 3: Implement spread logic**

Create `src/simulation/spread.ts`:
```ts
import {
  CellState,
  FuelType,
  FUEL_PROPERTIES,
  type GridCell,
  type SimulationConfig,
} from "./types";

interface SpreadParams {
  slopeAngle: number; // degrees, positive = uphill
  windAlignment: number; // -1 (against) to +1 (aligned)
  humidity: number; // 0-100
  fuel: FuelType;
}

/**
 * Compute spread rate (0-1 probability of ignition per timestep).
 * Simplified Rothermel: R = R0 * (1 + phi_wind + phi_slope) * humidity_factor
 */
export function computeSpreadRate(params: SpreadParams): number {
  const { slopeAngle, windAlignment, humidity, fuel } = params;
  const fuelProps = FUEL_PROPERTIES[fuel];

  const R0 = fuelProps.spreadRate;

  // Slope factor: positive slope = faster spread
  const phiSlope = Math.max(-0.5, slopeAngle * 0.03);

  // Wind factor: alignment from -1 to +1
  const phiWind = windAlignment * 0.5;

  // Humidity dampening: 0% humidity = full rate, 100% = near zero
  const humidityFactor = Math.max(0, 1 - humidity / 120);

  const rate = R0 * (1 + phiWind + phiSlope) * humidityFactor * fuelProps.ignitionRate;
  return Math.max(0, Math.min(1, rate));
}

/**
 * Compute wind alignment for a spread direction.
 * Returns -1 (directly against wind) to +1 (directly with wind).
 */
function windAlignment(
  dRow: number,
  dCol: number,
  windDirection: number
): number {
  // Wind direction: 0=N, 90=E, 180=S, 270=W
  // Convert to unit vector (wind blows FROM this direction)
  const windRad = ((windDirection + 180) * Math.PI) / 180;
  const windDr = -Math.cos(windRad); // row direction (N is -row)
  const windDc = Math.sin(windRad); // col direction (E is +col)

  const len = Math.sqrt(dRow * dRow + dCol * dCol);
  if (len === 0) return 0;

  return (dRow * windDr + dCol * windDc) / len;
}

const NEIGHBOR_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/**
 * Run one simulation timestep. Returns a new grid (does not mutate input).
 */
export function simulateStep(
  grid: GridCell[],
  config: SimulationConfig
): GridCell[] {
  const { gridSize, windSpeed, windDirection, humidity, cellSizeMeters } = config;
  const newGrid: GridCell[] = grid.map((cell) => ({ ...cell }));

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      const cell = grid[idx];

      // Decrement burn timer for burning cells
      if (cell.state === CellState.Burning) {
        newGrid[idx].burnTimer = cell.burnTimer - 1;
        if (newGrid[idx].burnTimer <= 0) {
          newGrid[idx].state = CellState.Burned;
        }
      }

      // Spread fire from burning cells
      if (cell.state === CellState.Burning) {
        for (const [dr, dc] of NEIGHBOR_OFFSETS) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;

          const nIdx = nr * gridSize + nc;
          const neighbor = grid[nIdx];
          if (neighbor.state !== CellState.Unburned) continue;

          // Compute slope angle between cells
          const elevDiff = neighbor.elevation - cell.elevation;
          const dist = Math.sqrt(dr * dr + dc * dc) * cellSizeMeters;
          const slopeAngle = (Math.atan2(elevDiff, dist) * 180) / Math.PI;

          // Wind effect scaled by wind speed
          const wAlign = windAlignment(dr, dc, windDirection) * Math.min(windSpeed / 30, 1);

          const rate = computeSpreadRate({
            slopeAngle,
            windAlignment: wAlign,
            humidity,
            fuel: neighbor.fuel,
          });

          if (Math.random() < rate) {
            newGrid[nIdx].state = CellState.Burning;
            newGrid[nIdx].burnTimer = FUEL_PROPERTIES[neighbor.fuel].burnDuration;
          }
        }
      }
    }
  }

  return newGrid;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/simulation/__tests__/spread.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/simulation/
git commit -m "feat: add fire spread simulation with wind, slope, fuel factors"
```

---

## Task 5: Simulation Runner & State History

**Files:**
- Create: `src/simulation/runner.ts`
- Test: `src/simulation/__tests__/runner.test.ts`

**Step 1: Write failing tests for runner**

Create `src/simulation/__tests__/runner.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runSimulation } from "../runner";
import { CellState, DEFAULT_CONFIG } from "../types";

describe("runSimulation", () => {
  it("produces state history with correct number of snapshots", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 10 };
    const maxSteps = 20;
    const result = runSimulation(config, 5, 5, () => 0, maxSteps);

    expect(result.history.length).toBeLessThanOrEqual(maxSteps + 1); // includes initial
    expect(result.history.length).toBeGreaterThan(1);
    expect(result.config).toEqual(config);
  });

  it("first snapshot has only the ignition point burning", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 10 };
    const result = runSimulation(config, 5, 5, () => 0, 10);

    const first = result.history[0];
    expect(first.timestep).toBe(0);

    let burningCount = 0;
    for (let i = 0; i < first.grid.length; i++) {
      if (first.grid[i] === CellState.Burning) burningCount++;
    }
    expect(burningCount).toBe(1);
    expect(first.grid[5 * 10 + 5]).toBe(CellState.Burning);
  });

  it("stops early if no cells are burning", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 5, humidity: 100 };
    const result = runSimulation(config, 2, 2, () => 0, 500);

    // With 100% humidity fire won't spread, and original cell will burn out
    expect(result.history.length).toBeLessThan(500);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/simulation/__tests__/runner.test.ts`
Expected: FAIL — module `../runner` not found.

**Step 3: Implement runner**

Create `src/simulation/runner.ts`:
```ts
import { CellState, type SimulationConfig, type SimulationResult, type SimulationState } from "./types";
import { createGrid, igniteCell } from "./grid";
import { simulateStep } from "./spread";
import type { GridCell } from "./types";

function snapshotGrid(grid: GridCell[], gridSize: number): Uint8Array {
  const snapshot = new Uint8Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) {
    snapshot[i] = grid[i].state;
  }
  return snapshot;
}

export function runSimulation(
  config: SimulationConfig,
  igniteRow: number,
  igniteCol: number,
  elevationFn: (lat: number, lng: number) => number,
  maxSteps: number
): SimulationResult {
  let grid = createGrid(config, 0, 0, elevationFn);
  igniteCell(grid, igniteRow, igniteCol, config.gridSize);

  const history: SimulationState[] = [
    { grid: snapshotGrid(grid, config.gridSize), timestep: 0 },
  ];

  for (let step = 1; step <= maxSteps; step++) {
    grid = simulateStep(grid, config);

    history.push({
      grid: snapshotGrid(grid, config.gridSize),
      timestep: step,
    });

    // Stop if no cells are burning
    const hasBurning = grid.some((cell) => cell.state === CellState.Burning);
    if (!hasBurning) break;
  }

  return { history, config };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/simulation/__tests__/runner.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/simulation/
git commit -m "feat: add simulation runner with state history snapshots"
```

---

## Task 6: Web Worker Integration

**Files:**
- Create: `src/simulation/worker.ts`, `src/simulation/useSimulation.ts`
- Modify: `tsconfig.json` (add `"lib": ["WebWorker"]` if needed)

**Step 1: Create the Web Worker**

Create `src/simulation/worker.ts`:
```ts
import { runSimulation } from "./runner";
import type { SimulationConfig } from "./types";

export interface WorkerRequest {
  type: "run";
  config: SimulationConfig;
  igniteRow: number;
  igniteCol: number;
  maxSteps: number;
}

export interface WorkerResponse {
  type: "progress" | "complete";
  /** For progress: current step. For complete: total steps. */
  step: number;
  /** Only present on "complete" */
  history?: { grid: number[]; timestep: number }[];
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { config, igniteRow, igniteCol, maxSteps } = e.data;

  // Use flat elevation for now — real elevation sampling happens in a later task
  const result = runSimulation(config, igniteRow, igniteCol, () => 0, maxSteps);

  // Convert Uint8Arrays to regular arrays for structured cloning
  const serializableHistory = result.history.map((s) => ({
    grid: Array.from(s.grid),
    timestep: s.timestep,
  }));

  const response: WorkerResponse = {
    type: "complete",
    step: result.history.length,
    history: serializableHistory,
  };
  self.postMessage(response);
};
```

**Step 2: Create useSimulation hook**

Create `src/simulation/useSimulation.ts`:
```ts
import { useState, useRef, useCallback } from "react";
import type { SimulationConfig, SimulationState } from "./types";
import type { WorkerResponse } from "./worker";

interface UseSimulationReturn {
  history: SimulationState[];
  isRunning: boolean;
  startSimulation: (
    config: SimulationConfig,
    igniteRow: number,
    igniteCol: number,
    maxSteps?: number
  ) => void;
  reset: () => void;
}

export function useSimulation(): UseSimulationReturn {
  const [history, setHistory] = useState<SimulationState[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  const startSimulation = useCallback(
    (
      config: SimulationConfig,
      igniteRow: number,
      igniteCol: number,
      maxSteps = 500
    ) => {
      // Terminate any existing worker
      workerRef.current?.terminate();

      const worker = new Worker(
        new URL("./worker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current = worker;
      setIsRunning(true);
      setHistory([]);

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "complete" && e.data.history) {
          const states: SimulationState[] = e.data.history.map((s) => ({
            grid: new Uint8Array(s.grid),
            timestep: s.timestep,
          }));
          setHistory(states);
          setIsRunning(false);
          worker.terminate();
        }
      };

      worker.postMessage({ type: "run", config, igniteRow, igniteCol, maxSteps });
    },
    []
  );

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    setHistory([]);
    setIsRunning(false);
  }, []);

  return { history, isRunning, startSimulation, reset };
}
```

**Step 3: Verify worker loads**

This is integration-level; manual verification with `npm run dev`. Import `useSimulation` in App temporarily and trigger a simulation with a button. Check console for no errors.

**Step 4: Commit**

```bash
git add src/simulation/
git commit -m "feat: add Web Worker integration and useSimulation hook"
```

---

## Task 7: Control Panel UI

**Files:**
- Create: `src/components/ControlPanel.tsx`
- Modify: `src/App.tsx`

**Step 1: Create ControlPanel component**

Create `src/components/ControlPanel.tsx`:
```tsx
import { useState } from "react";
import { FuelType, DEFAULT_CONFIG, type SimulationConfig } from "../simulation/types";

interface ControlPanelProps {
  onStart: (config: SimulationConfig) => void;
  onReset: () => void;
  isRunning: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function ControlPanel({
  onStart,
  onReset,
  isRunning,
  collapsed,
  onToggleCollapse,
}: ControlPanelProps) {
  const [config, setConfig] = useState<SimulationConfig>({ ...DEFAULT_CONFIG });
  const [mode, setMode] = useState<"ignite" | "scenario">("ignite");

  const update = (partial: Partial<SimulationConfig>) =>
    setConfig((prev) => ({ ...prev, ...partial }));

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="absolute top-4 left-4 z-50 bg-gray-900/90 text-white px-3 py-2 rounded-lg hover:bg-gray-800 backdrop-blur"
      >
        Controls &rsaquo;
      </button>
    );
  }

  return (
    <div className="absolute top-0 left-0 z-50 h-full w-80 bg-gray-900/90 backdrop-blur text-white p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">Wildfire Simulator</h2>
        <button onClick={onToggleCollapse} className="text-gray-400 hover:text-white">
          &lsaquo;
        </button>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode("ignite")}
          className={`flex-1 py-1.5 rounded text-sm ${
            mode === "ignite" ? "bg-orange-600" : "bg-gray-700 hover:bg-gray-600"
          }`}
        >
          Click to Ignite
        </button>
        <button
          onClick={() => setMode("scenario")}
          className={`flex-1 py-1.5 rounded text-sm ${
            mode === "scenario" ? "bg-orange-600" : "bg-gray-700 hover:bg-gray-600"
          }`}
        >
          Scenarios
        </button>
      </div>

      {/* Parameter Sliders */}
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-300">
            Wind Speed: {config.windSpeed} km/h
          </span>
          <input
            type="range"
            min={0}
            max={60}
            value={config.windSpeed}
            onChange={(e) => update({ windSpeed: Number(e.target.value) })}
            className="accent-orange-500"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-300">
            Wind Direction: {config.windDirection}°
          </span>
          <input
            type="range"
            min={0}
            max={360}
            value={config.windDirection}
            onChange={(e) => update({ windDirection: Number(e.target.value) })}
            className="accent-orange-500"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-300">
            Humidity: {config.humidity}%
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={config.humidity}
            onChange={(e) => update({ humidity: Number(e.target.value) })}
            className="accent-orange-500"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-300">Vegetation</span>
          <select
            value={config.defaultFuel}
            onChange={(e) => update({ defaultFuel: e.target.value as FuelType })}
            className="bg-gray-700 rounded px-2 py-1 text-sm"
          >
            <option value={FuelType.Grass}>Grass</option>
            <option value={FuelType.Shrub}>Shrub</option>
            <option value={FuelType.Forest}>Forest</option>
          </select>
        </label>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        <button
          onClick={() => onStart(config)}
          disabled={isRunning}
          className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-2 rounded font-medium"
        >
          {isRunning ? "Running..." : "Start"}
        </button>
        <button
          onClick={onReset}
          className="flex-1 bg-gray-700 hover:bg-gray-600 py-2 rounded font-medium"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Wire into App**

Update `src/App.tsx` to include ControlPanel alongside GlobeView with state management. Pass `onStart`/`onReset`/`isRunning` props connected to `useSimulation`.

**Step 3: Verify UI renders**

Run: `npm run dev`
Expected: Left sidebar with sliders, mode toggle, and buttons.

**Step 4: Commit**

```bash
git add src/components/ControlPanel.tsx src/App.tsx
git commit -m "feat: add control panel with parameter sliders and mode toggle"
```

---

## Task 8: Timeline Bar

**Files:**
- Create: `src/components/TimelineBar.tsx`
- Modify: `src/App.tsx`

**Step 1: Create TimelineBar component**

Create `src/components/TimelineBar.tsx`:
```tsx
import { useState, useEffect, useRef, useCallback } from "react";

interface TimelineBarProps {
  totalSteps: number;
  currentStep: number;
  onStepChange: (step: number) => void;
  timestepMinutes: number;
}

export default function TimelineBar({
  totalSteps,
  currentStep,
  onStepChange,
  timestepMinutes,
}: TimelineBarProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const formatTime = (step: number) => {
    const totalMinutes = step * timestepMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `T+${hours}h ${minutes.toString().padStart(2, "0")}m`;
  };

  const advance = useCallback(() => {
    onStepChange(Math.min(currentStep + 1, totalSteps - 1));
  }, [currentStep, totalSteps, onStepChange]);

  useEffect(() => {
    if (isPlaying && currentStep < totalSteps - 1) {
      intervalRef.current = setInterval(advance, 200 / speed);
    } else {
      if (currentStep >= totalSteps - 1) setIsPlaying(false);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, speed, advance, currentStep, totalSteps]);

  if (totalSteps === 0) return null;

  const speeds = [0.5, 1, 2, 5];

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 bg-gray-900/90 backdrop-blur text-white px-4 py-3 flex items-center gap-4">
      <button
        onClick={() => setIsPlaying(!isPlaying)}
        className="w-10 h-10 flex items-center justify-center bg-orange-600 hover:bg-orange-500 rounded-full text-lg"
      >
        {isPlaying ? "⏸" : "▶"}
      </button>

      <input
        type="range"
        min={0}
        max={totalSteps - 1}
        value={currentStep}
        onChange={(e) => {
          setIsPlaying(false);
          onStepChange(Number(e.target.value));
        }}
        className="flex-1 accent-orange-500"
      />

      <span className="text-sm font-mono w-28 text-center">
        {formatTime(currentStep)}
      </span>

      <div className="flex gap-1">
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-2 py-1 rounded text-xs ${
              speed === s ? "bg-orange-600" : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Wire into App with currentStep state**

In `src/App.tsx`, add `currentStep` state, pass it to `TimelineBar` and use it to index into `history` from `useSimulation`.

**Step 3: Verify timeline renders and scrubs**

Run: `npm run dev`
Expected: Bottom bar appears after simulation runs. Scrubber, play/pause, speed buttons work.

**Step 4: Commit**

```bash
git add src/components/TimelineBar.tsx src/App.tsx
git commit -m "feat: add timeline bar with play/pause, scrubber, and speed control"
```

---

## Task 9: Fire Overlay Rendering on Globe

**Files:**
- Create: `src/components/FireOverlay.tsx`
- Modify: `src/components/GlobeView.tsx`

**Step 1: Create FireOverlay component**

Create `src/components/FireOverlay.tsx`:
```tsx
import { useMemo } from "react";
import { Entity, RectangleGraphics } from "resium";
import { Rectangle, Color } from "cesium";
import { CellState, type SimulationState, type SimulationConfig } from "../simulation/types";

interface FireOverlayProps {
  state: SimulationState | null;
  config: SimulationConfig;
  centerLat: number;
  centerLng: number;
}

export default function FireOverlay({
  state,
  config,
  centerLat,
  centerLng,
}: FireOverlayProps) {
  const cells = useMemo(() => {
    if (!state) return [];

    const { gridSize, cellSizeMeters } = config;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
    const halfGrid = gridSize / 2;
    const cellLat = cellSizeMeters / metersPerDegreeLat;
    const cellLng = cellSizeMeters / metersPerDegreeLng;

    const result: { key: string; rect: Rectangle; color: Color }[] = [];

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cellState = state.grid[row * gridSize + col];
        if (cellState === CellState.Unburned) continue;

        const lat = centerLat + (row - halfGrid) * cellLat;
        const lng = centerLng + (col - halfGrid) * cellLng;

        const rect = Rectangle.fromDegrees(
          lng - cellLng / 2,
          lat - cellLat / 2,
          lng + cellLng / 2,
          lat + cellLat / 2
        );

        const color =
          cellState === CellState.Burning
            ? Color.ORANGE.withAlpha(0.7)
            : Color.BLACK.withAlpha(0.5);

        result.push({ key: `${row}-${col}`, rect, color });
      }
    }

    return result;
  }, [state, config, centerLat, centerLng]);

  return (
    <>
      {cells.map(({ key, rect, color }) => (
        <Entity key={key}>
          <RectangleGraphics
            coordinates={rect}
            material={color}
            classificationType={1} /* TERRAIN */
          />
        </Entity>
      ))}
    </>
  );
}
```

**Note:** For large grids (200x200 = 40000 cells), rendering individual entities will be slow. In a later optimization step, we'll switch to a `Primitive` collection or a `GroundPrimitive` with batched geometry. For initial development, we'll use a smaller grid (e.g., 50x50) and optimize later.

**Step 2: Integrate into GlobeView**

Update `GlobeView` to accept `state`, `config`, `centerLat`, `centerLng` props and render `<FireOverlay />` inside the `<Viewer>`.

**Step 3: Verify fire renders on globe**

Run: `npm run dev`
Start a simulation — orange/black rectangles should appear on the terrain.

**Step 4: Commit**

```bash
git add src/components/FireOverlay.tsx src/components/GlobeView.tsx
git commit -m "feat: render fire spread overlay on CesiumJS globe"
```

---

## Task 10: Click-to-Ignite Interaction

**Files:**
- Modify: `src/components/GlobeView.tsx`
- Modify: `src/App.tsx`

**Step 1: Add click handler to GlobeView**

In `GlobeView`, add a `ScreenSpaceEventHandler` that:
1. Picks the globe position from a click
2. Converts Cartesian3 to lat/lng (using `Cartographic.fromCartesian`)
3. Calls an `onIgnite(lat, lng)` callback prop

```tsx
import { ScreenSpaceEventHandler, ScreenSpaceEvent } from "resium";
import { ScreenSpaceEventType, Cartographic, Math as CesiumMath } from "cesium";

// Inside <Viewer>:
<ScreenSpaceEventHandler>
  <ScreenSpaceEvent
    action={(event: { position: Cartesian2 }) => {
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer || !onIgnite) return;
      const cartesian = viewer.scene.pickPosition(event.position);
      if (!cartesian) return;
      const carto = Cartographic.fromCartesian(cartesian);
      onIgnite(
        CesiumMath.toDegrees(carto.latitude),
        CesiumMath.toDegrees(carto.longitude)
      );
    }}
    type={ScreenSpaceEventType.LEFT_CLICK}
  />
</ScreenSpaceEventHandler>
```

**Step 2: Wire into App**

In `App.tsx`:
- Store `ignitionPoint` state `{ lat, lng }`.
- On ignite: store the point, compute the grid center row/col (center of grid), call `startSimulation`.
- Pass `ignitionPoint` center to `FireOverlay`.

**Step 3: Verify click-to-ignite works**

Run: `npm run dev`
Expected: Click on globe → fire simulation starts from that point, overlay appears.

**Step 4: Commit**

```bash
git add src/components/GlobeView.tsx src/App.tsx
git commit -m "feat: add click-to-ignite interaction on globe"
```

---

## Task 11: Pre-built Scenarios

**Files:**
- Create: `src/scenarios.ts`
- Modify: `src/components/ControlPanel.tsx`
- Modify: `src/App.tsx`

**Step 1: Define scenarios**

Create `src/scenarios.ts`:
```ts
import { FuelType, type SimulationConfig, DEFAULT_CONFIG } from "./simulation/types";

export interface Scenario {
  name: string;
  description: string;
  location: { lat: number; lng: number; altitude: number };
  config: SimulationConfig;
  igniteOffset: { row: number; col: number };
}

export const SCENARIOS: Scenario[] = [
  {
    name: "California Grassland",
    description:
      "Watch how fire spreads rapidly and uniformly across flat grassland with moderate westerly winds.",
    location: { lat: 36.7, lng: -119.5, altitude: 50000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Grass,
      windSpeed: 25,
      windDirection: 270,
      humidity: 20,
    },
    igniteOffset: { row: 100, col: 100 },
  },
  {
    name: "Rocky Mountain Forest",
    description:
      "Notice how fire accelerates dramatically as it moves uphill through dense forest.",
    location: { lat: 39.7, lng: -105.5, altitude: 50000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Forest,
      windSpeed: 10,
      windDirection: 180,
      humidity: 35,
    },
    igniteOffset: { row: 150, col: 100 },
  },
  {
    name: "Australian Bushland",
    description:
      "Strong northwesterly winds drive fire through dry shrubland at alarming speed.",
    location: { lat: -33.7, lng: 150.3, altitude: 50000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Shrub,
      windSpeed: 45,
      windDirection: 315,
      humidity: 15,
    },
    igniteOffset: { row: 120, col: 120 },
  },
  {
    name: "Mediterranean Hillside",
    description:
      "The strong mistral wind channels fire through coastal hills with mixed vegetation.",
    location: { lat: 43.3, lng: 5.4, altitude: 50000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Shrub,
      windSpeed: 40,
      windDirection: 340,
      humidity: 25,
    },
    igniteOffset: { row: 100, col: 80 },
  },
  {
    name: "Canyon Fire",
    description:
      "See how narrow canyon terrain funnels and accelerates fire spread.",
    location: { lat: 34.2, lng: -118.2, altitude: 30000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Shrub,
      windSpeed: 20,
      windDirection: 180,
      humidity: 20,
    },
    igniteOffset: { row: 160, col: 100 },
  },
];
```

**Step 2: Add scenario picker to ControlPanel**

When mode is "scenario", show a dropdown of `SCENARIOS` with name and description. On selection + Start, emit the scenario's config and ignition point via a new `onStartScenario(scenario: Scenario)` prop.

**Step 3: Wire into App**

When a scenario is selected, fly the camera to `scenario.location` and start the simulation with the scenario's config and ignition offset.

**Step 4: Verify scenarios work**

Run: `npm run dev`
Expected: Switch to "Scenarios" mode, pick "California Grassland", click Start. Camera flies to Central Valley, fire starts.

**Step 5: Commit**

```bash
git add src/scenarios.ts src/components/ControlPanel.tsx src/App.tsx
git commit -m "feat: add 5 pre-built wildfire scenarios"
```

---

## Task 12: Particle Effects at Fire Front

**Files:**
- Create: `src/components/FireParticles.tsx`
- Modify: `src/components/GlobeView.tsx`

**Step 1: Create particle system component**

Create `src/components/FireParticles.tsx`:
```tsx
import { useMemo } from "react";
import { ParticleSystem } from "resium";
import {
  Cartesian3,
  Color,
  CircleEmitter,
  Cartesian2,
} from "cesium";
import { CellState, type SimulationState, type SimulationConfig } from "../simulation/types";

interface FireParticlesProps {
  state: SimulationState | null;
  config: SimulationConfig;
  centerLat: number;
  centerLng: number;
}

/**
 * Renders particle emitters at a sampled subset of burning cells
 * on the fire front (burning cells with at least one unburned neighbor).
 */
export default function FireParticles({
  state,
  config,
  centerLat,
  centerLng,
}: FireParticlesProps) {
  const emitterPositions = useMemo(() => {
    if (!state) return [];

    const { gridSize, cellSizeMeters } = config;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
    const halfGrid = gridSize / 2;
    const cellLat = cellSizeMeters / metersPerDegreeLat;
    const cellLng = cellSizeMeters / metersPerDegreeLng;

    const frontCells: Cartesian3[] = [];

    for (let row = 1; row < gridSize - 1; row++) {
      for (let col = 1; col < gridSize - 1; col++) {
        if (state.grid[row * gridSize + col] !== CellState.Burning) continue;

        // Check if on fire front (has at least one unburned neighbor)
        const hasUnburnedNeighbor = [
          state.grid[(row - 1) * gridSize + col],
          state.grid[(row + 1) * gridSize + col],
          state.grid[row * gridSize + col - 1],
          state.grid[row * gridSize + col + 1],
        ].some((s) => s === CellState.Unburned);

        if (!hasUnburnedNeighbor) continue;

        const lat = centerLat + (row - halfGrid) * cellLat;
        const lng = centerLng + (col - halfGrid) * cellLng;
        frontCells.push(Cartesian3.fromDegrees(lng, lat, 50));
      }
    }

    // Sample max 50 emitters for performance
    if (frontCells.length > 50) {
      const step = Math.ceil(frontCells.length / 50);
      return frontCells.filter((_, i) => i % step === 0);
    }
    return frontCells;
  }, [state, config, centerLat, centerLng]);

  return (
    <>
      {emitterPositions.map((pos, i) => (
        <ParticleSystem
          key={i}
          modelMatrix={Cartesian3.equals(pos, Cartesian3.ZERO) ? undefined : (() => {
            const m = new Float64Array(16);
            // Simple translation matrix
            return undefined; // Placeholder — use Cesium Transforms
          })()}
          emitter={new CircleEmitter(30.0)}
          emitterModelMatrix={undefined}
          startColor={Color.fromCssColorString("#FF4500").withAlpha(0.8)}
          endColor={Color.fromCssColorString("#FFD700").withAlpha(0.0)}
          startScale={1.0}
          endScale={3.0}
          minimumParticleLife={0.5}
          maximumParticleLife={1.5}
          minimumSpeed={5.0}
          maximumSpeed={15.0}
          emissionRate={20}
          minimumImageSize={new Cartesian2(10, 10)}
          maximumImageSize={new Cartesian2(20, 20)}
          lifetime={16.0}
        />
      ))}
    </>
  );
}
```

**Note:** Cesium's particle system API requires an image texture and a `modelMatrix` for positioning. The exact implementation will need adjustments during development. The key approach: identify fire-front cells (burning cells adjacent to unburned), sample up to ~50 positions, render particle emitters there. If particle system performance is problematic, fall back to billboard-based fire icons at the front.

**Step 2: Integrate into GlobeView**

Add `<FireParticles>` inside the `<Viewer>` component.

**Step 3: Verify particles render**

Run: `npm run dev`
Expected: Small flame/ember particles at the leading edge of the fire.

**Step 4: Commit**

```bash
git add src/components/FireParticles.tsx src/components/GlobeView.tsx
git commit -m "feat: add particle effects at fire front"
```

---

## Task 13: Info Tooltip on Hover

**Files:**
- Create: `src/components/InfoTooltip.tsx`
- Modify: `src/components/GlobeView.tsx`, `src/App.tsx`

**Step 1: Create InfoTooltip component**

Create `src/components/InfoTooltip.tsx`:
```tsx
interface InfoTooltipProps {
  x: number;
  y: number;
  cellState: string;
  elevation: number;
  fuel: string;
  visible: boolean;
}

export default function InfoTooltip({
  x,
  y,
  cellState,
  elevation,
  fuel,
  visible,
}: InfoTooltipProps) {
  if (!visible) return null;

  return (
    <div
      className="absolute z-50 bg-gray-900/90 backdrop-blur text-white text-xs px-3 py-2 rounded-lg pointer-events-none"
      style={{ left: x + 15, top: y - 10 }}
    >
      <div>State: {cellState}</div>
      <div>Elevation: {elevation.toFixed(0)}m</div>
      <div>Fuel: {fuel}</div>
    </div>
  );
}
```

**Step 2: Add mouse move handler to GlobeView**

On `MOUSE_MOVE`, pick position → convert to lat/lng → find nearest grid cell → pass cell info up to App via callback. App renders `<InfoTooltip>`.

**Step 3: Verify tooltip shows**

Run: `npm run dev`
Expected: Hovering over fire area shows tooltip with cell info.

**Step 4: Commit**

```bash
git add src/components/InfoTooltip.tsx src/components/GlobeView.tsx src/App.tsx
git commit -m "feat: add info tooltip on hover over fire cells"
```

---

## Task 14: Performance Optimization — Batched Fire Rendering

**Files:**
- Modify: `src/components/FireOverlay.tsx`

**Step 1: Replace individual entities with a single primitive**

Instead of creating one `<Entity>` per burning/burned cell (which won't scale to 200x200), switch to using Cesium's `GroundPrimitive` with a `GeometryInstance` collection.

Use a single `<CustomDataSource>` or direct Cesium primitive API:
- Create rectangle geometries for all active cells
- Batch into a single `GroundPrimitive`
- Update the primitive when `state` changes

This is a performance-critical refactor. The approach:
```ts
// In a useEffect that reacts to state changes:
const instances = activeCells.map(
  (cell) =>
    new GeometryInstance({
      geometry: new RectangleGeometry({ rectangle: cell.rect }),
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(cell.color),
      },
    })
);

const primitive = new GroundPrimitive({
  geometryInstances: instances,
  appearance: new PerInstanceColorAppearance(),
});

viewer.scene.primitives.add(primitive);
```

**Step 2: Test with full 200x200 grid**

Change `DEFAULT_CONFIG.gridSize` to 200, run simulation, verify smooth rendering.

**Step 3: Commit**

```bash
git add src/components/FireOverlay.tsx
git commit -m "perf: batch fire overlay rendering with GroundPrimitive"
```

---

## Task 15: Integration — Wire Everything Together in App.tsx

**Files:**
- Modify: `src/App.tsx`

**Step 1: Full App integration**

Wire all components together in `src/App.tsx`:

```tsx
import { useState, useCallback } from "react";
import GlobeView from "./components/GlobeView";
import ControlPanel from "./components/ControlPanel";
import TimelineBar from "./components/TimelineBar";
import InfoTooltip from "./components/InfoTooltip";
import { useSimulation } from "./simulation/useSimulation";
import { DEFAULT_CONFIG, type SimulationConfig } from "./simulation/types";
import { SCENARIOS, type Scenario } from "./scenarios";

function App() {
  const { history, isRunning, startSimulation, reset } = useSimulation();
  const [currentStep, setCurrentStep] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [ignitionPoint, setIgnitionPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; altitude: number } | null>(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, cellState: "", elevation: 0, fuel: "" });
  const [activeConfig, setActiveConfig] = useState<SimulationConfig>(DEFAULT_CONFIG);

  const handleIgnite = useCallback((lat: number, lng: number) => {
    setIgnitionPoint({ lat, lng });
    // Ignition at center of grid
    const center = Math.floor(DEFAULT_CONFIG.gridSize / 2);
    startSimulation(activeConfig, center, center);
    setCurrentStep(0);
  }, [activeConfig, startSimulation]);

  const handleStartScenario = useCallback((scenario: Scenario) => {
    setIgnitionPoint({ lat: scenario.location.lat, lng: scenario.location.lng });
    setFlyTo(scenario.location);
    setActiveConfig(scenario.config);
    startSimulation(scenario.config, scenario.igniteOffset.row, scenario.igniteOffset.col);
    setCurrentStep(0);
  }, [startSimulation]);

  const handleReset = useCallback(() => {
    reset();
    setCurrentStep(0);
    setIgnitionPoint(null);
  }, [reset]);

  const currentState = history[currentStep] ?? null;

  return (
    <div className="h-screen w-screen relative">
      <GlobeView
        fireState={currentState}
        fireConfig={activeConfig}
        centerLat={ignitionPoint?.lat ?? 0}
        centerLng={ignitionPoint?.lng ?? 0}
        flyTo={flyTo}
        onIgnite={handleIgnite}
        onHover={setTooltip}
      />
      <ControlPanel
        onStart={(config) => { setActiveConfig(config); }}
        onStartScenario={handleStartScenario}
        onReset={handleReset}
        isRunning={isRunning}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />
      <TimelineBar
        totalSteps={history.length}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        timestepMinutes={activeConfig.timestepMinutes}
      />
      <InfoTooltip {...tooltip} />
    </div>
  );
}

export default App;
```

**Step 2: End-to-end test**

Manual test flow:
1. Open app → globe renders
2. Click "Click to Ignite" → click on globe → fire spreads
3. Use timeline scrubber to rewind/fast-forward
4. Switch to scenario mode → pick "California Grassland" → camera flies, fire starts
5. Adjust sliders → reset → start new simulation with different params

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire all components together for full app integration"
```

---

## Task 16: Final Polish

**Files:**
- Create: `CLAUDE.md`
- Modify: various files for cleanup

**Step 1: Create CLAUDE.md**

Document build commands, architecture, and key dev notes.

**Step 2: Add a favicon and page title**

Update `index.html` with appropriate title: "Wildfire Spread Simulator".

**Step 3: Final commit**

```bash
git add -A
git commit -m "docs: add CLAUDE.md and polish index.html"
```

---

## Dependency Summary

```
Task 1  (scaffolding)
  └─ Task 2  (globe)
  └─ Task 3  (grid types) ─── Task 4  (spread) ─── Task 5  (runner)
                                                       └─ Task 6  (worker)
Task 7  (control panel)  ← depends on Task 1
Task 8  (timeline bar)   ← depends on Task 1
Task 9  (fire overlay)   ← depends on Task 2, Task 5
Task 10 (click-to-ignite)← depends on Task 2, Task 6
Task 11 (scenarios)      ← depends on Task 7, Task 6
Task 12 (particles)      ← depends on Task 9
Task 13 (tooltip)        ← depends on Task 9
Task 14 (perf optim)     ← depends on Task 9
Task 15 (integration)    ← depends on all above
Task 16 (polish)         ← depends on Task 15
```

**Parallelizable groups:**
- After Task 1: Tasks 2, 3 can run in parallel
- After Task 5: Tasks 6, 7, 8 can run in parallel
- After Task 9: Tasks 12, 13, 14 can run in parallel
