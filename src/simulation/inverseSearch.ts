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
  ResourceCount,
  SimulationConfig,
  SimulationState,
  SuppressionConfig,
  SuppressionStepDiag,
} from "./types";
import { CellState, SUPPRESSION_BUNDLES } from "./types";
import { runSimulation } from "./runner";

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

function runOnce(
  input: InverseSearchInput,
  delayMin: number,
  bundle: ResourceCount[],
): SimRunSummary {
  const suppression: SuppressionConfig = {
    responseDelayMin: delayMin,
    resources: bundle,
  };
  const result = runSimulation(
    input.config,
    input.igniteRow,
    input.igniteCol,
    () => 0,
    input.maxSteps,
    input.centerLat,
    input.centerLng,
    input.fuelMap,
    input.elevationMap,
    suppression,
  );
  // For inverse search we always want the SUPPRESSED history if it
  // exists, else the baseline.
  const history = result.suppressed?.history ?? result.baseline;
  return {
    history,
    diags: result.suppressed?.diags ?? [],
    finalAreaHa: finalAreaHa(history, input.config.cellSizeMeters),
  };
}

export interface FindMaxDelayInput extends InverseSearchInput {
  bundle: ResourceCount[];
}

export interface FindMaxDelayResult {
  /**
   * Largest delay (in minutes) where finalAreaHa <= thresholdAreaHa.
   * `null` when even delay=0 fails (no delay can save this fire).
   */
  maxDelayMin: number | null;
  justWorks: SimRunSummary | null;
  justFails: SimRunSummary | null;
  bisectionTrace: Array<{ delayMin: number; finalAreaHa: number; passed: boolean }>;
}

const Q1_RESOLUTION_MIN = 5;
const Q1_DELAY_LO = 0;
const Q1_DELAY_HI = 180;

export async function findMaxDelay(
  input: FindMaxDelayInput,
): Promise<FindMaxDelayResult> {
  const trace: FindMaxDelayResult["bisectionTrace"] = [];

  const tryDelay = (delay: number): SimRunSummary => {
    const run = runOnce(input, delay, input.bundle);
    trace.push({
      delayMin: delay,
      finalAreaHa: run.finalAreaHa,
      passed: run.finalAreaHa <= input.thresholdAreaHa,
    });
    return run;
  };

  // Boundary 1: if delay=0 already fails, no delay works.
  const at0 = tryDelay(Q1_DELAY_LO);
  if (at0.finalAreaHa > input.thresholdAreaHa) {
    return { maxDelayMin: null, justWorks: null, justFails: at0, bisectionTrace: trace };
  }

  // Boundary 2: if delay=max still passes, return max.
  const atMax = tryDelay(Q1_DELAY_HI);
  if (atMax.finalAreaHa <= input.thresholdAreaHa) {
    return {
      maxDelayMin: Q1_DELAY_HI,
      justWorks: atMax,
      justFails: null,
      bisectionTrace: trace,
    };
  }

  // Bisect between [low=passing, high=failing]
  let low = Q1_DELAY_LO;
  let high = Q1_DELAY_HI;
  let lowRun = at0;
  let highRun = atMax;
  while (high - low > Q1_RESOLUTION_MIN) {
    const mid = Math.floor((low + high) / 2 / Q1_RESOLUTION_MIN) * Q1_RESOLUTION_MIN;
    if (mid === low || mid === high) break;
    const run = tryDelay(mid);
    if (run.finalAreaHa <= input.thresholdAreaHa) {
      low = mid;
      lowRun = run;
    } else {
      high = mid;
      highRun = run;
    }
  }
  return {
    maxDelayMin: low,
    justWorks: lowRun,
    justFails: highRun,
    bisectionTrace: trace,
  };
}

export interface FindMinTierInput extends InverseSearchInput {
  delayMin: number;
}

export interface FindMinTierResult {
  /** First tier in TIER_LADDER that passes. `null` if all fail. */
  minTier: BundleKey | null;
  minWorking: SimRunSummary | null;
  tierBelow: SimRunSummary | null;
  tierTrace: Array<{ tier: BundleKey; finalAreaHa: number; passed: boolean }>;
}

export async function findMinTier(
  input: FindMinTierInput,
): Promise<FindMinTierResult> {
  const trace: FindMinTierResult["tierTrace"] = [];
  let lastFailingRun: SimRunSummary | null = null;

  for (const tier of TIER_LADDER) {
    const bundle = SUPPRESSION_BUNDLES[tier];
    const run = runOnce(input, input.delayMin, [...bundle]);
    const passed = run.finalAreaHa <= input.thresholdAreaHa;
    trace.push({ tier, finalAreaHa: run.finalAreaHa, passed });
    if (passed) {
      return {
        minTier: tier,
        minWorking: run,
        tierBelow: lastFailingRun,
        tierTrace: trace,
      };
    }
    lastFailingRun = run;
  }
  return {
    minTier: null,
    minWorking: null,
    tierBelow: lastFailingRun,
    tierTrace: trace,
  };
}
