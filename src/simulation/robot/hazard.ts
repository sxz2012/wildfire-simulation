import { CellState, FuelType } from "../types";
import type { SimulationState } from "../types";
import type { PlannerGrid, RobotConfig } from "./types";

/**
 * Hazard map: the first simulation minute each cell is no longer Unburned.
 * Cells that never ignite within the forecast get Infinity.
 */
export function computeIgnitionMinutes(
  history: SimulationState[],
  timestepMinutes: number
): Float32Array {
  if (history.length === 0) return new Float32Array(0);
  const n = history[0].grid.length;
  const out = new Float32Array(n).fill(Infinity);
  let remaining = n;
  for (let s = 0; s < history.length && remaining > 0; s++) {
    const grid = history[s].grid;
    const minute = s * timestepMinutes;
    for (let i = 0; i < n; i++) {
      if (out[i] === Infinity && grid[i] !== CellState.Unburned) {
        out[i] = minute;
        remaining--;
      }
    }
  }
  return out;
}

/** 0 for water cells, 1 otherwise; undefined when there is no fuel map. */
export function passableFromFuel(
  fuelMap: FuelType[] | null | undefined,
  gridSize: number
): Uint8Array | undefined {
  if (!fuelMap) return undefined;
  const n = gridSize * gridSize;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = fuelMap[i] === FuelType.Water ? 0 : 1;
  return out;
}

/** Each cell's walking speed relative to open ground, from its land cover; water 0. Undefined without a fuel map. */
export function groundSpeedFromFuel(
  fuelMap: FuelType[] | null | undefined,
  gridSize: number,
  speed: RobotConfig["groundSpeed"]
): Float32Array | undefined {
  if (!fuelMap) return undefined;
  const n = gridSize * gridSize;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fuelMap[i] === FuelType.Water ? 0 : speed[fuelMap[i] as keyof typeof speed];
  return out;
}

/**
 * Keep-away map: the first minute the forecast fire comes within `distanceM` of
 * each cell (centre to centre), i.e. the earliest ignition within that radius.
 * Planning on it with no time margin keeps the dog that far from the predicted fire.
 */
export function keepAwayIgnition(
  ignitionMin: Float32Array,
  gridSize: number,
  cellSizeMeters: number,
  distanceM: number
): Float32Array {
  const out = new Float32Array(ignitionMin);
  const rad = Math.floor(distanceM / cellSizeMeters + 1e-9);
  if (rad <= 0) return out;
  const r2 = (distanceM / cellSizeMeters) ** 2 + 1e-9;
  const offsets: Array<[number, number]> = [];
  for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
    if ((dr || dc) && dr * dr + dc * dc <= r2) offsets.push([dr, dc]);
  }
  const n = gridSize;
  for (let i = 0; i < ignitionMin.length; i++) {
    const t = ignitionMin[i];
    if (t === Infinity) continue;
    const r = Math.floor(i / n), c = i % n;
    for (const [dr, dc] of offsets) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      const j = rr * n + cc;
      if (t < out[j]) out[j] = t;
    }
  }
  return out;
}

/**
 * Planner grid that keeps `distanceM` from the predicted fire: plans on the keep-away
 * map; the last resort keeps half the distance, then plans on the fire itself.
 * No distance: the grid as it is.
 */
export function withKeepAway(grid: PlannerGrid, distanceM: number | undefined): PlannerGrid {
  if (distanceM === undefined) return grid;
  const within = (m: number) => keepAwayIgnition(grid.ignitionMin, grid.gridSize, grid.cellSizeMeters, m);
  return { ...grid, ignitionMin: within(distanceM), lastResortMin: [within(distanceM / 2), grid.ignitionMin] };
}

/** The forecast fire itself (first minute each cell burns), keep-away or not. */
export function fireOf(grid: PlannerGrid): Float32Array {
  return grid.lastResortMin?.at(-1) ?? grid.ignitionMin;
}

/** Metres (centre to centre) from `cell` to the nearest spot the fire has reached by `nowMin`; Infinity beyond `maxM`. */
export function distanceToFireM(
  fire: Float32Array,
  gridSize: number,
  cellSizeMeters: number,
  cell: number,
  nowMin: number,
  maxM: number
): number {
  const n = gridSize, rad = Math.floor(maxM / cellSizeMeters);
  const r = Math.floor(cell / n), c = cell % n;
  let best = Infinity;
  for (let rr = Math.max(0, r - rad); rr <= Math.min(n - 1, r + rad); rr++) {
    for (let cc = Math.max(0, c - rad); cc <= Math.min(n - 1, c + rad); cc++) {
      if (!(fire[rr * n + cc] <= nowMin)) continue;
      const d = Math.hypot(rr - r, cc - c) * cellSizeMeters;
      if (d < best) best = d;
    }
  }
  return best <= maxM ? best : Infinity;
}
