import { CellState } from "../types";

/** Mean row/col of the burning cells, or null when nothing is burning. */
export function burningCentroid(
  state: Uint8Array,
  gridSize: number
): { row: number; col: number } | null {
  let sr = 0, sc = 0, count = 0;
  for (let i = 0; i < state.length; i++) {
    if (state[i] !== CellState.Burning) continue;
    sr += Math.floor(i / gridSize);
    sc += i % gridSize;
    count++;
  }
  return count === 0 ? null : { row: sr / count, col: sc / count };
}

/**
 * Scripted wind shift for the mock: wind blows from the fire toward the dog.
 * Meteorological "from" bearing = bearing from the dog to the fire centroid.
 */
export function shiftedWind(
  dogIdx: number,
  centroid: { row: number; col: number },
  gridSize: number,
  current: { windSpeed: number; windDirection: number },
  deltaKmh: number
): { windSpeed: number; windDirection: number } {
  const north = centroid.row - Math.floor(dogIdx / gridSize);
  const east = centroid.col - (dogIdx % gridSize);
  const bearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  return { windSpeed: Math.min(60, current.windSpeed + deltaKmh), windDirection: bearing };
}
