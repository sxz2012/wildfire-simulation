import { describe, it, expect } from "vitest";
import { simulateStep, computeSpreadRate, computeScenarioFeatures } from "../spread";
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
    const config = { ...DEFAULT_CONFIG, gridSize: 5, windSpeed: 30, humidity: 0 };
    const grid = createGrid(config, 0, 0, () => 0);
    igniteCell(grid, 2, 2, config.gridSize);

    let currentGrid = grid;
    for (let i = 0; i < 10; i++) {
      currentGrid = simulateStep(currentGrid, config);
    }

    const neighbors = [
      [1, 1], [1, 2], [1, 3],
      [2, 1],         [2, 3],
      [3, 1], [3, 2], [3, 3],
    ];
    const anySpread = neighbors.some(([r, c]) => {
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
    for (let i = 0; i < 100; i++) {
      currentGrid = simulateStep(currentGrid, config);
    }

    const cell = getCell(currentGrid, 1, 1, config.gridSize);
    expect(cell.state).toBe(CellState.Burned);
  });
});

describe("computeScenarioFeatures", () => {
  it("computes percentages and dominant fuel correctly", () => {
    // Includes "urban" which isn't in the FuelType union but is a valid
    // input the helper must handle (per the spec).
    const fuelMap = ["forest", "forest", "shrub", "grass", "urban"];
    const f = computeScenarioFeatures(fuelMap);
    expect(f.pctForest).toBeCloseTo(0.4, 5);
    expect(f.pctShrub).toBeCloseTo(0.2, 5);
    expect(f.pctGrass).toBeCloseTo(0.2, 5);
    expect(f.pctUrban).toBeCloseTo(0.2, 5);
    expect(f.dominantFuelEnc).toBe(0); // forest = 0
  });

  it("handles a single-fuel map", () => {
    const fuelMap: FuelType[] = Array(100).fill(FuelType.Shrub);
    const f = computeScenarioFeatures(fuelMap);
    expect(f.pctShrub).toBe(1);
    expect(f.dominantFuelEnc).toBe(3); // shrub = 3
  });

  it("handles an empty map without dividing by zero", () => {
    const f = computeScenarioFeatures([]);
    expect(f.pctForest).toBe(0);
    expect(Number.isFinite(f.pctForest)).toBe(true);
  });
});
