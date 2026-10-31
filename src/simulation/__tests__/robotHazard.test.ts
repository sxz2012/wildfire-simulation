import { describe, it, expect } from "vitest";
import { computeIgnitionMinutes, passableFromFuel } from "../robot/hazard";
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
