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

  it("returns null when no delay value satisfies the threshold", async () => {
    // No suppression + threshold=0 means every delay fails (any spread > 0).
    const result = await findMaxDelay({
      config: tinyConfig,
      fuelMap,
      igniteRow: 25,
      igniteCol: 25,
      centerLat: 37.3,
      centerLng: -122.1,
      maxSteps: 30,
      thresholdAreaHa: 0,
      bundle: [],
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

import { findMinTier } from "../inverseSearch";

describe("findMinTier (Q2)", () => {
  const tinyConfig = {
    ...DEFAULT_CONFIG,
    gridSize: 50,
    cellSizeMeters: 50,
  };
  const fuelMap: FuelType[] = new Array(50 * 50).fill(FuelType.Grass);

  it("returns null when no tier passes the threshold", async () => {
    // We construct an unsatisfiable threshold (negative ha) so that even
    // a tier producing finalAreaHa=0 fails the `<= threshold` predicate.
    // This forces the linear scan to walk all four tiers and return
    // null — the path we want to cover.
    const result = await findMinTier({
      config: tinyConfig,
      fuelMap,
      igniteRow: 25,
      igniteCol: 25,
      centerLat: 37.3,
      centerLng: -122.1,
      maxSteps: 30,
      thresholdAreaHa: -1,
      delayMin: 0,
    });
    expect(result.minTier).toBeNull();
  });

  it("returns 'initialAttack' when even the smallest tier passes", async () => {
    // Threshold larger than the entire grid -> always passes.
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
