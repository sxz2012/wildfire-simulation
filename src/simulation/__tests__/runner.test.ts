import { describe, it, expect } from "vitest";
import { runSimulation } from "../runner";
import { CellState, DEFAULT_CONFIG } from "../types";

describe("runSimulation", () => {
  it("produces state history with correct number of snapshots", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 10 };
    const maxSteps = 20;
    const result = runSimulation(config, 5, 5, () => 0, maxSteps);

    expect(result.history.length).toBeLessThanOrEqual(maxSteps + 1);
    expect(result.history.length).toBeGreaterThan(1);
    expect(result.config).toEqual(config);
  });

  it("first snapshot has only the ignition point burning", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 10 };
    const result = runSimulation(config, 5, 5, () => 0, 10);

    const first = result.history[0];
    expect(first.timestep).toBe(0);

    let burningCount = 0;
    for (let i = 0; i < first.grid.length; i++) {
      if (first.grid[i] === CellState.Burning) burningCount++;
    }
    expect(burningCount).toBe(1);
    expect(first.grid[5 * 10 + 5]).toBe(CellState.Burning);
  });

  it("stops early if no cells are burning", () => {
    const config = { ...DEFAULT_CONFIG, gridSize: 5, humidity: 100 };
    const result = runSimulation(config, 2, 2, () => 0, 500);

    expect(result.history.length).toBeLessThan(500);
  });
});
