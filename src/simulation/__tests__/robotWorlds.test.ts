import { describe, it, expect } from "vitest";
import {
  trueConditions,
  conditionsWeather,
  forecastAt,
  shouldReport,
  activeReport,
  forecastMatch,
  matchAtHorizon,
  edgeOffsetMeters,
  forecastEdgeCells,
  arrowChunks,
  trueFireThreat,
} from "../robot/worlds";
import { CellState } from "../types";
import type { ForecastVersion, Report } from "../robot/worlds";

describe("conditions", () => {
  it("trueConditions: hotter and drier, wind unchanged, humidity floored", () => {
    expect(trueConditions({ windDirection: 270, windSpeed: 15, humidity: 30, tempC: 31 }))
      .toEqual({ windDirection: 270, windSpeed: 15, humidity: 20, tempC: 36 });
    expect(trueConditions({ windDirection: 0, windSpeed: 5, humidity: 8, tempC: 20 }).humidity).toBe(5);
  });

  it("conditionsWeather maps like handleStartWildfire", () => {
    expect(conditionsWeather({ windDirection: 0, windSpeed: 0, humidity: 0, tempC: 30 }))
      .toEqual({ tempMean: 30, tempMax: 35, precipitation: 0, cumulativePrecip: 0 });
  });
});

describe("forecastAt", () => {
  it("picks the latest version starting at or before the minute", () => {
    const v = [{ fromMin: 100 }, { fromMin: 400 }] as ForecastVersion[];
    expect(forecastAt(v, 0)).toBe(v[0]);
    expect(forecastAt(v, 399)).toBe(v[0]);
    expect(forecastAt(v, 400)).toBe(v[1]);
  });
});

describe("shouldReport", () => {
  const base = { phase: "outbound" as const, trueFireNear: false, nowMin: 500, reports: [] as Report[], shiftMin: null };
  it("reports on reaching the edge", () => expect(shouldReport({ ...base, phase: "scouting" })).toBe(true));
  it("reports early when the true fire comes near", () => expect(shouldReport({ ...base, trueFireNear: true })).toBe(true));
  it("does not report while just walking", () => expect(shouldReport(base)).toBe(false));
  it("once per new information: no repeat while still scouting", () =>
    expect(shouldReport({ ...base, phase: "scouting", reports: [{ min: 450 } as Report] })).toBe(false));
  it("reports again after a shift newer than the last report", () =>
    expect(shouldReport({ ...base, phase: "scouting", reports: [{ min: 450 } as Report], shiftMin: 480 })).toBe(true));
  it("a shift while walking home alone does not report", () =>
    expect(shouldReport({ ...base, phase: "returning", reports: [{ min: 450 } as Report], shiftMin: 480 })).toBe(false));
  it("a failed report is not retried until something new happens", () => {
    expect(shouldReport({ ...base, phase: "scouting", failedMin: 490 })).toBe(false);
    expect(shouldReport({ ...base, phase: "scouting", failedMin: 490, shiftMin: 495 })).toBe(true);
  });
  it("a safety report may repeat once the last report is two steps old", () => {
    const near = { ...base, phase: "returning" as const, trueFireNear: true, safetyGapMin: 30 };
    expect(shouldReport({ ...near, reports: [{ min: 450 } as Report] })).toBe(true);
    expect(shouldReport({ ...near, reports: [{ min: 480 } as Report] })).toBe(false);
    expect(shouldReport({ ...near, reports: [{ min: 450 } as Report], failedMin: 490 })).toBe(false);
  });
  it("after a rewind (a future report exists) no new report is made", () =>
    expect(shouldReport({ ...base, phase: "scouting", reports: [{ min: 600 } as Report] })).toBe(false));
});

describe("activeReport", () => {
  it("card for 3 steps after the report, then collapsed; none before", () => {
    const r = [{ min: 450 } as Report];
    expect(activeReport(r, 440, 15)).toEqual({ report: null, cardVisible: false });
    expect(activeReport(r, 450, 15)).toEqual({ report: r[0], cardVisible: true });
    expect(activeReport(r, 494, 15).cardVisible).toBe(true);
    expect(activeReport(r, 495, 15)).toEqual({ report: r[0], cardVisible: false });
  });
});

