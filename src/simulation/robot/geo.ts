import type { PlannerGrid } from "./types";

const M_PER_DEG_LAT = 111320;
const mPerDegLng = (centerLat: number) => 111320 * Math.cos((centerLat * Math.PI) / 180);

/** Lat/lng of a cell center — same formula as createGrid. */
export function cellCenter(
  idx: number,
  gridSize: number,
  cellSizeMeters: number,
  centerLat: number,
  centerLng: number
): { lat: number; lng: number } {
  const half = gridSize / 2;
  const row = Math.floor(idx / gridSize), col = idx % gridSize;
  return {
    lat: centerLat + ((row - half) * cellSizeMeters) / M_PER_DEG_LAT,
    lng: centerLng + ((col - half) * cellSizeMeters) / mPerDegLng(centerLat),
  };
}

/** Grid cell containing a lat/lng, or null outside the grid. */
export function latLngToCell(
  lat: number,
  lng: number,
  gridSize: number,
  cellSizeMeters: number,
  centerLat: number,
  centerLng: number
): number | null {
  const half = gridSize / 2;
  const row = Math.round(half + ((lat - centerLat) * M_PER_DEG_LAT) / cellSizeMeters);
  const col = Math.round(half + ((lng - centerLng) * mPerDegLng(centerLat)) / cellSizeMeters);
  if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return null;
  return row * gridSize + col || 0; // Math.round can yield -0 at the grid corner
}

/**
 * Nearest passable cell (Euclidean, in cells) that stays clear of fire for
 * `marginMin` after `nowMin`. Null if none within `radiusCells`.
 */
export function snapToSafeCell(
  idx: number,
  grid: PlannerGrid,
  nowMin: number,
  marginMin: number,
  radiusCells: number
): number | null {
  const { gridSize: n, ignitionMin, passable } = grid;
  const r0 = Math.floor(idx / n), c0 = idx % n;
  const safe = (i: number) =>
    (!passable || passable[i] !== 0) && nowMin + marginMin < ignitionMin[i];
  let best: number | null = null;
  let bestD = Infinity;
  for (let dr = -radiusCells; dr <= radiusCells; dr++) {
    const r = r0 + dr;
    if (r < 0 || r >= n) continue;
    for (let dc = -radiusCells; dc <= radiusCells; dc++) {
      const c = c0 + dc;
      if (c < 0 || c >= n) continue;
      const d = dr * dr + dc * dc;
      if (d > radiusCells * radiusCells || d >= bestD) continue;
      const i = r * n + c;
      if (safe(i)) {
        best = i;
        bestD = d;
      }
    }
  }
  return best;
}
