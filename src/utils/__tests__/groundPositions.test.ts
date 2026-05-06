import { describe, it, expect } from "vitest";
import { groundPositions } from "../groundPositions";
import type { LatLng } from "../groundPositions";
import { CellState, FuelType } from "../../simulation/types";
import type { SimulationConfig, SimulationState } from "../../simulation/types";

function makeConfig(gridSize: number, cellSizeMeters: number): SimulationConfig {
  return {
    gridSize,
    cellSizeMeters,
    windSpeed: 0,
    windDirection: 0,
    humidity: 30,
    defaultFuel: FuelType.Grass,
    timestepMinutes: 15,
  };
}

function makeState(gridSize: number, setters: Array<[number, CellState]>): SimulationState {
  const grid = new Uint8Array(gridSize * gridSize);
  for (const [idx, value] of setters) {
    grid[idx] = value;
  }
  return { grid, timestep: 0 };
}

describe("groundPositions", () => {
  it("returns [] when count is 0", () => {
    const config = makeConfig(10, 30);
    const prev = makeState(10, [[55, CellState.Burning]]);
    const curr = makeState(10, [[55, CellState.Suppressed]]);
    expect(groundPositions(prev, curr, config, 37, -122, 0, [])).toEqual([]);
  });

  it("returns lastFramePositions when prev is null", () => {
    const config = makeConfig(10, 30);
    const curr = makeState(10, []);
    const last: LatLng[] = [{ lat: 1, lng: 2 }];
    expect(groundPositions(null, curr, config, 37, -122, 5, last)).toEqual(last);
  });

  it("returns [] when prev is null and lastFramePositions is empty", () => {
    const config = makeConfig(10, 30);
    const curr = makeState(10, []);
    expect(groundPositions(null, curr, config, 37, -122, 5, [])).toEqual([]);
  });

  it("returns lastFramePositions unchanged when flipped set is empty", () => {
    const config = makeConfig(10, 30);
    const prev = makeState(10, [[55, CellState.Burning]]);
    const curr = makeState(10, [[55, CellState.Burning]]);
    const last: LatLng[] = [
      { lat: 10, lng: 20 },
      { lat: 11, lng: 21 },
    ];
    expect(groundPositions(prev, curr, config, 37, -122, 3, last)).toBe(last);
  });

  it("returns [] when flipped set and lastFramePositions are both empty", () => {
    const config = makeConfig(10, 30);
    const prev = makeState(10, []);
    const curr = makeState(10, []);
    expect(groundPositions(prev, curr, config, 37, -122, 3, [])).toEqual([]);
  });

  it("samples 3 positions with stride from 10 flipped cells", () => {
    const config = makeConfig(10, 30);
    const flippedIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const prev = makeState(
      10,
      flippedIndices.map((i) => [i, CellState.Burning] as [number, CellState]),
    );
    const curr = makeState(
      10,
      flippedIndices.map((i) => [i, CellState.Suppressed] as [number, CellState]),
    );
    const result = groundPositions(prev, curr, config, 37, -122, 3, []);
    expect(result).toHaveLength(3);

    const expectedRows = [0, 0, 0];
    const expectedCols = [0, 3, 6];
    const cellLat = 30 / 111320;
    const cellLng = 30 / (111320 * Math.cos((37 * Math.PI) / 180));
    const half = 5;
    for (let k = 0; k < 3; k++) {
      const expLat = 37 + (expectedRows[k] - half) * cellLat;
      const expLng = -122 + (expectedCols[k] - half) * cellLng;
      expect(result[k].lat).toBeCloseTo(expLat, 5);
      expect(result[k].lng).toBeCloseTo(expLng, 5);
    }
  });

  it("returns 2 positions without duplication when count > flipped.length", () => {
    const config = makeConfig(10, 30);
    const prev = makeState(10, [
      [10, CellState.Burning],
      [20, CellState.Burning],
    ]);
    const curr = makeState(10, [
      [10, CellState.Suppressed],
      [20, CellState.Suppressed],
    ]);
    const result = groundPositions(prev, curr, config, 37, -122, 5, []);
    expect(result).toHaveLength(2);
  });

  it("computes correct lat/lng for index 55 (row=5, col=5) at center", () => {
    const config = makeConfig(10, 30);
    const prev = makeState(10, [[55, CellState.Burning]]);
    const curr = makeState(10, [[55, CellState.Suppressed]]);
    const result = groundPositions(prev, curr, config, 37, -122, 1, []);
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBeCloseTo(37, 5);
    expect(result[0].lng).toBeCloseTo(-122, 5);
  });

  it("computes correct lat/lng for index 60 (row=6, col=0)", () => {
    const config = makeConfig(10, 30);
    const prev = makeState(10, [[60, CellState.Burning]]);
    const curr = makeState(10, [[60, CellState.Suppressed]]);
    const result = groundPositions(prev, curr, config, 37, -122, 1, []);
    const cellLat = 30 / 111320;
    const cellLng = 30 / (111320 * Math.cos((37 * Math.PI) / 180));
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBeCloseTo(37 + 1 * cellLat, 5);
    expect(result[0].lng).toBeCloseTo(-122 + -5 * cellLng, 5);
  });
});
