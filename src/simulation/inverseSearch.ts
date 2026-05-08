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
  ResourceType,
  SimulationConfig,
  SimulationState,
  SuppressionConfig,
  SuppressionResult,
  SuppressionStepDiag,
} from "./types";
import { CellState, SUPPRESSION_BUNDLES } from "./types";
import { runSimulation, extendSimulation } from "./runner";
import { cheapestRosterForCapacity } from "../utils/cheapestRoster";
import type { RosterRateOverrides } from "../utils/cheapestRoster";
import { containmentCheck, type LatLng } from "../utils/containmentCheck";

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

export interface BoundarySearchOverrides {
  /** Percent units 0..100. Defaults to 2 (i.e. 2%). */
  breachTolerancePct?: number;
  /** Overrides Q_BOUNDARY_HI (default 2500 chains/hr). */
  searchCeilingChainsHr?: number;
  /** Passed through to cheapestRosterForCapacity. */
  rosterOverrides?: RosterRateOverrides;
  /**
   * Restricts the solver to only build rosters using these resource types.
   * Omitted = all solver-supported types eligible (back-compat).
   */
  availableTypes?: ResourceType[];
}

export interface FindMinRosterForBoundaryInput {
  config: SimulationConfig;
  fuelMap: FuelType[];
  elevationMap?: Float32Array;
  centerLat: number;
  centerLng: number;
  initialGrid: Uint8Array;
  initialStep: number;
  polygon: LatLng[];
  maxSteps: number;
  modelConfig?: BoundarySearchOverrides;
}

export interface BisectionTraceEntry {
  capacityChainsHr: number;
  roster: ResourceCount[];
  passed: boolean;
  breachStep: number | null;
  breachPercent: number;
}

export interface FindMinRosterForBoundaryResult {
  recommendedRoster: ResourceCount[] | null;
  bestEffortRoster: ResourceCount[];
  passingRun: SuppressionResult | null;
  failingRun: SuppressionResult | null;
  breachStep: number | null;
  breachPercent: number;
  bisectionTrace: BisectionTraceEntry[];
}

const Q_BOUNDARY_LO = 0;
// 2500 chains/hr ≈ 33 dozers + crews + aerial. Past the single-IC max
// (1000 ch/hr) but covers historical mega-fire surges. Recommendations
// above 1000 are flagged in the UI as "Multi-jurisdictional surge".
// Beyond 2500 the right answer is to redraw the boundary larger.
const Q_BOUNDARY_HI = 2500;
const Q_BOUNDARY_RESOLUTION = 25;

// 2% slop on the strict-containment criterion. A single rogue ember (1 cell
// out of thousands) flips ok=false under strict containment but is
// operationally indistinguishable from "contained" for IC decisions. Without
// this, the system reports "uncontainable" with a "0%" breach (rounded), which
// is the rogue-ember pathology the brainstorm flagged.
const BREACH_TOLERANCE = 0.02;

function runOnceFromGrid(
  input: FindMinRosterForBoundaryInput,
  roster: ResourceCount[],
  enableAbortOnBreach: boolean,
  tolerance: number,
): SuppressionResult {
  const responseDelayMin = input.initialStep * input.config.timestepMinutes;
  const suppression: SuppressionConfig | null =
    roster.length > 0 ? { responseDelayMin, resources: roster } : null;
  return extendSimulation(
    input.config,
    input.initialGrid,
    input.initialStep,
    input.fuelMap,
    input.elevationMap,
    input.centerLat,
    input.centerLng,
    () => 0,
    suppression,
    input.maxSteps,
    enableAbortOnBreach
      ? {
          polygon: input.polygon,
          centerLat: input.centerLat,
          centerLng: input.centerLng,
          breachToleranceFraction: tolerance,
        }
      : undefined,
  );
}

function scanForBreach(
  result: SuppressionResult,
  input: FindMinRosterForBoundaryInput,
  tolerance: number,
): { breachStep: number | null; breachPercent: number } {
  for (let i = 0; i < result.history.length; i++) {
    const check = containmentCheck(
      result.history[i],
      input.polygon,
      input.config,
      input.centerLat,
      input.centerLng,
    );
    if (!check.ok && check.breachPercent > tolerance) {
      return { breachStep: result.history[i].timestep, breachPercent: check.breachPercent };
    }
  }
  return { breachStep: null, breachPercent: 0 };
}

/**
 * Fast scan when the runner was invoked with `abortOnBreach`. The runner
 * breaks the step loop the first time a Burning cell appears outside the
 * polygon, so the LAST history entry is either the breach moment (if a
 * breach happened) or the natural end of the run (no breach).
 *
 * We just check the last entry — no full-history walk needed.
 */
