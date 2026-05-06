import {
  CellState,
  FUEL_PROPERTIES,
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
import { containmentCheck, type LatLng } from "../utils/containmentCheck";

export interface AbortOnBreachOptions {
  polygon: LatLng[];
  centerLat: number;
  centerLng: number;
  /**
   * Fraction of total burning cells allowed outside the polygon before the
   * sim aborts. Mitigates the rogue-ember pathology where a single cell
   * outside an otherwise-perfect containment line flips ok=false. Defaults to
   * 0 (strict). The boundary inverse search passes 0.02 (2%).
   */
  breachToleranceFraction?: number;
}

function snapshotGrid(grid: GridCell[], gridSize: number): Uint8Array {
  const snapshot = new Uint8Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) snapshot[i] = grid[i].state;
  return snapshot;
}

function runOnePassFromGrid(
  initialGrid: GridCell[],
  initialStep: number,
  config: SimulationConfig,
  maxSteps: number,
  suppression: SuppressionConfig | null | undefined,
  abortOnBreach?: AbortOnBreachOptions,
): { history: SimulationState[]; diags: SuppressionStepDiag[] } {
  let grid = initialGrid;
  const history: SimulationState[] = [
    { grid: snapshotGrid(grid, config.gridSize), timestep: initialStep },
  ];
  const diags: SuppressionStepDiag[] = [];
  let cumulativeChains = 0;

  for (let step = initialStep + 1; step <= maxSteps; step++) {
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

    if (abortOnBreach) {
      const lastState = history[history.length - 1];
      const check = containmentCheck(
        lastState,
        abortOnBreach.polygon,
        config,
        abortOnBreach.centerLat,
        abortOnBreach.centerLng,
      );
      const tol = abortOnBreach.breachToleranceFraction ?? 0;
      if (!check.ok && check.breachPercent > tol) break;
    }

    const hasBurning = grid.some((c) => c.state === CellState.Burning);
    if (!hasBurning) break;
  }
  return { history, diags };
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
  const grid = createGrid(config, centerLat, centerLng, elevationFn, fuelMap, elevationMap);
  igniteCell(grid, igniteRow, igniteCol, config.gridSize);
  return runOnePassFromGrid(grid, 0, config, maxSteps, suppression);
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

/**
 * Resume simulation from an arbitrary mid-state grid snapshot.
 * Used by the inverse-search-on-boundary flow: when the user pauses a
 * wildfire-only sim, we extend from the paused grid rather than re-igniting.
 *
 * NOTE on suppression timing: `responseDelayMin` is interpreted as
 * time-since-ignition (step * timestepMinutes), NOT time-since-resume. The
 * caller controls "deploy now" semantics by passing
 * `responseDelayMin = initialStep * timestepMinutes`.
 */
export function extendSimulation(
  config: SimulationConfig,
  initialGrid: Uint8Array,
  initialStep: number,
  fuelMap: FuelType[] | undefined,
  elevationMap: Float32Array | undefined,
  centerLat: number,
  centerLng: number,
  elevationFn: (lat: number, lng: number) => number,
  suppression: SuppressionConfig | null,
  maxSteps: number,
  abortOnBreach?: AbortOnBreachOptions,
): SuppressionResult {
  const fresh = createGrid(config, centerLat, centerLng, elevationFn, fuelMap, elevationMap);
  for (let i = 0; i < fresh.length; i++) {
    fresh[i].state = initialGrid[i] as CellState;
    if (fresh[i].state === CellState.Burning) {
      // Lossy: original burnTimer is not preserved across snapshots, so we
      // refill it. Over-estimates remaining burn time by < 1 step on average.
      fresh[i].burnTimer = FUEL_PROPERTIES[fresh[i].fuel].burnDuration;
    }
  }
  return runOnePassFromGrid(
    fresh,
    initialStep,
    config,
    maxSteps,
    suppression,
    abortOnBreach,
  );
}
