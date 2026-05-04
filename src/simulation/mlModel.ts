/**
 * Lightweight XGBoost inference engine for browser/Web Worker.
 * Evaluates exported decision trees to predict fire spread probability.
 */

interface TreeNode {
  f?: number;  // feature index
  t?: number;  // threshold
  y?: TreeNode; // yes (left) branch
  n?: TreeNode; // no (right) branch
  v?: number;  // leaf value
}

interface XGBoostModel {
  features: string[];
  base_score: number;
  trees: TreeNode[];
}

let cachedModel: XGBoostModel | null = null;

/**
 * Load the XGBoost model from JSON.
 * Call this once when the worker starts.
 */
export function loadModel(modelJson: XGBoostModel): void {
  cachedModel = modelJson;
}

/**
 * Evaluate a single tree node.
 */
function evaluateTree(node: TreeNode, features: number[]): number {
  if (node.v !== undefined) return node.v;
  if (node.f === undefined || node.t === undefined) return 0;

  const featureValue = features[node.f] ?? 0;
  if (featureValue < node.t) {
    return evaluateTree(node.y!, features);
  } else {
    return evaluateTree(node.n!, features);
  }
}

/**
 * Sigmoid function to convert log-odds to probability.
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Predict fire spread probability for a single point.
 *
 * Features array must match the v2 model's feature order (see FEATURE_INDEX below):
 * [hours_since_start, latitude, longitude, is_daytime, fuel_type_enc,
 *  temp_mean_c, temp_max_c, humidity_pct, wind_speed_kmh, wind_direction_deg,
 *  precipitation_mm, cumulative_precip_mm, neighbors_1km, neighbors_5km, neighbors_10km,
 *  elevation_m, pct_forest, pct_shrub, pct_grass, pct_urban,
 *  dominant_fuel_enc, land_cover_code, curr_hotspot_count, curr_area_km2,
 *  curr_extent_ns_km, curr_extent_ew_km, recent_precip_3day_mm]
 */
export function predictSpreadProbability(features: number[]): number {
  if (!cachedModel) return 0.5;

  let sum = 0;
  for (const tree of cachedModel.trees) {
    sum += evaluateTree(tree, features);
  }

  return sigmoid(sum);
}

/**
 * Fuel type to numeric encoding (must match training data).
 */
export function encodeFuelType(fuel: string): number {
  switch (fuel) {
    case "forest": return 0;
    case "grass": return 1;
    case "none": return 2;
    case "shrub": return 3;
    case "urban": return 4;
    default: return 3; // shrub as default
  }
}

/**
 * Feature indices for the v2 enriched model. Order MUST match FEATURES in
 * scripts/train_fire_spread_model.py exactly.
 */
export const FEATURE_INDEX = {
  hours_since_start: 0,
  latitude: 1,
  longitude: 2,
  is_daytime: 3,
  fuel_type_enc: 4,
  temp_mean_c: 5,
  temp_max_c: 6,
  humidity_pct: 7,
  wind_speed_kmh: 8,
  wind_direction_deg: 9,
  precipitation_mm: 10,
  cumulative_precip_mm: 11,
  neighbors_1km: 12,
  neighbors_5km: 13,
  neighbors_10km: 14,
  elevation_m: 15,
  pct_forest: 16,
  pct_shrub: 17,
  pct_grass: 18,
  pct_urban: 19,
  dominant_fuel_enc: 20,
  land_cover_code: 21,
  curr_hotspot_count: 22,
  curr_area_km2: 23,
  curr_extent_ns_km: 24,
  curr_extent_ew_km: 25,
  recent_precip_3day_mm: 26,
} as const;

export const FEATURE_COUNT = 27;
