import { CellState, FuelType } from "../types";
import type { SimulationState } from "../types";

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
