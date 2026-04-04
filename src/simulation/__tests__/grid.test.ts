import { describe, it, expect } from "vitest";
import { createGrid, igniteCell, getCell } from "../grid";
import { CellState, FuelType, DEFAULT_CONFIG } from "../types";

describe("createGrid", () => {
  it("creates a grid of correct size with all cells unburned", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 10 };
    const grid = createGrid(config, 36.7, -119.5, () => 100);

    expect(grid.length).toBe(10 * 10);
    for (let i = 0; i < grid.length; i++) {
      const cell = grid[i];
      expect(cell.state).toBe(CellState.Unburned);
      expect(cell.fuel).toBe(FuelType.Grass);
      expect(cell.burnTimer).toBe(0);
    }
  });

  it("assigns lat/lng based on center and cell size", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 3, cellSizeMeters: 1000 };
    const grid = createGrid(config, 0, 0, () => 0);

    // Center cell (1,1) should be closest to (0, 0)
    const center = grid[1 * 3 + 1];
    expect(Math.abs(center.lat)).toBeLessThan(0.01);
    expect(Math.abs(center.lng)).toBeLessThan(0.01);
  });
});

describe("igniteCell", () => {
  it("sets cell to burning with correct burn timer", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 5 };
    const grid = createGrid(config, 0, 0, () => 0);

    igniteCell(grid, 2, 2, config.gridSize);

    const cell = getCell(grid, 2, 2, config.gridSize);
    expect(cell.state).toBe(CellState.Burning);
    expect(cell.burnTimer).toBeGreaterThan(0);
  });
});
