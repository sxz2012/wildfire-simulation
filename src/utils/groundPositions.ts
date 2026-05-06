import { CellState } from "../simulation/types";
import type { SimulationConfig, SimulationState } from "../simulation/types";

export interface LatLng {
  lat: number;
  lng: number;
}

export function groundPositions(
  prev: SimulationState | null,
  curr: SimulationState,
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
  count: number,
  lastFramePositions: LatLng[],
): LatLng[] {
  if (count === 0) return [];

  if (prev === null) {
    return lastFramePositions.length === 0 ? [] : lastFramePositions;
  }

  const flipped: number[] = [];
  const prevGrid = prev.grid;
  const currGrid = curr.grid;
  const len = currGrid.length;
  for (let i = 0; i < len; i++) {
    if (prevGrid[i] === CellState.Burning && currGrid[i] === CellState.Suppressed) {
      flipped.push(i);
    }
  }

  if (flipped.length === 0) {
    return lastFramePositions.length === 0 ? [] : lastFramePositions;
  }

  const sampleCount = Math.min(count, flipped.length);
  const stride = flipped.length / sampleCount;
  const { gridSize, cellSizeMeters } = config;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const cellLat = cellSizeMeters / metersPerDegLat;
  const cellLng = cellSizeMeters / metersPerDegLng;
  const half = gridSize / 2;

  const result: LatLng[] = [];
  for (let k = 0; k < sampleCount; k++) {
    const idx = flipped[Math.floor(k * stride)];
    const row = Math.floor(idx / gridSize);
    const col = idx - row * gridSize;
    result.push({
      lat: centerLat + (row - half) * cellLat,
      lng: centerLng + (col - half) * cellLng,
    });
  }
  return result;
}
