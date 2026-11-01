import type { SimulationState } from "../types";
import type { MissionPhase } from "./mission";
import type { PlannerGrid } from "./types";

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
 * so the existing report is replayed instead of making a new one.
 */
export function shouldReport(a: {
  phase: MissionPhase | null;
  trueFireNear: boolean;
  nowMin: number;
  reports: Report[];
  shiftMin: number | null;
}): boolean {
  if (a.reports.some((r) => r.min > a.nowMin)) return false;
  if (a.phase !== "scouting" && !a.trueFireNear) return false;
  const since = a.shiftMin !== null && a.shiftMin <= a.nowMin ? a.shiftMin : -Infinity;
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
