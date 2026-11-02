import { describe, it, expect } from "vitest";
import { computeIgnitionMinutes, distanceToFireM, fireOf, keepAwayIgnition, passableFromFuel, groundSpeedFromFuel, withKeepAway } from "../robot/hazard";
import { ROBOT_DEFAULTS } from "../robot/types";
import { CellState, FuelType } from "../types";
import type { SimulationState } from "../types";

function step(timestep: number, cells: Record<number, number>): SimulationState {
  const grid = new Uint8Array(9);
  for (const [i, s] of Object.entries(cells)) grid[Number(i)] = s;
  return { grid, timestep };
}

describe("computeIgnitionMinutes", () => {
  it("returns the first minute each cell leaves Unburned", () => {
    const history = [
      step(0, { 4: CellState.Burning }),
      step(1, { 4: CellState.Burning, 3: CellState.Burned }),
      step(2, { 4: CellState.Burned, 3: CellState.Burned, 5: CellState.Burning }),
    ];
    const out = computeIgnitionMinutes(history, 15);
    expect(out.length).toBe(9);
    expect(out[4]).toBe(0);
    expect(out[5]).toBe(30);
    expect(out[3]).toBe(15);
    expect(out[0]).toBe(Infinity);
  });

  it("returns an empty map for an empty history", () => {
    expect(computeIgnitionMinutes([], 15).length).toBe(0);
  });
});

describe("passableFromFuel", () => {
  it("marks water impassable and land passable", () => {
    const fuel = [FuelType.Water, FuelType.Grass, FuelType.Forest, FuelType.Shrub];
    expect(Array.from(passableFromFuel(fuel, 2)!)).toEqual([0, 1, 1, 1]);
  });

  it("returns undefined without a fuel map", () => {
    expect(passableFromFuel(undefined, 2)).toBeUndefined();
    expect(passableFromFuel(null, 2)).toBeUndefined();
  });
});

describe("groundSpeedFromFuel", () => {
  it("open grass is full speed, forest and brush slower, water 0", () => {
    const fuel = [FuelType.Water, FuelType.Grass, FuelType.Forest, FuelType.Shrub];
    expect(Array.from(groundSpeedFromFuel(fuel, 2, ROBOT_DEFAULTS.groundSpeed)!)).toEqual([0, 1, 0.7, 0.5].map(Math.fround));
  });

  it("returns undefined without a fuel map", () => {
    expect(groundSpeedFromFuel(undefined, 2, ROBOT_DEFAULTS.groundSpeed)).toBeUndefined();
  });
});

describe("keepAwayIgnition", () => {
  const n = 9;
  const at = (r: number, c: number) => r * n + c;

  it("a spot is off limits from the first minute the forecast fire comes within the distance", () => {
    const ign = new Float32Array(n * n).fill(Infinity);
    ign[at(4, 4)] = 30;
    const out = keepAwayIgnition(ign, n, 50, 100);
    expect(out[at(4, 4)]).toBe(30);
    expect(out[at(4, 6)]).toBe(30); // 100 m east
    expect(out[at(5, 5)]).toBe(30); // 71 m diagonally
    expect(out[at(5, 6)]).toBe(Infinity); // 112 m
    expect(out[at(4, 7)]).toBe(Infinity); // 150 m
  });

  it("takes the earliest fire within reach", () => {
    const ign = new Float32Array(n * n).fill(Infinity);
    ign[at(4, 2)] = 60;
    ign[at(4, 6)] = 15;
    const out = keepAwayIgnition(ign, n, 50, 100);
    expect(out[at(4, 4)]).toBe(15);
    expect(out[at(4, 1)]).toBe(60);
    expect(ign[at(4, 4)]).toBe(Infinity); // input untouched
  });

  it("0 m is the forecast itself", () => {
    const ign = Float32Array.from({ length: n * n }, (_, i) => i);
    expect(Array.from(keepAwayIgnition(ign, n, 50, 0))).toEqual(Array.from(ign));
  });
});

describe("withKeepAway", () => {
  const n = 9;
  const grid = () => {
    const ignitionMin = new Float32Array(n * n).fill(Infinity);
    ignitionMin[4 * n + 4] = 30;
    return { gridSize: n, cellSizeMeters: 50, ignitionMin };
  };

  it("plans on the keep-away map; the last resort keeps half the distance, then the fire itself", () => {
    const g = grid();
    const k = withKeepAway(g, 100);
    expect(k.ignitionMin[4 * n + 6]).toBe(30); // 100 m away
    expect(k.lastResortMin![0][4 * n + 6]).toBe(Infinity); // outside 50 m
    expect(k.lastResortMin![0][4 * n + 5]).toBe(30);
    expect(k.lastResortMin![1]).toBe(g.ignitionMin);
    expect(fireOf(k)).toBe(g.ignitionMin);
  });

  it("no distance leaves the grid as it is", () => {
    const g = grid();
    expect(withKeepAway(g, undefined)).toBe(g);
    expect(fireOf(g)).toBe(g.ignitionMin);
  });
});

describe("distanceToFireM", () => {
  const n = 9;
  const fire = new Float32Array(n * n).fill(Infinity);
  fire[4 * n + 4] = 30;

  it("is the distance to the nearest spot the fire has reached by now", () => {
    expect(distanceToFireM(fire, n, 50, 4 * n + 7, 30, 1000)).toBe(150);
    expect(distanceToFireM(fire, n, 50, 7 * n + 8, 30, 1000)).toBe(250);
  });

  it("Infinity before the fire gets there, or beyond the search distance", () => {
    expect(distanceToFireM(fire, n, 50, 4 * n + 7, 29, 1000)).toBe(Infinity);
    expect(distanceToFireM(fire, n, 50, 4 * n + 7, 30, 100)).toBe(Infinity);
  });
});
