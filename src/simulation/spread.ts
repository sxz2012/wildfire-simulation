import {
  CellState,
  FUEL_PROPERTIES,
  type FuelType,
  type GridCell,
  type SimulationConfig,
} from "./types";
import { predictSpreadProbability, encodeFuelType } from "./mlModel";

export interface ScenarioFeatures {
  pctForest: number;
  pctShrub: number;
  pctGrass: number;
  pctUrban: number;
  dominantFuelEnc: number;
}

/**
 * Compute land-cover percentages and dominant fuel from the full fuel map.
 * Constant for the duration of a simulation — call once at sim start.
 *
 * Accepts the broader set of fuel-name strings (`"forest" | "shrub" | "grass"
 * | "urban" | "none"`), since some upstream data sources include urban/none
 * categories that aren't part of the simulation's `FuelType` union.
 */
export function computeScenarioFeatures(
  fuelMap: ReadonlyArray<FuelType | "urban" | "none" | string>
): ScenarioFeatures {
  let f = 0, s = 0, g = 0, u = 0, n = 0;
  for (const fuel of fuelMap) {
    if (fuel === "forest") f++;
    else if (fuel === "shrub") s++;
    else if (fuel === "grass") g++;
    else if (fuel === "urban") u++;
    else n++; // 'none' or any other label
  }
  const total = fuelMap.length || 1;
  const pctForest = f / total;
  const pctShrub = s / total;
  const pctGrass = g / total;
  const pctUrban = u / total;

  // dominant_fuel = argmax. Must match FUEL_ENCODING (forest=0, grass=1,
  // none=2, shrub=3, urban=4).
  const counts: [string, number][] = [
    ["forest", f], ["grass", g], ["none", n], ["shrub", s], ["urban", u],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const dominantFuelEnc = encodeFuelType(counts[0][0]);

  return { pctForest, pctShrub, pctGrass, pctUrban, dominantFuelEnc };
}

export interface StepAggregates {
  currHotspotCount: number;
  currAreaKm2: number;
  currExtentNsKm: number;
  currExtentEwKm: number;
}

/**
 * The model was trained on VIIRS satellite detections, not on simulator cells:
 * a detection is a 375 m pixel with fire, seen about 1.2 times a day (median in
 * the training data). Inputs that count fire are read off the grid that way.
 */
export const SATELLITE_PIXEL_M = 375;
export const DETECTIONS_PER_PIXEL_DAY = 1.2;

/** The fire as the satellite would see it this step: its size, and detections near any spot. */
export interface SatelliteView {
  aggregates: StepAggregates;
  /** Detections within 1, 5 and 10 km of the cell, leaving out its own pixel's (training left out the detection itself). */
  neighbors(row: number, col: number): [number, number, number];
}

const NEIGHBOR_RADII_M = [1000, 5000, 10000];

/** Satellite-style view of the burning cells: one detection pixel per 375 m square with any burning cell. Call once per step. */
export function satelliteView(grid: GridCell[], gridSize: number, cellSizeMeters: number): SatelliteView {
  const px = (i: number) => Math.floor((i * cellSizeMeters) / SATELLITE_PIXEL_M);
  const pixelsPerSide = px(gridSize - 1) + 1;
  const active = new Uint8Array(pixelsPerSide * pixelsPerSide);
  let latMin = Infinity, latMax = -Infinity, lngMin = Infinity, lngMax = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    const c = grid[i];
    if (c.state !== CellState.Burning) continue;
    active[px(Math.floor(i / gridSize)) * pixelsPerSide + px(i % gridSize)] = 1;
    if (c.lat < latMin) latMin = c.lat;
    if (c.lat > latMax) latMax = c.lat;
    if (c.lng < lngMin) lngMin = c.lng;
    if (c.lng > lngMax) lngMax = c.lng;
  }
  // Pixel centres in metres from the grid corner.
  const centres: Array<[number, number]> = [];
  for (let p = 0; p < active.length; p++) {
    if (active[p]) centres.push([(Math.floor(p / pixelsPerSide) + 0.5) * SATELLITE_PIXEL_M, ((p % pixelsPerSide) + 0.5) * SATELLITE_PIXEL_M]);
  }
  const detections = (pixels: number) => Math.round(pixels * DETECTIONS_PER_PIXEL_DAY);

  let aggregates: StepAggregates = { currHotspotCount: 0, currAreaKm2: 0, currExtentNsKm: 0, currExtentEwKm: 0 };
  if (centres.length > 0) {
    const ns = (latMax - latMin) * 111;
    const ew = (lngMax - lngMin) * 111 * Math.cos(((latMax + latMin) / 2) * Math.PI / 180);
    // Training: hotspot count of the day, and the bounding box of its detections.
    aggregates = { currHotspotCount: detections(centres.length), currAreaKm2: ns * ew, currExtentNsKm: ns, currExtentEwKm: ew };
  }

  // Counts depend only on the cell's pixel and position; cached per cell for this step.
  const cache = new Map<number, [number, number, number]>();
  return {
    aggregates,
    neighbors(row, col) {
      const key = row * gridSize + col;
      const hit = cache.get(key);
      if (hit) return hit;
      const y = (row + 0.5) * cellSizeMeters, x = (col + 0.5) * cellSizeMeters;
      const own = active[px(row) * pixelsPerSide + px(col)] === 1;
      const within = [0, 0, 0];
      for (const [cy, cx] of centres) {
        const d = Math.hypot(cy - y, cx - x);
        for (let k = 0; k < 3; k++) if (d <= NEIGHBOR_RADII_M[k]) within[k]++;
      }
      const out = within.map((w) => Math.max(0, detections(w) - (own ? 1 : 0))) as [number, number, number];
      cache.set(key, out);
      return out;
    },
  };
}

