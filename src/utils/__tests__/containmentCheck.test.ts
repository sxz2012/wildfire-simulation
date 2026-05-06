import { describe, it, expect } from "vitest";
import { containmentCheck } from "../containmentCheck";
import type { LatLng } from "../containmentCheck";
import { CellState, FuelType } from "../../simulation/types";
import type { SimulationConfig, SimulationState } from "../../simulation/types";

function makeState(gridSize: number, burningIndices: number[]): SimulationState {
  const grid = new Uint8Array(gridSize * gridSize);
  for (const i of burningIndices) grid[i] = CellState.Burning;
  return { grid, timestep: 0 };
}

function makeStateWith(
  gridSize: number,
  setters: Array<[number, CellState]>,
): SimulationState {
  const grid = new Uint8Array(gridSize * gridSize);
  for (const [idx, value] of setters) grid[idx] = value;
  return { grid, timestep: 0 };
}

function makeConfig(gridSize: number, cellSizeMeters: number): SimulationConfig {
  return {
    gridSize,
    cellSizeMeters,
    windSpeed: 0,
    windDirection: 0,
    humidity: 0,
    defaultFuel: FuelType.Grass,
    timestepMinutes: 3,
  };
}

describe("containmentCheck", () => {
  it("returns ok with zero counts when grid has no Burning cells", () => {
    const config = makeConfig(10, 50);
    const state = makeState(10, []);
    const polygon: LatLng[] = [
      { lat: 36.5, lng: -122.5 },
      { lat: 36.5, lng: -121.5 },
      { lat: 37.5, lng: -121.5 },
      { lat: 37.5, lng: -122.5 },
    ];
    expect(containmentCheck(state, polygon, config, 37, -122)).toEqual({
      ok: true,
      burningOutside: 0,
      totalBurning: 0,
      breachPercent: 0,
    });
  });

  it("returns ok when all burning cells are inside polygon", () => {
    const config = makeConfig(10, 50);
    const burningIndices = [0, 11, 22, 33, 44, 55, 66, 77, 88, 99];
    const state = makeState(10, burningIndices);
    const polygon: LatLng[] = [
      { lat: 36.5, lng: -122.5 },
      { lat: 36.5, lng: -121.5 },
      { lat: 37.5, lng: -121.5 },
      { lat: 37.5, lng: -122.5 },
    ];
    const result = containmentCheck(state, polygon, config, 37, -122);
    expect(result.ok).toBe(true);
    expect(result.burningOutside).toBe(0);
    expect(result.totalBurning).toBe(burningIndices.length);
    expect(result.breachPercent).toBe(0);
  });

  it("returns not ok when all burning cells are outside polygon", () => {
    const config = makeConfig(10, 50);
    const burningIndices = [0, 11, 22, 33, 44];
    const state = makeState(10, burningIndices);
    const polygon: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
    ];
    const result = containmentCheck(state, polygon, config, 37, -122);
    expect(result.ok).toBe(false);
    expect(result.burningOutside).toBe(burningIndices.length);
    expect(result.totalBurning).toBe(burningIndices.length);
    expect(result.breachPercent).toBe(1);
  });

  it("computes breachPercent for mixed inside/outside burning cells", () => {
    const gridSize = 10;
    const cellSizeMeters = 50;
    const config = makeConfig(gridSize, cellSizeMeters);
    const centerLat = 37;
    const centerLng = -122;

    const metersPerDegLat = 111_320;
    const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
    const cellLat = cellSizeMeters / metersPerDegLat;
    const cellLng = cellSizeMeters / metersPerDegLng;
    const half = gridSize / 2;

    const polyHalfLat = 1.5 * cellLat;
    const polyHalfLng = 1.5 * cellLng;
    const polygon: LatLng[] = [
      { lat: centerLat - polyHalfLat, lng: centerLng - polyHalfLng },
      { lat: centerLat - polyHalfLat, lng: centerLng + polyHalfLng },
      { lat: centerLat + polyHalfLat, lng: centerLng + polyHalfLng },
      { lat: centerLat + polyHalfLat, lng: centerLng - polyHalfLng },
    ];

    function idx(row: number, col: number): number {
      return row * gridSize + col;
    }

    const insideIndices = [idx(4, 4), idx(4, 5), idx(5, 4), idx(5, 5)];
    const outsideIndices = [idx(0, 0), idx(0, 9), idx(9, 0), idx(9, 9)];
    const burning = [...insideIndices, ...outsideIndices];
    const state = makeState(gridSize, burning);

    for (const i of insideIndices) {
      const row = Math.floor(i / gridSize);
      const col = i - row * gridSize;
      const lat = centerLat + (row - half) * cellLat;
      const lng = centerLng + (col - half) * cellLng;
      expect(lat).toBeGreaterThan(centerLat - polyHalfLat);
      expect(lat).toBeLessThan(centerLat + polyHalfLat);
      expect(lng).toBeGreaterThan(centerLng - polyHalfLng);
      expect(lng).toBeLessThan(centerLng + polyHalfLng);
    }

    const result = containmentCheck(state, polygon, config, centerLat, centerLng);
    expect(result.totalBurning).toBe(8);
    expect(result.burningOutside).toBe(4);
    expect(result.breachPercent).toBe(0.5);
    expect(result.ok).toBe(false);
  });

  it("ignores non-Burning cells (Burned, Suppressed, Unburned) outside polygon", () => {
    const gridSize = 10;
    const config = makeConfig(gridSize, 50);
    const state = makeStateWith(gridSize, [
      [0, CellState.Burned],
      [9, CellState.Suppressed],
      [90, CellState.Burned],
      [99, CellState.Suppressed],
    ]);
    const polygon: LatLng[] = [
      { lat: 36.5, lng: -122.5 },
      { lat: 36.5, lng: -121.5 },
      { lat: 37.5, lng: -121.5 },
      { lat: 37.5, lng: -122.5 },
    ];
    const result = containmentCheck(state, polygon, config, 37, -122);
    expect(result).toEqual({
      ok: true,
      burningOutside: 0,
      totalBurning: 0,
      breachPercent: 0,
    });
  });
});
