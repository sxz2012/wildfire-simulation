import {
  CellState,
  type FuelType,
  type SimulationConfig,
  type SimulationState,
  type GridCell,
  type SuppressionConfig,
  type SuppressionResult,
  type SuppressionStepDiag,
  type DualSimulationResult,
} from "./types";
import { createGrid, igniteCell } from "./grid";
import { simulateStep } from "./spread";
import {
  suppressionStep,
  totalChainsPerHour,
  delayDecay,
  chainsToMeters,
  containmentProbability,
} from "./suppression";

function snapshotGrid(grid: GridCell[], gridSize: number): Uint8Array {
  const snapshot = new Uint8Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) snapshot[i] = grid[i].state;
  return snapshot;
}

function runOnePass(
  config: SimulationConfig,
  igniteRow: number,
  igniteCol: number,
  elevationFn: (lat: number, lng: number) => number,
  maxSteps: number,
  centerLat: number,
  centerLng: number,
  fuelMap: FuelType[] | undefined,
  elevationMap: Float32Array | undefined,
  suppression: SuppressionConfig | undefined,
): { history: SimulationState[]; diags: SuppressionStepDiag[] } {
  let grid = createGrid(config, centerLat, centerLng, elevationFn, fuelMap, elevationMap);
  igniteCell(grid, igniteRow, igniteCol, config.gridSize);
  const history: SimulationState[] = [
    { grid: snapshotGrid(grid, config.gridSize), timestep: 0 },
  ];
  const diags: SuppressionStepDiag[] = [];
  let cumulativeChains = 0;

  for (let step = 1; step <= maxSteps; step++) {
    grid = simulateStep(grid, config, step);

    if (suppression && suppression.resources.length > 0) {
      const elapsedMin = step * config.timestepMinutes;
      const onScene = elapsedMin >= suppression.responseDelayMin;

      if (onScene) {
        const stepChainsBudget =
          totalChainsPerHour(suppression.resources) *
          (config.timestepMinutes / 60) *
          delayDecay(suppression.responseDelayMin);
        const cellsBudget = Math.floor(
          chainsToMeters(stepChainsBudget) / config.cellSizeMeters,
        );
        const { picked, perimeterMeters } = suppressionStep(
          grid,
          config.gridSize,
          config.cellSizeMeters,
          cellsBudget,
          config.windDirection,
        );
        for (const idx of picked) grid[idx].state = CellState.Suppressed;
        cumulativeChains += stepChainsBudget;

        diags.push({
          step,
          cumulativeLineMeters: chainsToMeters(cumulativeChains),
          activePerimeterMeters: perimeterMeters,
          containmentProbability: containmentProbability(
            chainsToMeters(cumulativeChains),
            perimeterMeters,
          ),
          resourcesActive: suppression.resources.reduce((s, r) => s + r.count, 0),
          newFirelineCells: picked.length,
        });
      } else {
        // Pre-response: skip the expensive grid scan entirely. Push a
        // placeholder diag so the per-step series stays continuous.
        diags.push({
          step,
          cumulativeLineMeters: 0,
          activePerimeterMeters: 0,
          containmentProbability: 0,
          resourcesActive: 0,
          newFirelineCells: 0,
        });
      }
    }

    history.push({ grid: snapshotGrid(grid, config.gridSize), timestep: step });

    const hasBurning = grid.some((c) => c.state === CellState.Burning);
    if (!hasBurning) break;
  }
  return { history, diags };
}

export function runSimulation(
  config: SimulationConfig,
  igniteRow: number,
  igniteCol: number,
  elevationFn: (lat: number, lng: number) => number,
  maxSteps: number,
  centerLat = 0,
  centerLng = 0,
  fuelMap?: FuelType[],
  elevationMap?: Float32Array,
  suppression?: SuppressionConfig,
): DualSimulationResult {
  const baseline = runOnePass(
    config, igniteRow, igniteCol, elevationFn, maxSteps,
    centerLat, centerLng, fuelMap, elevationMap, undefined,
  ).history;

  const suppressed: SuppressionResult | undefined =
    suppression && suppression.resources.length > 0
      ? runOnePass(
          config, igniteRow, igniteCol, elevationFn, maxSteps,
          centerLat, centerLng, fuelMap, elevationMap, suppression,
        )
      : undefined;

  return { config, baseline, suppressed };
}