/** The fire's size as the satellite would see it (see satelliteView). */
export function computeStepAggregates(grid: GridCell[], cellSizeMeters: number, gridSize = Math.round(Math.sqrt(grid.length))): StepAggregates {
  return satelliteView(grid, gridSize, cellSizeMeters).aggregates;
}

export interface SpreadParams {
  slopeAngle: number;
  windAlignment: number;
  windStrength?: number;
  humidity: number;
  fuel: (typeof import("./types").FuelType)[keyof typeof import("./types").FuelType];
}

/**
 * Fallback spread rate calculation (used if ML model not loaded).
 */
export function computeSpreadRate(params: SpreadParams): number {
  const { slopeAngle, windAlignment, windStrength = 0.5, humidity, fuel } = params;
  const fuelProps = FUEL_PROPERTIES[fuel];
  const R0 = fuelProps.spreadRate * 0.35;
  const phiSlope = Math.max(-0.3, Math.min(0.6, slopeAngle * 0.02));
  let windFactor: number;
  if (windStrength < 0.1) {
    windFactor = 0;
  } else {
    windFactor = windAlignment * windStrength * (windAlignment < 0 ? 1.5 : 3.0);
  }
  const humidityFactor = Math.max(0.02, Math.exp(-humidity / 40));
  const rate = R0 * (1 + windFactor + phiSlope) * humidityFactor * fuelProps.ignitionRate;
  return Math.max(0, Math.min(0.6, rate));
}

function windAlignmentFactor(
  dRow: number, dCol: number, windDirection: number
): number {
  const windRad = ((windDirection + 180) * Math.PI) / 180;
  const windDr = -Math.cos(windRad);
  const windDc = Math.sin(windRad);
  const len = Math.sqrt(dRow * dRow + dCol * dCol);
  if (len === 0) return 0;
  return (dRow * windDr + dCol * windDc) / len;
}

