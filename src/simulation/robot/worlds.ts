import { CellState, type SimulationState } from "../types";
import type { MissionPhase } from "./mission";
import type { Plan, PlannerGrid } from "./types";

/** Weather the fire model runs on (archive, true local, or measured by the dog). */
export interface Conditions {
  windDirection: number;
  windSpeed: number;
  humidity: number;
  tempC: number;
}

/** Near a fire, the real local air is hotter and drier than the archive says. */
export const TRUE_LOCAL_OFFSET = { tempC: 5, humidity: -10 };

export function trueConditions(archive: Conditions): Conditions {
  return {
    ...archive,
    tempC: archive.tempC + TRUE_LOCAL_OFFSET.tempC,
    humidity: Math.max(5, archive.humidity + TRUE_LOCAL_OFFSET.humidity),
  };
}

/** `apiExtend` weather block, mapped the same way as `handleStartWildfire`. */
export function conditionsWeather(c: Conditions) {
  return { tempMean: c.tempC, tempMax: c.tempC + 5, precipitation: 0, cumulativePrecip: 0 };
}

/** A forecast the dog plans on, in force from `fromMin` until the next version. */
export interface ForecastVersion {
  fromMin: number;
  history: SimulationState[];
  grid: PlannerGrid;
}

/** The version in force at `min`; the first version also covers every earlier minute. */
export function forecastAt(versions: ForecastVersion[], min: number): ForecastVersion {
  let v = versions[0];
  for (const x of versions) if (x.fromMin <= min) v = x;
  return v;
}

/** What the dog sent back, and what it did to the forecast. */
export interface Report {
  min: number;
  measured: Conditions;
  assumed: Conditions;
  edgeOffsetM: number;
  matchBefore: number;
  matchAfter: number;
}

/**
 * The dog reports when it can see the true fire (at the edge, or the true fire
 * comes near) and has something new to say: no report yet, or a wind shift
 * since the last one. A report later than now means the timeline was rewound,
 * so the existing report is replayed instead of making a new one. A failed
 * attempt (`failedMin`) counts as covered, so a down server isn't hammered.
 */
export function shouldReport(a: {
  phase: MissionPhase | null;
  trueFireNear: boolean;
  nowMin: number;
  reports: Report[];
  shiftMin: number | null;
  failedMin?: number | null;
  /** A true-fire safety report may repeat once the last attempt is this old (the runs are random, so they drift apart again). */
  safetyGapMin?: number;
}): boolean {
  if (a.reports.some((r) => r.min > a.nowMin)) return false;
  if (a.phase !== "scouting" && !a.trueFireNear) return false;
  if (a.trueFireNear && a.safetyGapMin !== undefined) {
    let last = -Infinity;
    for (const r of a.reports) if (r.min <= a.nowMin) last = Math.max(last, r.min);
    if (a.failedMin != null && a.failedMin <= a.nowMin) last = Math.max(last, a.failedMin);
    if (a.nowMin - last >= a.safetyGapMin) return true;
  }
  const since = a.shiftMin !== null && a.shiftMin <= a.nowMin ? a.shiftMin : -Infinity;
  if (a.failedMin != null && a.failedMin >= since && a.failedMin <= a.nowMin) return false;
  return !a.reports.some((r) => r.min >= since);
}

/** Latest report at or before now; its card shows for 3 timesteps, then collapses. */
export function activeReport(
  reports: Report[],
  nowMin: number,
  timestepMin: number
): { report: Report | null; cardVisible: boolean } {
  let report: Report | null = null;
  for (const r of reports) if (r.min <= nowMin && (!report || r.min > report.min)) report = r;
  return { report, cardVisible: !!report && nowMin < report.min + 3 * timestepMin };
}

/**
 * Integer percent overlap (intersection over union) of interior cells the fire
 * has reached. With `onlyUnburnedIn`, cells already reached there are skipped,
 * so only new spread is scored.
 */
export function forecastMatch(forecast: Uint8Array, truth: Uint8Array, n: number, onlyUnburnedIn?: Uint8Array): number {
  let inter = 0, union = 0;
  for (let r = 1; r < n - 1; r++) {
    for (let c = 1; c < n - 1; c++) {
      const i = r * n + c;
      if (onlyUnburnedIn && onlyUnburnedIn[i] !== CellState.Unburned) continue;
      const a = forecast[i] !== CellState.Unburned, b = truth[i] !== CellState.Unburned;
      if (a && b) inter++;
      if (a || b) union++;
    }
  }
  return union === 0 ? 100 : Math.round((inter / union) * 100);
}

