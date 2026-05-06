/**
 * Fetch a precomputed scenario JSON, decode its RLE-compressed grids,
 * and return objects ready to drop into the existing useSimulation /
 * App state. The frontend can then animate it like a live run, except
 * loading is instant.
 */
import { rleDecode } from "../utils/rle";
import type { SimulationState, SuppressionStepDiag, ResourceCount } from "../simulation/types";

export interface LoadedScenarioMeta {
  id: string;
  name: string;
  description: string;
  location: { lat: number; lng: number };
  config: {
    gridSize: number;
    cellSizeMeters: number;
    timestepMinutes: number;
    windSpeed: number;
    windDirection: number;
    humidity: number;
  };
  thresholdAreaHa: number;
  suppression?: { responseDelayMin: number; resources: ResourceCount[] };
}

export interface LoadedScenarioAnalysis {
  q1?: {
    bundle: string;
    maxDelayMin: number | null;
  };
  q2?: {
    delayMin: number;
    minTier: string | null;
  };
}

export interface LoadedScenario {
  meta: LoadedScenarioMeta;
  fuelMap: number[];
  elevations: number[];
  baseline: { history: SimulationState[] };
  suppressed?: { history: SimulationState[]; diags: SuppressionStepDiag[] };
  analysis: LoadedScenarioAnalysis;
}

function rleStepsToHistory(rleSteps: number[][], gridCells: number): SimulationState[] {
  return rleSteps.map((rle, i) => ({
    grid: rleDecode(rle, gridCells),
    timestep: i,
  }));
}

export async function loadScenario(jsonUrl: string): Promise<LoadedScenario> {
  const res = await fetch(jsonUrl);
  if (!res.ok) {
    throw new Error(`Failed to load scenario from ${jsonUrl}: ${res.status}`);
  }
  const raw = await res.json();
  const gridCells = raw.meta.config.gridSize * raw.meta.config.gridSize;

  const baselineHistory = rleStepsToHistory(raw.baseline.rleSteps, gridCells);
  const suppressedHistory = raw.suppressed
    ? rleStepsToHistory(raw.suppressed.rleSteps, gridCells)
    : undefined;

  return {
    meta: raw.meta,
    fuelMap: raw.fuelMap,
    elevations: raw.elevations,
    baseline: { history: baselineHistory },
    suppressed: suppressedHistory
      ? { history: suppressedHistory, diags: raw.suppressed.diags ?? [] }
      : undefined,
    analysis: raw.analysis ?? {},
  };
}
