import { describe, it, expect } from "vitest";
import { dropScheduler } from "../dropScheduler";
import { CellState, FuelType, ResourceType } from "../../simulation/types";
import type {
  ResourceCount,
  SimulationConfig,
  SimulationState,
  SuppressionConfig,
} from "../../simulation/types";

const CENTER_LAT = 37;
const CENTER_LNG = -122;
const METERS_PER_DEG_LAT = 111_320;
const METERS_PER_DEG_LNG = 111_320 * Math.cos((CENTER_LAT * Math.PI) / 180);

function makeConfig(gridSize: number, cellSizeMeters: number, timestepMinutes: number): SimulationConfig {
  return {
    gridSize,
    cellSizeMeters,
    windSpeed: 0,
    windDirection: 0,
    humidity: 30,
    defaultFuel: FuelType.Grass,
    timestepMinutes,
  };
}

function makeSuppression(resources: ResourceCount[]): SuppressionConfig {
  return { responseDelayMin: 0, resources };
}

function makeHistory(
  steps: number,
  gridSize: number,
  burningCellsAt: (step: number) => number[],
): SimulationState[] {
  const out: SimulationState[] = [];
  for (let s = 0; s < steps; s++) {
    const grid = new Uint8Array(gridSize * gridSize);
    for (const idx of burningCellsAt(s)) {
      grid[idx] = CellState.Burning;
    }
    out.push({ grid, timestep: s });
  }
  return out;
}