/**
 * How well the forecast predicts the spread still to come: overlap of new
 * spread (cells unburned in the true fire now) a few hours ahead (16 steps =
 * 4 h), clamped to the shorter history. The burned area both agree on is not
 * scored — it would hide a forecast heading the wrong way.
 */
export function matchAtHorizon(
  forecast: SimulationState[],
  truth: SimulationState[],
  step: number,
  n: number,
  horizonSteps = 16
): number {
  const at = Math.min(step + horizonSteps, forecast.length - 1, truth.length - 1);
  const now = truth[Math.min(step, truth.length - 1)].grid;
  return forecastMatch(forecast[at].grid, truth[at].grid, n, now);
}

function nearestBurningCells(state: Uint8Array, dogIdx: number, n: number): number {
  const dr = Math.floor(dogIdx / n), dc = dogIdx % n;
  let best = Infinity;
  for (let i = 0; i < state.length; i++) {
    if (state[i] !== CellState.Burning) continue;
    best = Math.min(best, Math.hypot(Math.floor(i / n) - dr, (i % n) - dc));
  }
  return best;
}

/** How much closer (m, +) or farther (−) the true fire edge is than the forecast said; 0 if either has no fire. */
export function edgeOffsetMeters(
  forecast: Uint8Array,
  truth: Uint8Array,
  dogIdx: number,
  n: number,
  cellSizeM: number
): number {
  const f = nearestBurningCells(forecast, dogIdx, n), t = nearestBurningCells(truth, dogIdx, n);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return 0;
  return Math.round(((f - t) * cellSizeM) / 10) * 10;
}

/** Interior cells the fire has reached that touch unburned ground, strided down to at most `maxPoints`. */
export function forecastEdgeCells(state: Uint8Array, n: number, maxPoints = 1500): number[] {
  const edge: number[] = [];
  for (let r = 1; r < n - 1; r++) {
    for (let c = 1; c < n - 1; c++) {
      const i = r * n + c;
      if (state[i] === CellState.Unburned) continue;
      if (
        state[i - 1] === CellState.Unburned || state[i + 1] === CellState.Unburned ||
        state[i - n] === CellState.Unburned || state[i + n] === CellState.Unburned
      ) edge.push(i);
    }
  }
  if (edge.length <= maxPoints) return edge;
  const stride = Math.ceil(edge.length / maxPoints);
  return edge.filter((_, k) => k % stride === 0);
}

/** Consecutive [from, to] index pairs into a path, `every` cells apart, for arrowheads along it. */
export function arrowChunks(cells: number[], every = 12): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let from = 0; from < cells.length - 1; from += every) {
    out.push([from, Math.min(from + every, cells.length - 1)]);
  }
  return out;
}

/**
 * The dog can see the true fire coming: it is due at the dog's cell, or at a
 * route cell the dog reaches within the next step, sooner than `thresholdMin`
 * after the dog would be there. Looking ahead matters: one step is ~27 cells.
 */
export function trueFireThreat(
  route: Plan | null,
  dogCell: number,
  nowMin: number,
  stepMin: number,
  trueIgn: Float32Array,
  thresholdMin: number
): boolean {
  if (trueIgn[dogCell] - nowMin < thresholdMin) return true;
  if (!route) return false;
  for (let i = 0; i < route.cells.length; i++) {
    const t = route.arrivalMin[i];
    if (t < nowMin || t > nowMin + stepMin) continue;
    if (trueIgn[route.cells[i]] - t < thresholdMin) return true;
  }
  return false;
}

/**
 * The corrected forecast: the old forecast before `step`, then the re-run that
 * starts from the true state at `step` (`resumed[0]`). A forecast that ended
 * early is padded with its last state so indices stay aligned with steps.
 */
export function spliceForecast(history: SimulationState[], step: number, resumed: SimulationState[]): SimulationState[] {
  const head = history.slice(0, step);
  while (head.length < step) head.push({ ...history[history.length - 1], timestep: head.length });
  return [...head, ...resumed];
}
