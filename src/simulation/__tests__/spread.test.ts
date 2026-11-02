import { describe, it, expect } from "vitest";
import {
  simulateStep,
  computeSpreadRate,
  computeScenarioFeatures,
  computeStepAggregates,
  correctedRate,
  forEachSpreadAttempt,
  CORRECTION_SIZE,
} from "../spread";
import { createGrid, igniteCell, getCell } from "../grid";
import { CellState, FuelType, DEFAULT_CONFIG, type GridCell } from "../types";

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

describe("computeStepAggregates", () => {
  function mkCell(lat: number, lng: number, state: CellState): GridCell {
    return {
      lat, lng, elevation: 0, fuel: "forest",
      state, burnTimer: 0, row: 0, col: 0,
    } as GridCell;
  }

  it("returns zeros when no cells are burning", () => {
    const grid = [mkCell(0, 0, CellState.Unburned)];
    const agg = computeStepAggregates(grid, 100);
    expect(agg.currHotspotCount).toBe(0);
    expect(agg.currAreaKm2).toBe(0);
  });

  it("computes count, area, and extents for a small burn cluster", () => {
    // Two cells at (0,0) and (0.01, 0.01) — about 1.1 km × 1.1 km (at equator)
    const grid = [
      mkCell(0, 0, CellState.Burning),
      mkCell(0.01, 0.01, CellState.Burning),
      mkCell(5, 5, CellState.Unburned),
    ];
    const agg = computeStepAggregates(grid, 100); // 100 m cells -> 0.01 km² each
    expect(agg.currHotspotCount).toBe(2);
    expect(agg.currAreaKm2).toBeCloseTo(0.02, 5);
    expect(agg.currExtentNsKm).toBeCloseTo(1.11, 1);
    expect(agg.currExtentEwKm).toBeGreaterThan(1.0);
  });
});

describe("spreadScale", () => {
  const burnedAfter = (spreadScale: number | undefined, seed: number) => {
    const config = { ...DEFAULT_CONFIG, gridSize: 40, spreadScale };
    let grid = createGrid(config, 36.27, -121.8, () => 100);
    igniteCell(grid, 20, 20, 40);
    let a = seed >>> 0;
    const saved = Math.random;
    Math.random = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    try {
      for (let s = 1; s <= 12; s++) grid = simulateStep(grid, config, s, false);
    } finally {
      Math.random = saved;
    }
    return grid.filter((c) => c.state !== CellState.Unburned).length;
  };

  it("0 stops the fire from spreading", () => {
    expect(burnedAfter(0, 1)).toBe(1);
  });

  it("a larger value spreads the fire faster; the default is 1", () => {
    let fast = 0, base = 0, dflt = 0;
    for (let seed = 1; seed <= 5; seed++) {
      fast += burnedAfter(2, seed); base += burnedAfter(1, seed); dflt += burnedAfter(undefined, seed);
    }
    expect(fast).toBeGreaterThan(base);
    expect(dflt).toBe(base);
  });
});

describe("spread attempts and learned correction", () => {
  const attempt = { cell: 0, rate: 0.1, align: 1, slope: 0, fuel: FuelType.Grass, north: 0, east: 1 };

  it("an all-zero correction leaves the chance unchanged", () => {
    expect(correctedRate(0.1, attempt, new Array(CORRECTION_SIZE).fill(0))).toBeCloseTo(0.1, 10);
  });

  it("a positive bias raises the chance, a negative one lowers it", () => {
    const w = new Array(CORRECTION_SIZE).fill(0);
    w[0] = 1;
    expect(correctedRate(0.1, attempt, w)).toBeGreaterThan(0.2);
    w[0] = -1;
    expect(correctedRate(0.1, attempt, w)).toBeLessThan(0.05);
  });

  it("lists each burning cell's unburned neighbours with the spread direction", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 9 };
    const grid = createGrid(config, 36.27, -121.8, () => 100);
    igniteCell(grid, 4, 4, 9);
    const seen: { cell: number; north: number; east: number }[] = [];
    forEachSpreadAttempt(grid, config, 1, false, (a) => seen.push(a));
    expect(seen).toHaveLength(8);
    const east = seen.find((a) => a.cell === 4 * 9 + 5)!;
    expect(east.east).toBeCloseTo(1);
    expect(east.north).toBeCloseTo(0);
    const north = seen.find((a) => a.cell === 3 * 9 + 4)!;
    expect(north.north).toBeCloseTo(1);
  });

  it("a correction in the config speeds up a simulated fire", () => {
    const run = (spreadCorrection?: number[]) => {
      const config = { ...DEFAULT_CONFIG, gridSize: 40, spreadCorrection };
      let grid = createGrid(config, 36.27, -121.8, () => 100);
      igniteCell(grid, 20, 20, 40);
      let a = 7;
      const saved = Math.random;
      Math.random = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
      try {
        for (let s = 1; s <= 10; s++) grid = simulateStep(grid, config, s, false);
      } finally {
        Math.random = saved;
      }
      return grid.filter((c) => c.state !== CellState.Unburned).length;
    };
    const w = new Array(CORRECTION_SIZE).fill(0);
    w[0] = 1;
    expect(run(w)).toBeGreaterThan(run());
  });
});
