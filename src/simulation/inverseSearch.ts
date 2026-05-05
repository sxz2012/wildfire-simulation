/**
 * Suppression inverse-search analyses.
 *
 *   Q1 - findMaxDelay: given a fixed bundle, find the largest response
 *        delay where suppression keeps the fire <= thresholdAreaHa.
 *   Q2 - findMinTier: given a fixed delay, find the smallest tier
 *        bundle that meets the same criterion.
 *
 * Pure TypeScript, no browser-only deps - runs in both the worker and
 * the Node dev-server. See:
 * docs/plans/2026-05-04-suppression-inverse-search-design.md
 */
import type {
  FuelType,
  SimulationConfig,
  SimulationState,
  SuppressionStepDiag,
} from "./types";
import { CellState, SUPPRESSION_BUNDLES } from "./types";

export type BundleKey = keyof typeof SUPPRESSION_BUNDLES;

// Tier ladder Q2 walks from smallest to largest.
export const TIER_LADDER: BundleKey[] = [
  "initialAttack",
  "type3",
  "type2",
  "type1",
];

export interface InverseSearchInput {
  config: SimulationConfig;
  fuelMap: FuelType[];
  elevationMap?: Float32Array;
  igniteRow: number;
  igniteCol: number;
  centerLat: number;
  centerLng: number;
  maxSteps: number;
  thresholdAreaHa: number;
}

export interface SimRunSummary {
  history: SimulationState[];
  diags: SuppressionStepDiag[];
  finalAreaHa: number;
}

/**
 * Each cell that's Burning OR Burned at the final snapshot counts as
 * burned area. cellSizeMeters^2 / 10_000 = ha per cell.
 */
export function finalAreaHa(
  history: SimulationState[],
  cellSizeMeters: number,
): number {
  if (history.length === 0) return 0;
  const last = history[history.length - 1].grid;
  let burned = 0;
  for (let i = 0; i < last.length; i++) {
    if (last[i] === CellState.Burning || last[i] === CellState.Burned) {
      burned++;
    }
  }
  const haPerCell = (cellSizeMeters * cellSizeMeters) / 10_000;
  return burned * haPerCell;
}
