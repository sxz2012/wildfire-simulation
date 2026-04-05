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
 * Predict fire persistence probability for a single point.
 *
 * Features array must match the model's feature order:
 * [hours_since_start, latitude, longitude, frp_mw, brightness_k,
 *  confidence, is_daytime, fuel_type_enc, temp_mean_c, temp_max_c,
 *  humidity_pct, wind_speed_kmh, wind_direction_deg, precipitation_mm,
 *  cumulative_precip_mm, neighbors_1km, neighbors_5km, neighbors_10km]
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
