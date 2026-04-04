import {
  CellState,
  type SimulationConfig,
  type SimulationResult,
  type SimulationState,
  type GridCell,
} from "./types";
import { createGrid, igniteCell } from "./grid";
import { simulateStep } from "./spread";

function snapshotGrid(grid: GridCell[], gridSize: number): Uint8Array {
  const snapshot = new Uint8Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) {
    snapshot[i] = grid[i].state;
  }
  return snapshot;
}

export function runSimulation(
  config: SimulationConfig,
  igniteRow: number,
  igniteCol: number,
  elevationFn: (lat: number, lng: number) => number,
  maxSteps: number
): SimulationResult {
  let grid = createGrid(config, 0, 0, elevationFn);
  igniteCell(grid, igniteRow, igniteCol, config.gridSize);

  const history: SimulationState[] = [
    { grid: snapshotGrid(grid, config.gridSize), timestep: 0 },
  ];

  for (let step = 1; step <= maxSteps; step++) {
    grid = simulateStep(grid, config);

    history.push({
      grid: snapshotGrid(grid, config.gridSize),
      timestep: step,
    });

    const hasBurning = grid.some((cell) => cell.state === CellState.Burning);
    if (!hasBurning) break;
  }

  return { history, config };
}