const NEIGHBOR_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/** One chance for a burning cell to ignite an unburned neighbour, with what a learned correction can use. */
export interface SpreadAttempt {
  /** Neighbour being ignited. */
  cell: number;
  /** Chance from the model for this 15-min step (before spreadScale and correction). */
  rate: number;
  /** Wind alignment of the spread direction: +1 downwind, −1 upwind. */
  align: number;
  /** Rise over run from the burning cell to the neighbour (clamped to ±1). */
  slope: number;
  fuel: FuelType;
  /** Spread direction as unit north / east components. */
  north: number;
  east: number;
}

/**
 * Weights of a per-fire correction learned from observed spread, applied on the
 * logit scale: logit(p) = (1 + w[7])·logit(p0) + w[0] + w[1]·align + w[2]·slope
 * + w[3]·shrub + w[4]·forest + w[5]·north + w[6]·east. All zeros = no change.
 */
export type SpreadCorrection = number[];
export const CORRECTION_SIZE = 8;

const logit = (p: number) => Math.log(p / (1 - p));

/** Correction inputs of an attempt, in weight order (w[0..6]); w[7] scales the model's own logit. */
export function correctionInputs(a: SpreadAttempt): number[] {
  return [1, a.align, a.slope, a.fuel === "shrub" ? 1 : 0, a.fuel === "forest" ? 1 : 0, a.north, a.east];
}

/** The attempt's chance after a learned correction. */
export function correctedRate(p0: number, a: SpreadAttempt, w: SpreadCorrection): number {
  const p = Math.min(Math.max(p0, 1e-6), 1 - 1e-6);
  const x = correctionInputs(a);
  let z = (1 + w[7]) * logit(p);
  for (let i = 0; i < x.length; i++) z += w[i] * x[i];
  return 1 / (1 + Math.exp(-z));
}

/**
 * Visit every spread attempt of one step: each burning cell × each unburned,
 * non-water neighbour, with the model's chance for it. `skip` lets the caller
 * drop neighbours (e.g. already ignited this step) before the model runs.
 */
