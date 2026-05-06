/**
 * Generate a precomputed simulation scenario.
 *
 * Runs the same `runSimulation` engine that the browser worker uses,
 * but headless. Produces a compact RLE-compressed JSON that the UI
 * can load instantly (avoiding the long live-simulation wait).
 *
 * Usage:
 *   npx tsx scripts/generate_scenario.ts
 *
 * For now this generates a single hard-coded scenario (Cupertino WUI).
 * Add more by adding entries to the SCENARIOS array.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runSimulation } from "../src/simulation/runner.ts";
import { loadModel } from "../src/simulation/mlModel.ts";
import { DEFAULT_CONFIG, SUPPRESSION_BUNDLES, type FuelType, type SimulationConfig, type SuppressionConfig } from "../src/simulation/types.ts";
import { findMaxDelay, findMinTier } from "../src/simulation/inverseSearch.ts";
import { rleEncode } from "../src/utils/rle.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

interface ScenarioSpec {
  id: string;
  name: string;
  description: string;
  location: { lat: number; lng: number };
  weather: { tempMean: number; tempMax: number; humidity: number; windSpeed: number; windDirection: number; precipitation: number; cumulativePrecip: number };
  suppression: SuppressionConfig;
  maxSteps: number;
  thresholdAreaHa: number;
  defaultBundleKey: "initialAttack" | "type3" | "type2" | "type1";
  defaultDelayMin: number;
}

const SCENARIOS: ScenarioSpec[] = [
  {
    id: "cupertino-wui",
    name: "Cupertino Wildland-Urban Interface",
    description: "Westerly wind pushes a fire from the Santa Cruz foothills toward suburban Cupertino. Demonstrates how Initial Attack performs in a mixed forest+urban landscape.",
    location: { lat: 37.30, lng: -122.10 },
    weather: {
      tempMean: 28,
      tempMax: 36,
      humidity: 25,
      windSpeed: 25,
      windDirection: 270,
      precipitation: 0,
      cumulativePrecip: 0,
    },
    suppression: {
      responseDelayMin: 30,
      resources: [
        { type: "Type2Crew" as const, count: 1 },
        { type: "Engine" as const, count: 1 },
        { type: "Helitack" as const, count: 1 },
      ],
    },
    maxSteps: 200,
    thresholdAreaHa: 500,
    defaultBundleKey: "initialAttack",
    defaultDelayMin: 30,
  },
];

/**
 * Build a procedural fuel map without Cesium / WorldCover. Uses a
 * deterministic noise function so scenarios are reproducible. Fuel
 * type is determined by lat/lng + noise — yields reasonable mixes
 * of forest/shrub/grass for visualization.
 */
function buildFuelMap(centerLat: number, centerLng: number, gridSize: number, cellSizeMeters: number): FuelType[] {
  const fuelMap: FuelType[] = new Array(gridSize * gridSize).fill("forest");
  const halfGrid = gridSize / 2;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      const lat = centerLat + ((row - halfGrid) * cellSizeMeters) / metersPerDegreeLat;
      const lng = centerLng + ((col - halfGrid) * cellSizeMeters) / metersPerDegreeLng;
      // Deterministic noise from lat/lng.
      const n = Math.abs(Math.sin(lat * 127.1 + lng * 311.7) * 43758.5453);
      const v = n - Math.floor(n);
      // Bias the mix: 60% forest, 25% shrub, 15% grass — typical for the
      // Santa Cruz foothills west of Cupertino.
      if (v < 0.15) fuelMap[idx] = "grass";
      else if (v < 0.40) fuelMap[idx] = "shrub";
      else fuelMap[idx] = "forest";
    }
  }
  return fuelMap;
}

/**
 * Build a synthetic elevation map: gradient + low-frequency noise.
 * Real Cesium terrain is browser-only; this is a reasonable stand-in
 * for the slope-aware spread model. Heights ~0–800 m.
 */
function buildElevationMap(centerLat: number, centerLng: number, gridSize: number, cellSizeMeters: number): Float32Array {
  const elevations = new Float32Array(gridSize * gridSize);
  const halfGrid = gridSize / 2;
  void centerLat;
  void centerLng;
  void cellSizeMeters;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      // Linear gradient: lower in the east (toward city), higher in west (toward hills).
      const eastWestNorm = (col - halfGrid) / halfGrid; // -1..1, west = -1
      const baseElev = 200 - eastWestNorm * 400;        // 600 m west, 200 m center, ~-200 m east → clamp
      // Low-frequency noise for terrain texture.
      const n = Math.sin(row * 0.05) * 30 + Math.cos(col * 0.05) * 30;
      elevations[idx] = Math.max(0, baseElev + n);
    }
  }
  return elevations;
}

