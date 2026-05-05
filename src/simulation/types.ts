export const CellState = {
  Unburned: 0,
  Burning: 1,
  Burned: 2,
  Suppressed: 3,
} as const;
export type CellState = (typeof CellState)[keyof typeof CellState];

export const FuelType = {
  Grass: "grass",
  Shrub: "shrub",
  Forest: "forest",
  Water: "water",
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
  recentPrecip3Day?: number; // mm of rain in last 3 days
  landCoverCode?: number;    // numeric land-cover code (preset per scenario)
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
  [FuelType.Grass]: { ignitionRate: 0.55, burnDuration: 20, spreadRate: 0.65 },
  [FuelType.Shrub]: { ignitionRate: 0.35, burnDuration: 40, spreadRate: 0.50 },
  [FuelType.Forest]: { ignitionRate: 0.20, burnDuration: 80, spreadRate: 0.35 },
  [FuelType.Water]: { ignitionRate: 0, burnDuration: 0, spreadRate: 0 },
};

export const ResourceType = {
  Type1Crew: "Type1Crew",
  Type2Crew: "Type2Crew",
  Engine: "Engine",
  Type1Dozer: "Type1Dozer",
  Helitack: "Helitack",
  AirTanker: "AirTanker",
} as const;
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];

export interface ResourceCount {
  type: ResourceType;
  count: number;
}

export interface SuppressionConfig {
  /** Minutes from ignition until first resources arrive on scene. */
  responseDelayMin: number;
  /** Resource roster — e.g. [{type:"Type1Crew",count:3},...] */
  resources: ResourceCount[];
}

/**
 * NWCG fireline production rates and cost. Sources:
 *  - NWCG Standards for Interagency Incident Business Management
 *  - Reed & McCool (2000), Hirsch & Martell (1996)
 *
 * 1 chain = 20.117 m. Aerial ROS reduction applies to the drop swath only.
 */
export const RESOURCE_RATES: Record<
  ResourceType,
  {
    chainsPerHour: number;       // direct line construction
    rosReductionFactor?: number; // multiplier on R0 in the drop swath
    swathChains?: number;        // length of an aerial swath
    dropsPerHour?: number;       // for tankers
    retardantLineChains?: number;
    costPerHour: number;
    label: string;
  }
> = {
  [ResourceType.Type1Crew]:  { chainsPerHour: 9,  costPerHour: 4_500,  label: "Type 1 Crew" },
  [ResourceType.Type2Crew]:  { chainsPerHour: 6,  costPerHour: 3_000,  label: "Type 2 Crew" },
  [ResourceType.Engine]:     { chainsPerHour: 4,  costPerHour: 2_500,  label: "Engine" },
  [ResourceType.Type1Dozer]: { chainsPerHour: 75, costPerHour: 5_000,  label: "Type 1 Dozer" },
  [ResourceType.Helitack]:   { chainsPerHour: 0,  rosReductionFactor: 0.4, swathChains: 8, costPerHour: 15_000, label: "Helitack" },
  [ResourceType.AirTanker]:  { chainsPerHour: 0,  retardantLineChains: 50, dropsPerHour: 2, costPerHour: 35_000, label: "Air Tanker" },
};

export const SUPPRESSION_BUNDLES: Record<string, ResourceCount[]> = {
  none: [],
  initialAttack: [
    { type: ResourceType.Type2Crew, count: 1 },
    { type: ResourceType.Engine, count: 1 },
    { type: ResourceType.Helitack, count: 1 },
  ],
  type3: [
    { type: ResourceType.Type2Crew, count: 3 },
    { type: ResourceType.Engine, count: 2 },
    { type: ResourceType.Helitack, count: 2 },
  ],
  type2: [
    { type: ResourceType.Type1Crew, count: 5 },
    { type: ResourceType.Type1Dozer, count: 3 },
    { type: ResourceType.Helitack, count: 2 },
    { type: ResourceType.AirTanker, count: 1 },
  ],
  type1: [
    { type: ResourceType.Type1Crew, count: 10 },
    { type: ResourceType.Type1Dozer, count: 5 },
    { type: ResourceType.Helitack, count: 3 },
    { type: ResourceType.AirTanker, count: 2 },
  ],
};

export const CHAINS_TO_METERS = 20.117;

export const DEFAULT_CONFIG: SimulationConfig = {
  gridSize: 600,
  cellSizeMeters: 50,
  windSpeed: 20,
  windDirection: 270,
  humidity: 30,
  defaultFuel: FuelType.Grass,
  timestepMinutes: 15,
  recentPrecip3Day: 0,
  landCoverCode: 126, // 'open_forest_unknown' — neutral default
};

export interface SuppressionStepDiag {
  step: number;
  cumulativeLineMeters: number;
  activePerimeterMeters: number;
  containmentProbability: number; // 0..1
  resourcesActive: number;        // 0 before delay, total count after
  newFirelineCells: number;
}

export interface SuppressionResult {
  history: SimulationState[];
  diags: SuppressionStepDiag[];
}

export interface DualSimulationResult {
  config: SimulationConfig;
  baseline: SimulationState[];
  suppressed?: SuppressionResult;
}
