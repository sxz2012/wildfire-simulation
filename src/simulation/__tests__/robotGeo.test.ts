import { describe, it, expect } from "vitest";
import { cellCenter, gridToLatLng, latLngToCell, snapToSafeCell } from "../robot/geo";
import { burningCentroid, shiftedWind } from "../robot/windShift";
import { createGrid } from "../grid";
import { CellState, DEFAULT_CONFIG } from "../types";
import type { PlannerGrid } from "../robot/types";

const LAT = 36.27, LNG = -121.8;

describe("cellCenter / latLngToCell", () => {
  it("matches createGrid and round-trips corners and center", () => {
    const n = 600, size = 50;
    const config = { ...DEFAULT_CONFIG, gridSize: n, cellSizeMeters: size };
    const grid = createGrid(config, LAT, LNG, () => 0);
    for (const i of [0, n - 1, n * (n - 1), n * n - 1, 300 * n + 300, 123 * n + 456]) {
      const p = cellCenter(i, n, size, LAT, LNG);
      expect(p.lat).toBeCloseTo(grid[i].lat, 9);
      expect(p.lng).toBeCloseTo(grid[i].lng, 9);
      expect(latLngToCell(p.lat, p.lng, n, size, LAT, LNG)).toBe(i);
    }
  });

  it("gridToLatLng matches cellCenter at whole cells and interpolates between them", () => {
    const a = cellCenter(10 * 600 + 20, 600, 50, LAT, LNG);
    const b = cellCenter(10 * 600 + 21, 600, 50, LAT, LNG);
    expect(gridToLatLng(10, 20, 600, 50, LAT, LNG)).toEqual(a);
    const mid = gridToLatLng(10, 20.5, 600, 50, LAT, LNG);
    expect(mid.lat).toBeCloseTo(a.lat, 12);
    expect(mid.lng).toBeCloseTo((a.lng + b.lng) / 2, 12);
  });

  it("returns null outside the grid", () => {
    // 20 km past the north edge (grid spans ±15 km).
    expect(latLngToCell(LAT + 35000 / 111320, LNG, 600, 50, LAT, LNG)).toBeNull();
    expect(latLngToCell(LAT, LNG - 0.5, 600, 50, LAT, LNG)).toBeNull();
  });
});

describe("snapToSafeCell", () => {
  const n = 30;
  const make = (): PlannerGrid => ({
    gridSize: n,
    cellSizeMeters: 50,
    ignitionMin: new Float32Array(n * n).fill(Infinity),
  });

  it("keeps a safe cell where it is (no terrain data needed)", () => {
    const g = make();
    expect(snapToSafeCell(15 * n + 15, g, 0, 30, 20)).toBe(15 * n + 15);
  });

  it("moves a burning cell to the nearest cell outside the fire", () => {
    const g = make();
    for (let r = 13; r <= 17; r++) for (let c = 13; c <= 17; c++) g.ignitionMin[r * n + c] = 0;
    const s = snapToSafeCell(15 * n + 15, g, 10, 30, 20)!;
    expect(s).not.toBeNull();
    expect(g.ignitionMin[s]).toBe(Infinity);
    const r = Math.floor(s / n), c = s % n;
    expect(Math.hypot(r - 15, c - 15)).toBe(3);
  });

  it("moves a water click to the nearest land cell", () => {
    const g = make();
    g.passable = new Uint8Array(n * n).fill(1);
    for (let c = 0; c <= 15; c++) g.passable[10 * n + c] = 0;
    expect(snapToSafeCell(10 * n + 5, g, 0, 30, 20)).toSatisfy(
      (s: number) => s === 9 * n + 5 || s === 11 * n + 5
    );
  });

  it("returns null when everything in range is on fire", () => {
    const g = make();
    g.ignitionMin.fill(0);
    expect(snapToSafeCell(15 * n + 15, g, 0, 30, 5)).toBeNull();
  });
});

describe("burningCentroid", () => {
  it("is null with no burning cells", () => {
    expect(burningCentroid(new Uint8Array(100), 10)).toBeNull();
  });

  it("averages burning cells only", () => {
    const s = new Uint8Array(100);
    s[2 * 10 + 4] = CellState.Burning;
    s[4 * 10 + 6] = CellState.Burning;
    s[9 * 10 + 9] = CellState.Burned;
    expect(burningCentroid(s, 10)).toEqual({ row: 3, col: 5 });
  });
});

describe("shiftedWind", () => {
  const n = 100, dog = 50 * n + 50;
  const cur = { windSpeed: 15, windDirection: 270 };
  it("blows from the fire toward the dog", () => {
    expect(shiftedWind(dog, { row: 80, col: 50 }, n, cur, 10).windDirection).toBeCloseTo(0, 6);
    expect(shiftedWind(dog, { row: 50, col: 80 }, n, cur, 10).windDirection).toBeCloseTo(90, 6);
    expect(shiftedWind(dog, { row: 20, col: 20 }, n, cur, 10).windDirection).toBeCloseTo(225, 6);
  });

  it("adds the delta and caps speed at 60 km/h", () => {
    expect(shiftedWind(dog, { row: 80, col: 50 }, n, cur, 10).windSpeed).toBe(25);
    expect(shiftedWind(dog, { row: 80, col: 50 }, n, { windSpeed: 55, windDirection: 0 }, 10).windSpeed).toBe(60);
  });
});
