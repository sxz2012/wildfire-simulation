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
 * Compute the bounding-box stats over all currently-burning cells. Call
 * ONCE per step (before iterating cells), not per candidate cell.
 */
export function computeStepAggregates(
  grid: GridCell[],
  cellSizeMeters: number,
): StepAggregates {
  let count = 0;
  let latMin = Infinity, latMax = -Infinity;
  let lngMin = Infinity, lngMax = -Infinity;
  for (const c of grid) {
    if (c.state !== CellState.Burning) continue;
    count++;
    if (c.lat < latMin) latMin = c.lat;
    if (c.lat > latMax) latMax = c.lat;
    if (c.lng < lngMin) lngMin = c.lng;
    if (c.lng > lngMax) lngMax = c.lng;
  }
  if (count === 0) {
    return { currHotspotCount: 0, currAreaKm2: 0, currExtentNsKm: 0, currExtentEwKm: 0 };
  }

  const ns = (latMax - latMin) * 111;
  const midLat = ((latMax + latMin) / 2) * Math.PI / 180;
  const ew = (lngMax - lngMin) * 111 * Math.cos(midLat);

  // Approximate burning-cell area as count × cell area, in km².
  const cellAreaKm2 = (cellSizeMeters / 1000) ** 2;
  const currAreaKm2 = count * cellAreaKm2;

  return {
    currHotspotCount: count,
    currAreaKm2,
    currExtentNsKm: ns,
    currExtentEwKm: ew,
  };
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

/** Count burning neighbors within radius */
function countBurningNeighbors(
  grid: GridCell[], row: number, col: number, gridSize: number, radius: number
): number {
  let count = 0;
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;
      if (grid[nr * gridSize + nc].state === CellState.Burning) count++;
    }
  }
  return count;
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
  const { gridSize, windSpeed, windDirection, humidity, cellSizeMeters, timestepMinutes } = config;
  const newGrid: GridCell[] = grid.map((cell) => ({ ...cell }));
  const windStrength = Math.min(windSpeed / 40, 1.0);

  // Compute scenario- and step-static features once per step (not per cell).
  const scenarioFeatures = (config as any)._scenarioFeatures as ScenarioFeatures | undefined
    ?? computeScenarioFeatures(grid.map(c => c.fuel));
  const stepAgg = computeStepAggregates(grid, cellSizeMeters);
  const hoursElapsed = stepNumber * timestepMinutes / 60;
  const isDaytime = (hoursElapsed % 24) >= 6 && (hoursElapsed % 24) <= 18 ? 1 : 0;
  const recentPrecip3Day = (config as any).recentPrecip3Day ?? 0;
  const landCoverCode = (config as any).landCoverCode ?? 126;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      const cell = grid[idx];

      if (cell.state === CellState.Burning) {
        newGrid[idx].burnTimer = cell.burnTimer - 1;
        if (newGrid[idx].burnTimer <= 0) {
          newGrid[idx].state = CellState.Burned;
        }
      }

      if (cell.state === CellState.Burning) {
        for (const [dr, dc] of NEIGHBOR_OFFSETS) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;

          const nIdx = nr * gridSize + nc;
          const neighbor = grid[nIdx];
          if (neighbor.state !== CellState.Unburned) continue;
          if (newGrid[nIdx].state === CellState.Burning) continue;

          let rate: number;

          if (useML) {
            // ML model prediction
            const n1km = countBurningNeighbors(grid, nr, nc, gridSize, 2);
            const n5km = countBurningNeighbors(grid, nr, nc, gridSize, 5);
            const n10km = countBurningNeighbors(grid, nr, nc, gridSize, 10);

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
            const wAlign = windAlignmentFactor(dr, dc, windDirection);
            const directionModifier = windStrength > 0.1
              ? 0.3 + 0.7 * Math.max(0, (wAlign + 1) / 2)  // 0.3 upwind, 1.0 downwind
              : 1.0;

            rate = mlProb * directionModifier * 0.25; // Scale for per-step probability
          } else {
            // Fallback: Rothermel-based
            const elevDiff = neighbor.elevation - cell.elevation;
            const dist = Math.sqrt(dr * dr + dc * dc) * cellSizeMeters;
            const slopeAngle = (Math.atan2(elevDiff, dist) * 180) / Math.PI;
            const wAlign = windAlignmentFactor(dr, dc, windDirection);

            rate = computeSpreadRate({
              slopeAngle,
              windAlignment: wAlign,
              windStrength,
              humidity,
              fuel: neighbor.fuel,
            });
          }

          if (Math.random() < rate) {
            newGrid[nIdx].state = CellState.Burning;
            newGrid[nIdx].burnTimer = FUEL_PROPERTIES[neighbor.fuel].burnDuration;
          }
        }
      }
    }
  }

  return newGrid;
}
