import { describe, it, expect } from "vitest";
import { runSimulation, extendSimulation } from "../runner";
import {
  CellState,
  FuelType,
  ResourceType,
  type SimulationConfig,
  type SuppressionConfig,
} from "../types";

const baseConfig: SimulationConfig = {
  gridSize: 10,
  cellSizeMeters: 50,
  windSpeed: 0,
  windDirection: 0,
  humidity: 50,
  defaultFuel: FuelType.Grass,
  timestepMinutes: 3,
};

const fuelMap: FuelType[] = new Array(100).fill(FuelType.Grass);
const elevationMap = new Float32Array(100);
const centerLat = 37;
const centerLng = -122;
const elevationFn = () => 0;

function buildIgnitedGrid(idx: number): Uint8Array {
  const g = new Uint8Array(100);
  g[idx] = CellState.Burning;
  return g;
}

function countBurningOrBurned(g: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < g.length; i++) {
    if (g[i] === CellState.Burning || g[i] === CellState.Burned) n++;
  }
  return n;
}

describe("extendSimulation", () => {
  it("fire spreads from initialGrid (no suppression)", () => {
    const initialGrid = buildIgnitedGrid(55); // row=5, col=5

    const result = extendSimulation(
      baseConfig,
      initialGrid,
      0,
      fuelMap,
      elevationMap,
      centerLat,
      centerLng,
      elevationFn,
      null,
      20,
    );

    expect(result.history.length).toBeGreaterThan(1);

    // Some neighbor of (5,5) should burn at some step.
    const last = result.history[result.history.length - 1].grid;
    expect(countBurningOrBurned(last)).toBeGreaterThan(1);
  });

  it("suppression with delay=0 deploys immediately", () => {
    const initialGrid = buildIgnitedGrid(55);
    const suppression: SuppressionConfig = {
      responseDelayMin: 0,
      resources: [{ type: ResourceType.Type1Dozer, count: 5 }],
    };

    const result = extendSimulation(
      baseConfig,
      initialGrid,
      0,
      fuelMap,
      elevationMap,
      centerLat,
      centerLng,
      elevationFn,
      suppression,
      20,
    );

    expect(result.diags.length).toBeGreaterThan(0);
    expect(result.diags[0].resourcesActive).toBeGreaterThan(0);
  });

  it("suppression delay respected from initialStep=0", () => {
    const initialGrid = buildIgnitedGrid(55);
    // responseDelayMin=12, timestepMinutes=3, so deployment first happens at
    // step >= 4 (4 * 3 = 12). diags[0] is step 1, diags[3] is step 4.
    const suppression: SuppressionConfig = {
      responseDelayMin: 12,
      resources: [{ type: ResourceType.Type1Dozer, count: 5 }],
    };

    const result = extendSimulation(
      baseConfig,
      initialGrid,
      0,
      fuelMap,
      elevationMap,
      centerLat,
      centerLng,
      elevationFn,
      suppression,
      20,
    );

    // Need at least 4 diags to verify deployment threshold.
    expect(result.diags.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < 3; i++) {
      expect(result.diags[i].resourcesActive).toBe(0);
    }
    expect(result.diags[3].resourcesActive).toBeGreaterThan(0);
  });

  it("suppression delay measured from t=0 even with initialStep > 0", () => {
    // initialStep=10, responseDelayMin=33. Step 11 has elapsedMin=33, so the
    // FIRST iteration after resume is when crews deploy. This pins the
    // "responseDelayMin is time-since-ignition (step * timestep)" semantic.
    const initialGrid = buildIgnitedGrid(55);
    const suppression: SuppressionConfig = {
      responseDelayMin: 33,
      resources: [{ type: ResourceType.Type1Dozer, count: 5 }],
    };

    const result = extendSimulation(
      baseConfig,
      initialGrid,
      10,
      fuelMap,
      elevationMap,
      centerLat,
      centerLng,
      elevationFn,
      suppression,
      30,
    );

    // diags[0] corresponds to step 11 (first iteration after initialStep=10).
    expect(result.diags.length).toBeGreaterThan(0);
    expect(result.diags[0].step).toBe(11);
    expect(result.diags[0].resourcesActive).toBeGreaterThan(0);
  });

  it("regression: extendSimulation(initialStep=0, freshIgnitedGrid) matches runSimulation shape", () => {
    // simulateStep uses Math.random, so we can't assert identical cell sets,
    // but the overall behavior (history length, scale of fire growth) should
    // be statistically comparable. Run several trials and compare averages
    // to keep the test stable while still catching gross regressions.
    const trials = 6;
    const igniteIdx = 55;
    const igniteRow = 5;
    const igniteCol = 5;
    const steps = 10;

    const extLengths: number[] = [];
    const runLengths: number[] = [];
    const extBurnCounts: number[] = [];
    const runBurnCounts: number[] = [];

    for (let t = 0; t < trials; t++) {
      const initialGrid = buildIgnitedGrid(igniteIdx);
      const ext = extendSimulation(
        baseConfig,
        initialGrid,
        0,
        fuelMap,
        elevationMap,
        centerLat,
        centerLng,
        elevationFn,
        null,
        steps,
      );
      const run = runSimulation(
        baseConfig,
        igniteRow,
        igniteCol,
        elevationFn,
        steps,
        centerLat,
        centerLng,
        fuelMap,
        elevationMap,
      );
      extLengths.push(ext.history.length);
      runLengths.push(run.baseline.length);
      extBurnCounts.push(
        countBurningOrBurned(ext.history[ext.history.length - 1].grid),
      );
      runBurnCounts.push(
        countBurningOrBurned(run.baseline[run.baseline.length - 1].grid),
      );
    }

    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(Math.abs(avg(extLengths) - avg(runLengths))).toBeLessThan(2);
    // Burn-count averages should be within 30% of each other.
    const extAvg = avg(extBurnCounts);
    const runAvg = avg(runBurnCounts);
    const ratio = extAvg / runAvg;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.3);
  });
});