describe("dropScheduler", () => {
  it("returns [] when no AirTanker in resources", () => {
    const config = makeConfig(50, 50, 3);
    const history = makeHistory(50, 50, () => [25 * 50 + 25]);
    const suppression = makeSuppression([
      { type: ResourceType.Type1Crew, count: 5 },
      { type: ResourceType.Engine, count: 2 },
    ]);
    expect(dropScheduler(history, config, CENTER_LAT, CENTER_LNG, suppression, 10)).toEqual([]);
  });

  it("returns [] when AirTanker count is 0", () => {
    const config = makeConfig(50, 50, 3);
    const history = makeHistory(50, 50, () => [25 * 50 + 25]);
    const suppression = makeSuppression([{ type: ResourceType.AirTanker, count: 0 }]);
    expect(dropScheduler(history, config, CENTER_LAT, CENTER_LNG, suppression, 10)).toEqual([]);
  });

  it("one tanker drops at expected cadence steps", () => {
    const gridSize = 50;
    const config = makeConfig(gridSize, 50, 3);
    const history = makeHistory(100, gridSize, () => {
      const idxs: number[] = [];
      for (let r = 20; r <= 24; r++) {
        for (let c = 20; c <= 24; c++) idxs.push(r * gridSize + c);
      }
      return idxs;
    });
    const suppression = makeSuppression([{ type: ResourceType.AirTanker, count: 1 }]);
    const events = dropScheduler(history, config, CENTER_LAT, CENTER_LNG, suppression, 10);

    const centers = events.map((e) => e.centerStep);
    expect(centers).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    for (const e of events) expect(e.tankerIdx).toBe(0);
  });

  it("two tankers stagger with floor(cadence/N) offset", () => {
    const gridSize = 50;
    const config = makeConfig(gridSize, 50, 3);
    const history = makeHistory(60, gridSize, () => {
      const idxs: number[] = [];
      for (let r = 20; r <= 24; r++) {
        for (let c = 20; c <= 24; c++) idxs.push(r * gridSize + c);
      }
      return idxs;
    });
    const suppression = makeSuppression([{ type: ResourceType.AirTanker, count: 2 }]);
    const events = dropScheduler(history, config, CENTER_LAT, CENTER_LNG, suppression, 10);

    expect(events.map((e) => e.centerStep)).toEqual([10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(events.map((e) => e.tankerIdx)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  });

  it("returns events sorted by centerStep ascending", () => {
    const gridSize = 50;
    const config = makeConfig(gridSize, 50, 3);
    const history = makeHistory(60, gridSize, () => {
      const idxs: number[] = [];
      for (let r = 20; r <= 24; r++) {
        for (let c = 20; c <= 24; c++) idxs.push(r * gridSize + c);
      }
      return idxs;
    });
    const suppression = makeSuppression([{ type: ResourceType.AirTanker, count: 2 }]);
    const events = dropScheduler(history, config, CENTER_LAT, CENTER_LNG, suppression, 10);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].centerStep).toBeGreaterThanOrEqual(events[i - 1].centerStep);
    }
  });

  it("skips drops at steps with no Burning cells", () => {
    const gridSize = 50;
    const config = makeConfig(gridSize, 50, 3);
    const history = makeHistory(40, gridSize, (s) => {
      if (s === 30) return [];
      const idxs: number[] = [];
      for (let r = 20; r <= 24; r++) {
        for (let c = 20; c <= 24; c++) idxs.push(r * gridSize + c);
      }
      return idxs;
    });
    const suppression = makeSuppression([{ type: ResourceType.AirTanker, count: 1 }]);
    const events = dropScheduler(history, config, CENTER_LAT, CENTER_LNG, suppression, 10);

    const centers = events.map((e) => e.centerStep);
    expect(centers).toContain(10);
    expect(centers).toContain(20);
    expect(centers).not.toContain(30);
  });

  it("picks N-S axis when latitude span dominates", () => {
    const gridSize = 60;
    const cellSizeMeters = 50;
    const config = makeConfig(gridSize, cellSizeMeters, 3);
    const history = makeHistory(20, gridSize, () => {
      const idxs: number[] = [];
      for (let r = 10; r <= 30; r++) {
        for (let c = 20; c <= 22; c++) idxs.push(r * gridSize + c);
      }
      return idxs;
    });
    const suppression = makeSuppression([{ type: ResourceType.AirTanker, count: 1 }]);
    const events = dropScheduler(history, config, CENTER_LAT, CENTER_LNG, suppression, 10);
    expect(events.length).toBeGreaterThan(0);
    const e = events[0];
    expect(e.axisStart.lng).toBeCloseTo(e.axisEnd.lng, 9);
    expect(e.axisStart.lat).not.toBeCloseTo(e.axisEnd.lat, 6);

    const half = gridSize / 2;
    const cellLat = cellSizeMeters / METERS_PER_DEG_LAT;
    const offsetLat = (5 * 1000) / METERS_PER_DEG_LAT;
    const minRowLat = CENTER_LAT + (10 - half) * cellLat;
    const maxRowLat = CENTER_LAT + (30 - half) * cellLat;
    const expectedSouth = minRowLat - offsetLat;
    const expectedNorth = maxRowLat + offsetLat;
    const lats = [e.axisStart.lat, e.axisEnd.lat].sort((a, b) => a - b);
    expect(lats[0]).toBeCloseTo(expectedSouth, 5);
    expect(lats[1]).toBeCloseTo(expectedNorth, 5);
  });

  it("picks E-W axis when longitude span dominates", () => {
    const gridSize = 60;
    const cellSizeMeters = 50;
    const config = makeConfig(gridSize, cellSizeMeters, 3);
    const history = makeHistory(20, gridSize, () => {
      const idxs: number[] = [];
      for (let r = 20; r <= 22; r++) {
        for (let c = 10; c <= 30; c++) idxs.push(r * gridSize + c);
      }
      return idxs;
    });
    const suppression = makeSuppression([{ type: ResourceType.AirTanker, count: 1 }]);
    const events = dropScheduler(history, config, CENTER_LAT, CENTER_LNG, suppression, 10);
    expect(events.length).toBeGreaterThan(0);
    const e = events[0];
    expect(e.axisStart.lat).toBeCloseTo(e.axisEnd.lat, 9);
    expect(e.axisStart.lng).not.toBeCloseTo(e.axisEnd.lng, 6);

    const half = gridSize / 2;
    const cellLng = cellSizeMeters / METERS_PER_DEG_LNG;
    const offsetLng = (5 * 1000) / METERS_PER_DEG_LNG;
    const minColLng = CENTER_LNG + (10 - half) * cellLng;
    const maxColLng = CENTER_LNG + (30 - half) * cellLng;
    const expectedWest = minColLng - offsetLng;
    const expectedEast = maxColLng + offsetLng;
    const lngs = [e.axisStart.lng, e.axisEnd.lng].sort((a, b) => a - b);
    expect(lngs[0]).toBeCloseTo(expectedWest, 5);
    expect(lngs[1]).toBeCloseTo(expectedEast, 5);
  });

  it("DropEvent shape: startStep <= centerStep <= endStep, within bounds", () => {
    const gridSize = 50;
    const config = makeConfig(gridSize, 50, 3);
    const history = makeHistory(100, gridSize, () => {
      const idxs: number[] = [];
      for (let r = 20; r <= 24; r++) {
        for (let c = 20; c <= 24; c++) idxs.push(r * gridSize + c);
      }
      return idxs;
    });
    const deployStep = 10;
    const suppression = makeSuppression([{ type: ResourceType.AirTanker, count: 1 }]);
    const events = dropScheduler(history, config, CENTER_LAT, CENTER_LNG, suppression, deployStep);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.startStep).toBeLessThanOrEqual(e.centerStep);
      expect(e.centerStep).toBeLessThanOrEqual(e.endStep);
      expect(e.startStep).toBeGreaterThanOrEqual(deployStep);
      expect(e.endStep).toBeLessThanOrEqual(history.length - 1);
    }
  });
});
