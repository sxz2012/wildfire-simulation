import { describe, it, expect } from "vitest";
import { findMinRosterForBoundary } from "../inverseSearch";
import { CellState, FuelType, type SimulationConfig } from "../types";
import type { LatLng } from "../../utils/containmentCheck";

const config: SimulationConfig = {
  gridSize: 10,
  cellSizeMeters: 50,
  windSpeed: 0,
  windDirection: 0,
  humidity: 50,
  defaultFuel: FuelType.Grass,
  timestepMinutes: 3,
};

const fuelMap = new Array(100).fill(FuelType.Grass);
const centerLat = 37;
const centerLng = -122;

function makeBurningGrid(burningIndices: number[]): Uint8Array {
  const g = new Uint8Array(100);
  for (const i of burningIndices) g[i] = CellState.Burning;
  return g;
}

describe("findMinRosterForBoundary", () => {
  it("polygon enclosing entire grid → recommendedRoster = []", async () => {
    const polygon: LatLng[] = [
      { lat: centerLat - 0.5, lng: centerLng - 0.5 },
      { lat: centerLat - 0.5, lng: centerLng + 0.5 },
      { lat: centerLat + 0.5, lng: centerLng + 0.5 },
      { lat: centerLat + 0.5, lng: centerLng - 0.5 },
    ];
    const initialGrid = makeBurningGrid([55]);

    const result = await findMinRosterForBoundary({
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 30,
    });

    expect(result.recommendedRoster).not.toBeNull();
    expect(result.recommendedRoster!.length).toBe(0);
    expect(result.passingRun).not.toBeNull();
    expect(result.bisectionTrace.length).toBe(1);
    expect(result.breachStep).toBeNull();
    expect(result.breachPercent).toBe(0);
  });

  it("mid-range scenario → recommendedRoster.length > 0", async () => {
    // Polygon just barely covers the grid extent — fire CAN escape if not contained.
    // Grid is 10*50 = 500m wide. 1 deg lat ~= 111320m; 500m ~= 0.0045 deg.
    // Use ~half the grid extent (very tight) so unsuppressed fire breaches it.
    const halfDeg = 0.0015;
    const polygon: LatLng[] = [
      { lat: centerLat - halfDeg, lng: centerLng - halfDeg },
      { lat: centerLat - halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng - halfDeg },
    ];
    const initialGrid = makeBurningGrid([55]);

    const result = await findMinRosterForBoundary({
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 30,
    });

    expect(result.recommendedRoster).not.toBeNull();
    expect(result.recommendedRoster!.length).toBeGreaterThan(0);
    expect(result.passingRun).not.toBeNull();
    expect(result.failingRun).not.toBeNull();
    expect(result.bisectionTrace.length).toBeGreaterThanOrEqual(2);
    expect(result.bisectionTrace.length).toBeLessThanOrEqual(8);
  });

  it("uncontainable scenario → recommendedRoster = null", async () => {
    // Tiny polygon far from the grid. ALL grid cells start burning OUTSIDE
    // the polygon. Even max suppression cannot fully extinguish 100 cells
    // within maxSteps, so containment never holds.
    const polygon: LatLng[] = [
      { lat: centerLat + 0.4, lng: centerLng + 0.4 },
      { lat: centerLat + 0.4, lng: centerLng + 0.4001 },
      { lat: centerLat + 0.4001, lng: centerLng + 0.4001 },
      { lat: centerLat + 0.4001, lng: centerLng + 0.4 },
    ];
    const allBurning = Array.from({ length: 100 }, (_, i) => i);
    const initialGrid = makeBurningGrid(allBurning);

    const result = await findMinRosterForBoundary({
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 5,
    });

    expect(result.recommendedRoster).toBeNull();
    expect(result.bestEffortRoster.length).toBeGreaterThan(0);
    expect(result.failingRun).not.toBeNull();
    expect(result.passingRun).toBeNull();
  });

  it("bisection budget bounded", async () => {
    const halfDeg = 0.0015;
    const polygon: LatLng[] = [
      { lat: centerLat - halfDeg, lng: centerLng - halfDeg },
      { lat: centerLat - halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng - halfDeg },
    ];
    const initialGrid = makeBurningGrid([55]);

    const result = await findMinRosterForBoundary({
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 30,
    });

    expect(result.bisectionTrace.length).toBeLessThanOrEqual(8);
  });
});
