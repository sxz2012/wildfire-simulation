export const CellState = {
  Unburned: 0,
  Burning: 1,
  Burned: 2,
} as const;
export type CellState = (typeof CellState)[keyof typeof CellState];

export const FuelType = {
  Grass: "grass",
  Shrub: "shrub",
  Forest: "forest",
} as const;
export type FuelType = (typeof FuelType)[keyof typeof FuelType];

export interface GridCell {
  state: CellState;
  fuel: FuelType;
  elevation: number; // meters
  burnTimer: number; // timesteps remaining before burned out
  lat: number;
  lng: number;
}

export interface SimulationConfig {
  gridSize: number;
  cellSizeMeters: number;
  windSpeed: number; // km/h (0-60)
  windDirection: number; // degrees (0-360, 0=north)
  humidity: number; // 0-100
  defaultFuel: FuelType;
  timestepMinutes: number;
}

export interface SimulationState {
  grid: Uint8Array;
  timestep: number;
}

export interface SimulationResult {
  history: SimulationState[];
  config: SimulationConfig;
}

/**
 * Fuel properties calibrated against real NASA FIRMS fire data.
 *
 * Real-world spread rates observed:
 *   Grass (Marshall Fire, Maui): 11-14 km/day — fast ignition, fast burnout
 *   Shrub (Woolsey, Greece):      5-7 km/day — moderate spread
 *   Forest (Caldor, Thomas):      1-3 km/day — slow ignition, long burn
 *
 * With 50m cells and 15-min timesteps (96 steps/day):
 *   - 5 km/day ≈ 100 cells/day ≈ ~1 cell/step
 *   - spreadRate * ignitionRate should produce ~0.15-0.4 probability per step
 */
export const FUEL_PROPERTIES: Record<
  FuelType,
  { ignitionRate: number; burnDuration: number; spreadRate: number }
> = {
  [FuelType.Grass]: { ignitionRate: 0.55, burnDuration: 4, spreadRate: 0.65 },
  [FuelType.Shrub]: { ignitionRate: 0.35, burnDuration: 8, spreadRate: 0.50 },
  [FuelType.Forest]: { ignitionRate: 0.20, burnDuration: 16, spreadRate: 0.35 },
};

export const DEFAULT_CONFIG: SimulationConfig = {
  gridSize: 100,
  cellSizeMeters: 50,
  windSpeed: 20,
  windDirection: 270,
  humidity: 30,
  defaultFuel: FuelType.Grass,
  timestepMinutes: 15,
};
