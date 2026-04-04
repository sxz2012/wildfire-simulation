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
  gridSize: number; // cells per side (default 200)
  cellSizeMeters: number; // meters per cell (default 50)
  windSpeed: number; // km/h (0-60)
  windDirection: number; // degrees (0-360, 0=north)
  humidity: number; // 0-100
  defaultFuel: FuelType;
  timestepMinutes: number; // simulated minutes per step
}

export interface SimulationState {
  grid: Uint8Array; // flat array of CellState values (gridSize * gridSize)
  timestep: number;
}

export interface SimulationResult {
  history: SimulationState[];
  config: SimulationConfig;
}

// Fuel properties: how fast it ignites, how long it burns
export const FUEL_PROPERTIES: Record<
  FuelType,
  { ignitionRate: number; burnDuration: number; spreadRate: number }
> = {
  [FuelType.Grass]: { ignitionRate: 0.8, burnDuration: 3, spreadRate: 1.2 },
  [FuelType.Shrub]: { ignitionRate: 0.5, burnDuration: 6, spreadRate: 1.0 },
  [FuelType.Forest]: { ignitionRate: 0.3, burnDuration: 12, spreadRate: 0.7 },
};

export const DEFAULT_CONFIG: SimulationConfig = {
  gridSize: 100,
  cellSizeMeters: 50,
  windSpeed: 20,
  windDirection: 270, // westerly
  humidity: 30,
  defaultFuel: FuelType.Grass,
  timestepMinutes: 15,
};
