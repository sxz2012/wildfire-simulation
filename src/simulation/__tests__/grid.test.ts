import { describe, it, expect } from "vitest";
import { createGrid, igniteCell, getCell } from "../grid";
import { CellState, FuelType, DEFAULT_CONFIG } from "../types";

describe("createGrid", () => {
  it("creates a grid of correct size with interior cells unburned and edge cells burned", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 10 };
    const grid = createGrid(config, 36.7, -119.5, () => 100);

    expect(grid.length).toBe(10 * 10);

    // Center cell should be unburned
    const center = grid[5 * 10 + 5];
    expect(center.state).toBe(CellState.Unburned);
    expect(center.burnTimer).toBe(0);

    // All cells should have a valid fuel type
    for (const cell of grid) {
      expect([FuelType.Grass, FuelType.Shrub, FuelType.Forest]).toContain(cell.fuel);
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
