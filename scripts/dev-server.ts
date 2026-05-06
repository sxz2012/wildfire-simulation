/**
 * Local Node API for live what-if queries during demos.
 *
 * Endpoints (all POST, JSON in/out):
 *   /api/simulate   - one suppressed simulation
 *   /api/q1         - findMaxDelay inverse search
 *   /api/q2         - findMinTier inverse search
 *   /api/extend     - resume sim from a paused mid-state grid
 *   /api/q-boundary - findMinRosterForBoundary inverse search
 *
 * Run with `npm run server`. Browser calls localhost:3001.
 */

import express, { type Request, type Response } from "express";
import cors from "cors";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runSimulation, extendSimulation } from "../src/simulation/runner.ts";
import { loadModel } from "../src/simulation/mlModel.ts";
import {
  findMaxDelay,
  findMinTier,
  findMinRosterForBoundary,
  finalAreaHa,
} from "../src/simulation/inverseSearch.ts";
import type { BoundarySearchOverrides } from "../src/simulation/inverseSearch.ts";
import { rleEncode, rleDecode } from "../src/utils/rle.ts";
import type {
  SimulationConfig,
  FuelType,
  SuppressionConfig,
  ResourceCount,
} from "../src/simulation/types.ts";
import type { LatLng } from "../src/utils/containmentCheck.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PORT = 3001;

// Load the ML model once at startup so spread.ts can use it.
const modelJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/xgboost_model.json"), "utf-8"),
);
loadModel(modelJson);

const app = express();
app.use(cors()); // localhost:5173 -> localhost:3001
app.use(express.json({ limit: "100mb" }));

// Common request shape - everything Q1/Q2/single-sim need.
interface SimRequest {
  config: SimulationConfig;
  fuelMap: FuelType[];
  elevationMap?: number[]; // sent as plain array; we'll Float32 it
  igniteRow: number;
  igniteCol: number;
  centerLat: number;
  centerLng: number;
  maxSteps: number;
  weather?: {
    tempMean: number;
    tempMax: number;
    precipitation: number;
    cumulativePrecip: number;
  };
}

interface SimulateRequest extends SimRequest {
  suppression?: SuppressionConfig;
}

interface Q1Request extends SimRequest {
  bundle: ResourceCount[];
  thresholdAreaHa: number;
}

interface Q2Request extends SimRequest {
  delayMin: number;
  thresholdAreaHa: number;
}

function elevationOrUndefined(arr: number[] | undefined): Float32Array | undefined {
  return arr ? new Float32Array(arr) : undefined;
}

function enrichedConfig(config: SimulationConfig, weather?: SimRequest["weather"]) {
  return {
    ...config,
    tempMean: weather?.tempMean ?? 25,
    tempMax: weather?.tempMax ?? 35,
    precipitation: weather?.precipitation ?? 0,
    cumulativePrecip: weather?.cumulativePrecip ?? 0,
  };
}