function scanForBreachAborted(
  result: SuppressionResult,
  input: FindMinRosterForBoundaryInput,
  tolerance: number,
): { breachStep: number | null; breachPercent: number } {
  if (result.history.length === 0) {
    return { breachStep: null, breachPercent: 0 };
  }
  const last = result.history[result.history.length - 1];
  const check = containmentCheck(
    last,
    input.polygon,
    input.config,
    input.centerLat,
    input.centerLng,
  );
  if (!check.ok && check.breachPercent > tolerance) {
    return { breachStep: last.timestep, breachPercent: check.breachPercent };
  }
  return { breachStep: null, breachPercent: 0 };
}

export async function findMinRosterForBoundary(
  input: FindMinRosterForBoundaryInput,
): Promise<FindMinRosterForBoundaryResult> {
  const tolerance =
    input.modelConfig?.breachTolerancePct !== undefined
      ? input.modelConfig.breachTolerancePct / 100
      : BREACH_TOLERANCE;
  const ceiling = input.modelConfig?.searchCeilingChainsHr ?? Q_BOUNDARY_HI;
  const rosterOverrides = input.modelConfig?.rosterOverrides;
  const availableTypes = input.modelConfig?.availableTypes;

  // Special case: try baseline (no suppression) first. If the fire never
  // escapes the polygon even unsuppressed, recommend an empty roster.
  // Run WITHOUT abortOnBreach so we keep the full history for the
  // "passing" return path (the user sees the visualization).
  const baselineRun = runOnceFromGrid(input, [], false, tolerance);
  const baselineFinal = baselineRun.history[baselineRun.history.length - 1];
  const baselineFinalCheck = containmentCheck(
    baselineFinal,
    input.polygon,
    input.config,
    input.centerLat,
    input.centerLng,
  );
  const baselineScan = scanForBreach(baselineRun, input, tolerance);
  if (baselineFinalCheck.ok && baselineScan.breachStep === null) {
    return {
      recommendedRoster: [],
      bestEffortRoster: [],
      passingRun: baselineRun,
      failingRun: null,
      breachStep: null,
      breachPercent: 0,
      bisectionTrace: [
        {
          capacityChainsHr: 0,
          roster: [],
          passed: true,
          breachStep: null,
          breachPercent: 0,
        },
      ],
    };
  }

  const trace: BisectionTraceEntry[] = [];
  const runCache = new Map<number, SuppressionResult>();
  const passCache = new Map<number, boolean>();

  const tryCapacity = (capacity: number): { passed: boolean; run: SuppressionResult } => {
    if (runCache.has(capacity)) {
      return { passed: passCache.get(capacity)!, run: runCache.get(capacity)! };
    }
    const roster = cheapestRosterForCapacity(capacity, rosterOverrides, availableTypes);
    // Bisection candidates: enable abortOnBreach so failing sims fail fast.
    // History will be truncated at the first-breach step, which is exactly
    // what scanForBreachAborted needs.
    const run = runOnceFromGrid(input, roster, true, tolerance);
    const scan = scanForBreachAborted(run, input, tolerance);
    const passed = scan.breachStep === null;
    trace.push({
      capacityChainsHr: capacity,
      roster,
      passed,
      breachStep: scan.breachStep,
      breachPercent: scan.breachPercent,
    });
    runCache.set(capacity, run);
    passCache.set(capacity, passed);
    return { passed, run };
  };

  let lo = Q_BOUNDARY_LO;
  let hi = ceiling;
  while (hi - lo > Q_BOUNDARY_RESOLUTION) {
    const mid = Math.round((lo + hi) / 2 / Q_BOUNDARY_RESOLUTION) * Q_BOUNDARY_RESOLUTION;
    if (mid === lo || mid === hi) break;
    const { passed } = tryCapacity(mid);
    if (passed) hi = mid;
    else lo = mid;
  }

  const hiResult = tryCapacity(hi);
  const loResult = passCache.has(lo) ? { passed: passCache.get(lo)!, run: runCache.get(lo)! } : null;

  if (hiResult.passed) {
    const recommendedRoster = cheapestRosterForCapacity(hi, rosterOverrides, availableTypes);
    const failingRun = loResult && !loResult.passed ? loResult.run : null;
    const breach = failingRun
      ? scanForBreach(failingRun, input, tolerance)
      : { breachStep: null, breachPercent: 0 };
    return {
      recommendedRoster,
      bestEffortRoster: recommendedRoster,
      passingRun: hiResult.run,
      failingRun,
      breachStep: breach.breachStep,
      breachPercent: breach.breachPercent,
      bisectionTrace: trace,
    };
  }

  const bestEffortRoster = cheapestRosterForCapacity(ceiling, rosterOverrides, availableTypes);
  const breach = scanForBreach(hiResult.run, input, tolerance);
  return {
    recommendedRoster: null,
    bestEffortRoster,
    passingRun: null,
    failingRun: hiResult.run,
    breachStep: breach.breachStep,
    breachPercent: breach.breachPercent,
    bisectionTrace: trace,
  };
}