export function forEachSpreadAttempt(
  grid: GridCell[],
  config: SimulationConfig,
  stepNumber: number,
  useML: boolean,
  visit: (a: SpreadAttempt) => void,
  skip?: (cell: number) => boolean
): void {
  const { gridSize, windSpeed, windDirection, humidity, cellSizeMeters, timestepMinutes } = config;
  const windStrength = Math.min(windSpeed / 40, 1.0);

  // Compute scenario- and step-static features once per step (not per cell).
  const scenarioFeatures = (config as any)._scenarioFeatures as ScenarioFeatures | undefined
    ?? computeScenarioFeatures(grid.map(c => c.fuel));
  const satellite = satelliteView(grid, gridSize, cellSizeMeters);
  const stepAgg = satellite.aggregates;
  const hoursElapsed = stepNumber * timestepMinutes / 60;
  const isDaytime = (hoursElapsed % 24) >= 6 && (hoursElapsed % 24) <= 18 ? 1 : 0;
  const recentPrecip3Day = (config as any).recentPrecip3Day ?? 0;
  const landCoverCode = (config as any).landCoverCode ?? 126;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const cell = grid[row * gridSize + col];
      if (cell.state !== CellState.Burning) continue;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;

        const nIdx = nr * gridSize + nc;
        const neighbor = grid[nIdx];
        if (neighbor.state !== CellState.Unburned) continue;
        if (skip?.(nIdx)) continue;
        if (neighbor.fuel === "water") continue;

        const wAlign = windAlignmentFactor(dr, dc, windDirection);
        const len = Math.sqrt(dr * dr + dc * dc);
        const rise = (neighbor.elevation - cell.elevation) / (len * cellSizeMeters);
        let rate: number;

        if (useML) {
          // ML model prediction
          const [n1km, n5km, n10km] = satellite.neighbors(nr, nc);

          const features = [
            hoursElapsed,                    // 0  hours_since_start
            neighbor.lat,                    // 1  latitude
            neighbor.lng,                    // 2  longitude
            isDaytime,                       // 3  is_daytime
            encodeFuelType(neighbor.fuel),   // 4  fuel_type_enc
            (config as any).tempMean ?? 25,  // 5  temp_mean_c
            (config as any).tempMax ?? 35,   // 6  temp_max_c
            humidity,                        // 7  humidity_pct
            windSpeed,                       // 8  wind_speed_kmh
            windDirection,                   // 9  wind_direction_deg
            (config as any).precipitation ?? 0,      // 10 precipitation_mm
            (config as any).cumulativePrecip ?? 0,   // 11 cumulative_precip_mm
            n1km,                            // 12 neighbors_1km
            n5km,                            // 13 neighbors_5km
            n10km,                           // 14 neighbors_10km
            neighbor.elevation,              // 15 elevation_m
            scenarioFeatures.pctForest,      // 16 pct_forest
            scenarioFeatures.pctShrub,       // 17 pct_shrub
            scenarioFeatures.pctGrass,       // 18 pct_grass
            scenarioFeatures.pctUrban,       // 19 pct_urban
            scenarioFeatures.dominantFuelEnc, // 20 dominant_fuel_enc
            landCoverCode,                   // 21 land_cover_code
            stepAgg.currHotspotCount,        // 22 curr_hotspot_count
            stepAgg.currAreaKm2,             // 23 curr_area_km2
            stepAgg.currExtentNsKm,          // 24 curr_extent_ns_km
            stepAgg.currExtentEwKm,          // 25 curr_extent_ew_km
            recentPrecip3Day,                // 26 recent_precip_3day_mm
          ];

          const mlProb = predictSpreadProbability(features);

          // Apply directional wind modifier (ML model knows wind speed but not
          // the direction relative to this specific neighbor)
          const directionModifier = windStrength > 0.1
            ? 0.3 + 0.7 * Math.max(0, (wAlign + 1) / 2)  // 0.3 upwind, 1.0 downwind
            : 1.0;

          rate = mlProb * directionModifier * 0.25; // Scale for per-step probability
        } else {
          // Fallback: Rothermel-based
          const slopeAngle = (Math.atan(rise) * 180) / Math.PI;
          rate = computeSpreadRate({
            slopeAngle,
            windAlignment: wAlign,
            windStrength,
            humidity,
            fuel: neighbor.fuel,
          });
        }

        visit({
          cell: nIdx, rate, align: wAlign, slope: Math.max(-1, Math.min(1, rise)), fuel: neighbor.fuel,
          north: -dr / len, east: dc / len,
        });
      }
    }
  }
}

/**
 * ML-enhanced simulation step.
 * Uses XGBoost model to predict spread probability when available,
 * falls back to Rothermel-based calculation otherwise.
 */
export function simulateStep(
  grid: GridCell[],
  config: SimulationConfig,
  stepNumber = 0,
  useML = true
): GridCell[] {
  const newGrid: GridCell[] = grid.map((cell) => ({ ...cell }));
  const spreadScale = config.spreadScale ?? 1;
  const correction = config.spreadCorrection;

  // Burning cells burn down; suppressed cells (firelines) are permanent firebreaks.
  for (let idx = 0; idx < grid.length; idx++) {
    if (grid[idx].state !== CellState.Burning) continue;
    newGrid[idx].burnTimer = grid[idx].burnTimer - 1;
    if (newGrid[idx].burnTimer <= 0) newGrid[idx].state = CellState.Burned;
  }

  forEachSpreadAttempt(grid, config, stepNumber, useML, (a) => {
    const p = correction ? correctedRate(a.rate * spreadScale, a, correction) : a.rate * spreadScale;
    if (Math.random() < p) {
      newGrid[a.cell].state = CellState.Burning;
      newGrid[a.cell].burnTimer = FUEL_PROPERTIES[grid[a.cell].fuel].burnDuration;
    }
  }, (cell) => newGrid[cell].state === CellState.Burning);

  return newGrid;
}