app.post("/api/simulate", async (req: Request, res: Response) => {
  try {
    const body = req.body as SimulateRequest;
    const t0 = Date.now();
    const result = runSimulation(
      enrichedConfig(body.config, body.weather),
      body.igniteRow,
      body.igniteCol,
      () => 0,
      body.maxSteps,
      body.centerLat,
      body.centerLng,
      body.fuelMap,
      elevationOrUndefined(body.elevationMap),
      body.suppression,
    );
    const baselineRle = result.baseline.map((s) => rleEncode(s.grid));
    const suppressedRle = result.suppressed?.history.map((s) => rleEncode(s.grid));
    res.json({
      elapsedMs: Date.now() - t0,
      gridSize: body.config.gridSize,
      baseline: { rleSteps: baselineRle, length: result.baseline.length },
      suppressed: result.suppressed
        ? {
            rleSteps: suppressedRle,
            length: result.suppressed.history.length,
            diags: result.suppressed.diags,
          }
        : undefined,
      finalAreaHa: finalAreaHa(
        result.suppressed?.history ?? result.baseline,
        body.config.cellSizeMeters,
      ),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/q1", async (req: Request, res: Response) => {
  try {
    const body = req.body as Q1Request;
    const t0 = Date.now();
    const result = await findMaxDelay({
      config: enrichedConfig(body.config, body.weather),
      fuelMap: body.fuelMap,
      elevationMap: elevationOrUndefined(body.elevationMap),
      igniteRow: body.igniteRow,
      igniteCol: body.igniteCol,
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      maxSteps: body.maxSteps,
      thresholdAreaHa: body.thresholdAreaHa,
      bundle: body.bundle,
    });
    res.json({ elapsedMs: Date.now() - t0, ...result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/q2", async (req: Request, res: Response) => {
  try {
    const body = req.body as Q2Request;
    const t0 = Date.now();
    const result = await findMinTier({
      config: enrichedConfig(body.config, body.weather),
      fuelMap: body.fuelMap,
      elevationMap: elevationOrUndefined(body.elevationMap),
      igniteRow: body.igniteRow,
      igniteCol: body.igniteCol,
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      maxSteps: body.maxSteps,
      thresholdAreaHa: body.thresholdAreaHa,
      delayMin: body.delayMin,
    });
    res.json({ elapsedMs: Date.now() - t0, ...result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

interface ExtendRequest {
  config: SimulationConfig;
  fuelMap: FuelType[];
  elevationMap?: number[];
  centerLat: number;
  centerLng: number;
  initialGridRle: number[];
  initialStep: number;
  weather?: SimRequest["weather"];
  suppression: SuppressionConfig | null;
  maxSteps: number;
}

interface QBoundaryRequest {
  config: SimulationConfig;
  fuelMap: FuelType[];
  elevationMap?: number[];
  centerLat: number;
  centerLng: number;
  initialGridRle: number[];
  initialStep: number;
  polygon: LatLng[];
  weather?: SimRequest["weather"];
  maxSteps: number;
  modelConfig?: BoundarySearchOverrides;
}

app.post("/api/extend", async (req: Request, res: Response) => {
  try {
    const body = req.body as ExtendRequest;
    const t0 = Date.now();
    const initialGrid = rleDecode(
      body.initialGridRle,
      body.config.gridSize * body.config.gridSize,
    );
    const result = extendSimulation(
      enrichedConfig(body.config, body.weather),
      initialGrid,
      body.initialStep,
      body.fuelMap,
      elevationOrUndefined(body.elevationMap),
      body.centerLat,
      body.centerLng,
      () => 0,
      body.suppression,
      body.maxSteps,
    );
    res.json({
      elapsedMs: Date.now() - t0,
      gridSize: body.config.gridSize,
      rleSteps: result.history.map((s) => rleEncode(s.grid)),
      diags: result.diags,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/q-boundary", async (req: Request, res: Response) => {
  try {
    const body = req.body as QBoundaryRequest;
    const t0 = Date.now();
    const initialGrid = rleDecode(
      body.initialGridRle,
      body.config.gridSize * body.config.gridSize,
    );
    const result = await findMinRosterForBoundary({
      config: enrichedConfig(body.config, body.weather),
      fuelMap: body.fuelMap,
      elevationMap: elevationOrUndefined(body.elevationMap),
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      initialGrid,
      initialStep: body.initialStep,
      polygon: body.polygon,
      maxSteps: body.maxSteps,
      modelConfig: body.modelConfig,
    });
    res.json({
      elapsedMs: Date.now() - t0,
      gridSize: body.config.gridSize,
      recommendedRoster: result.recommendedRoster,
      bestEffortRoster: result.bestEffortRoster,
      passingRun: result.passingRun
        ? {
            rleSteps: result.passingRun.history.map((s) => rleEncode(s.grid)),
            diags: result.passingRun.diags,
          }
        : null,
      failingRun: result.failingRun
        ? {
            rleSteps: result.failingRun.history.map((s) => rleEncode(s.grid)),
            diags: result.failingRun.diags,
          }
        : null,
      breachStep: result.breachStep,
      breachPercent: result.breachPercent,
      bisectionTrace: result.bisectionTrace,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✓ Wildfire dev server listening on http://localhost:${PORT}`);
  console.log("  POST /api/simulate, /api/q1, /api/q2, /api/extend, /api/q-boundary — JSON in/out");
});