async function generate(spec: ScenarioSpec): Promise<void> {
  console.log(`\n=== Generating ${spec.id} ===`);
  console.log(`Location: ${spec.location.lat}, ${spec.location.lng}`);

  const config: SimulationConfig = {
    ...DEFAULT_CONFIG,
    windSpeed: spec.weather.windSpeed,
    windDirection: spec.weather.windDirection,
    humidity: spec.weather.humidity,
  };

  // Attach the same enriched-config fields the worker injects.
  const enriched = {
    ...config,
    tempMean: spec.weather.tempMean,
    tempMax: spec.weather.tempMax,
    precipitation: spec.weather.precipitation,
    cumulativePrecip: spec.weather.cumulativePrecip,
  };

  const fuelMap = buildFuelMap(spec.location.lat, spec.location.lng, config.gridSize, config.cellSizeMeters);
  const elevationMap = buildElevationMap(spec.location.lat, spec.location.lng, config.gridSize, config.cellSizeMeters);
  const center = Math.floor(config.gridSize / 2);

  const t0 = Date.now();
  const result = runSimulation(
    enriched,
    center,
    center,
    () => 0,
    spec.maxSteps,
    spec.location.lat,
    spec.location.lng,
    fuelMap,
    elevationMap,
    spec.suppression,
  );
  const elapsedSec = (Date.now() - t0) / 1000;
  console.log(`  ran in ${elapsedSec.toFixed(1)}s`);
  console.log(`  baseline: ${result.baseline.length} steps`);
  console.log(`  suppressed: ${result.suppressed?.history.length ?? 0} steps`);

  // RLE-encode each grid snapshot.
  const baselineRle = result.baseline.map((s) => rleEncode(s.grid));
  const suppressedRle = result.suppressed?.history.map((s) => rleEncode(s.grid));

  console.log("  running Q1 (max delay for default bundle)...");
  const q1 = await findMaxDelay({
    config: enriched,
    fuelMap,
    elevationMap,
    igniteRow: center,
    igniteCol: center,
    centerLat: spec.location.lat,
    centerLng: spec.location.lng,
    maxSteps: spec.maxSteps,
    thresholdAreaHa: spec.thresholdAreaHa,
    bundle: [...SUPPRESSION_BUNDLES[spec.defaultBundleKey]],
  });
  console.log(`    Q1: maxDelayMin = ${q1.maxDelayMin}`);

  console.log("  running Q2 (min tier for default delay)...");
  const q2 = await findMinTier({
    config: enriched,
    fuelMap,
    elevationMap,
    igniteRow: center,
    igniteCol: center,
    centerLat: spec.location.lat,
    centerLng: spec.location.lng,
    maxSteps: spec.maxSteps,
    thresholdAreaHa: spec.thresholdAreaHa,
    delayMin: spec.defaultDelayMin,
  });
  console.log(`    Q2: minTier = ${q2.minTier}`);

  // Note: justWorks/justFails come from the bisection's last accepted delay
  // boundary; encode their grids as RLE for size.
  const compactQ1 = {
    bundle: spec.defaultBundleKey,
    maxDelayMin: q1.maxDelayMin,
    bisectionTrace: q1.bisectionTrace,
    justWorks: q1.justWorks
      ? {
          delayMin: q1.maxDelayMin ?? 0,
          rleSteps: q1.justWorks.history.map((s) => rleEncode(s.grid)),
          finalAreaHa: q1.justWorks.finalAreaHa,
        }
      : null,
    justFails: q1.justFails
      ? {
          delayMin:
            q1.bisectionTrace.find((t) => !t.passed)?.delayMin ?? 0,
          rleSteps: q1.justFails.history.map((s) => rleEncode(s.grid)),
          finalAreaHa: q1.justFails.finalAreaHa,
        }
      : null,
  };

  const compactQ2 = {
    delayMin: spec.defaultDelayMin,
    minTier: q2.minTier,
    tierTrace: q2.tierTrace,
    minWorking: q2.minWorking
      ? {
          tier: q2.minTier!,
          rleSteps: q2.minWorking.history.map((s) => rleEncode(s.grid)),
          finalAreaHa: q2.minWorking.finalAreaHa,
        }
      : null,
    tierBelow: q2.tierBelow
      ? {
          tier:
            q2.tierTrace.findIndex((t) => t.passed) > 0
              ? q2.tierTrace[q2.tierTrace.findIndex((t) => t.passed) - 1].tier
              : null,
          rleSteps: q2.tierBelow.history.map((s) => rleEncode(s.grid)),
          finalAreaHa: q2.tierBelow.finalAreaHa,
        }
      : null,
  };

  // Output payload.
  const payload = {
    meta: {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      location: spec.location,
      weather: spec.weather,
      suppression: spec.suppression,
      config: {
        gridSize: config.gridSize,
        cellSizeMeters: config.cellSizeMeters,
        timestepMinutes: config.timestepMinutes,
        windSpeed: config.windSpeed,
        windDirection: config.windDirection,
        humidity: config.humidity,
      },
      thresholdAreaHa: spec.thresholdAreaHa,
      generatedAt: new Date().toISOString(),
    },
    fuelMap,
    elevations: Array.from(elevationMap),
    baseline: { rleSteps: baselineRle },
    suppressed: result.suppressed
      ? { rleSteps: suppressedRle, diags: result.suppressed.diags }
      : undefined,
    analysis: { q1: compactQ1, q2: compactQ2 },
  };

  const outDir = path.join(ROOT, "src/data/scenarios");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${spec.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload));
  const sizeMb = fs.statSync(outPath).size / (1024 * 1024);
  console.log(`  wrote ${outPath} (${sizeMb.toFixed(1)} MB)`);
}

async function main(): Promise<void> {
  // Load the ML model so spread.ts gets predictions.
  const modelPath = path.join(ROOT, "src/data/xgboost_model.json");
  const modelJson = JSON.parse(fs.readFileSync(modelPath, "utf-8"));
  loadModel(modelJson);

  for (const spec of SCENARIOS) {
    await generate(spec);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