describe("metrics and drawing helpers", () => {
  const N = 10;
  const grid = (cells: number[], v = CellState.Burning) => {
    const g = new Uint8Array(N * N);
    cells.forEach((c) => (g[c] = v));
    return g;
  };

  it("forecastMatch: identical 100, disjoint 0, half overlap 33", () => {
    expect(forecastMatch(grid([22, 23]), grid([22, 23]), N)).toBe(100);
    expect(forecastMatch(grid([22]), grid([77]), N)).toBe(0);
    expect(forecastMatch(grid([22, 23]), grid([23, 24]), N)).toBe(33);
  });

  it("forecastMatch ignores the burned border", () => {
    const a = grid([22]);
    a[0] = CellState.Burned;
    a[9] = CellState.Burned;
    expect(forecastMatch(a, grid([22]), N)).toBe(100);
  });

  it("matchAtHorizon scores only the spread still to come, 16 steps ahead, clamped", () => {
    const s = (cells: number[]) => ({ grid: grid(cells), timestep: 0 });
    // A big burned area both agree on, plus new spread that differs.
    const burned = [11, 12, 13, 21, 22, 23, 31, 32, 33];
    const truth = Array.from({ length: 25 }, (_, i) => s(i >= 10 ? [...burned, 34, 35] : burned));
    const wrong = Array.from({ length: 30 }, (_, i) => s(i >= 10 ? [...burned, 71, 72] : burned));
    const right = Array.from({ length: 30 }, (_, i) => s(i >= 10 ? [...burned, 34, 35] : burned));
    expect(matchAtHorizon(wrong, truth, 0, N)).toBe(0); // shared burned area doesn't count
    expect(matchAtHorizon(right, truth, 0, N)).toBe(100);
    expect(matchAtHorizon(right, truth, 20, N)).toBe(100); // clamped to 24: no new spread after 20 → nothing to miss
    expect(matchAtHorizon(wrong, truth, 20, N)).toBe(0); // predicted spread that never happens still counts against it
  });

  it("edgeOffsetMeters: true fire 2 cells closer → +100 m at 50 m cells", () => {
    const dog = 5 * N + 1;
    expect(edgeOffsetMeters(grid([5 * N + 8]), grid([5 * N + 6]), dog, N, 50)).toBe(100);
    expect(edgeOffsetMeters(grid([]), grid([5 * N + 6]), dog, N, 50)).toBe(0);
  });

  it("forecastEdgeCells returns the ring, not the interior", () => {
    const block: number[] = [];
    for (let r = 3; r <= 5; r++) for (let c = 3; c <= 5; c++) block.push(r * N + c);
    const edge = forecastEdgeCells(grid(block), N);
    expect(edge).not.toContain(4 * N + 4);
    expect(edge.length).toBe(8);
    expect(forecastEdgeCells(grid(block), N, 4).length).toBeLessThanOrEqual(4);
  });

  it("arrowChunks splits a 30-cell path into 12-cell chunks", () => {
    expect(arrowChunks(Array.from({ length: 30 }, (_, i) => i))).toEqual([[0, 12], [12, 24], [24, 29]]);
    expect(arrowChunks([5])).toEqual([]);
  });
});

describe("trueFireThreat (looks ahead along the route)", () => {
  const ign = (n: number, set: Record<number, number>) => {
    const a = new Float32Array(n).fill(Infinity);
    for (const [k, v] of Object.entries(set)) a[Number(k)] = v;
    return a;
  };
  const route = { cells: [1, 2, 3, 4, 5], arrivalMin: [100, 105, 110, 115, 130], minMarginMin: 30 };
  it("clear when neither the dog's cell nor the next step of route is threatened", () =>
    expect(trueFireThreat(route, 1, 100, 15, ign(10, { 5: 120 }), 15)).toBe(false));
  it("sees true fire on route cells reached within the next step", () =>
    expect(trueFireThreat(route, 1, 100, 15, ign(10, { 3: 118 }), 15)).toBe(true));
  it("sees true fire due at the dog's own cell", () =>
    expect(trueFireThreat(null, 7, 100, 15, ign(10, { 7: 110 }), 15)).toBe(true));
});
