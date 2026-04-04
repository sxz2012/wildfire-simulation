import {
  CellState,
  FuelType,
  FUEL_PROPERTIES,
  type GridCell,
  type SimulationConfig,
} from "./types";

/**
 * Simple hash-based noise for procedural vegetation.
 * Returns 0-1 based on lat/lng inputs.
 */
function noise2d(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Multi-octave noise for more natural-looking vegetation patches.
 */
function fractalNoise(lat: number, lng: number, scale: number): number {
  let value = 0;
  let amplitude = 1;
  let totalAmp = 0;
  for (let octave = 0; octave < 3; octave++) {
    const s = scale * Math.pow(2, octave);
    value += noise2d(lat * s, lng * s) * amplitude;
    totalAmp += amplitude;
    amplitude *= 0.5;
  }
  return value / totalAmp;
}

/**
 * Assign vegetation type based on procedural noise.
 * Creates natural-looking patches of different fuel types.
 */
function assignFuel(lat: number, lng: number): FuelType {
  const n = fractalNoise(lat, lng, 50);
  if (n < 0.35) return FuelType.Grass;
  if (n < 0.7) return FuelType.Shrub;
  return FuelType.Forest;
}

export function createGrid(
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
  elevationFn: (lat: number, lng: number) => number,
  /** Optional pre-computed fuel types from satellite imagery sampling */
  fuelMap?: FuelType[]
): GridCell[] {
  const { gridSize, cellSizeMeters } = config;
  const grid: GridCell[] = new Array(gridSize * gridSize);

  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

  const halfGrid = gridSize / 2;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const offsetRow = row - halfGrid;
      const offsetCol = col - halfGrid;
      const idx = row * gridSize + col;

      const lat = centerLat + (offsetRow * cellSizeMeters) / metersPerDegreeLat;
      const lng =
        centerLng + (offsetCol * cellSizeMeters) / metersPerDegreeLng;

      const fuel = fuelMap ? fuelMap[idx] : assignFuel(lat, lng);

      grid[idx] = {
        state: CellState.Unburned,
        fuel,
        elevation: elevationFn(lat, lng),
        burnTimer: 0,
        lat,
        lng,
      };
    }
  }

  return grid;
}

export function getCell(
  grid: GridCell[],
  row: number,
  col: number,
  gridSize: number
): GridCell {
  return grid[row * gridSize + col];
}

export function igniteCell(
  grid: GridCell[],
  row: number,
  col: number,
  gridSize: number
): void {
  const cell = grid[row * gridSize + col];
  cell.state = CellState.Burning;
  cell.burnTimer = FUEL_PROPERTIES[cell.fuel].burnDuration;
}
