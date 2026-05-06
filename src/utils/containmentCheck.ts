import { CellState } from "../simulation/types";
import type { SimulationConfig, SimulationState } from "../simulation/types";
import { pointInPolygon } from "./pointInPolygon";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ContainmentCheckResult {
  ok: boolean;
  burningOutside: number;
  totalBurning: number;
  breachPercent: number;
}

export function containmentCheck(
  state: SimulationState,
  polygon: LatLng[],
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
): ContainmentCheckResult {
  const { gridSize, cellSizeMeters } = config;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const cellLat = cellSizeMeters / metersPerDegLat;
  const cellLng = cellSizeMeters / metersPerDegLng;
  const half = gridSize / 2;

  const grid = state.grid;
  const len = grid.length;
  let totalBurning = 0;
  let burningOutside = 0;

  for (let i = 0; i < len; i++) {
    if (grid[i] !== CellState.Burning) continue;
    totalBurning++;
    const row = Math.floor(i / gridSize);
    const col = i - row * gridSize;
    const lat = centerLat + (row - half) * cellLat;
    const lng = centerLng + (col - half) * cellLng;
    if (!pointInPolygon(lat, lng, polygon)) burningOutside++;
  }

  if (totalBurning === 0) {
    return { ok: true, burningOutside: 0, totalBurning: 0, breachPercent: 0 };
  }

  return {
    ok: burningOutside === 0,
    burningOutside,
    totalBurning,
    breachPercent: burningOutside / totalBurning,
  };
}
