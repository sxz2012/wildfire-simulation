import { runSimulation } from "./runner";
import { loadModel } from "./mlModel";
import type {
  SimulationConfig,
  FuelType,
  SuppressionConfig,
  SuppressionStepDiag,
} from "./types";

export interface WorkerRequest {
  type: "run" | "loadModel";
  config?: SimulationConfig;
  igniteRow?: number;
  igniteCol?: number;
  maxSteps?: number;
  centerLat?: number;
  centerLng?: number;
  fuelMap?: FuelType[];
  elevationMap?: Float32Array;
  suppressionConfig?: SuppressionConfig;
  modelJson?: unknown;
  weatherData?: {
    tempMean: number;
    tempMax: number;
    precipitation: number;
    cumulativePrecip: number;
  };
}

export interface WorkerResponse {
  type: "complete" | "error" | "modelLoaded";
  step: number;
  baselineBuffer?: ArrayBuffer;
  suppressedBuffer?: ArrayBuffer;
  baselineLength?: number;
  suppressedLength?: number;
  suppressionDiags?: SuppressionStepDiag[];
  gridSize?: number;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    if (e.data.type === "loadModel") {
      loadModel(e.data.modelJson as Parameters<typeof loadModel>[0]);
      const response: WorkerResponse = { type: "modelLoaded", step: 0 };
      self.postMessage(response);
      return;
    }

    const { config, igniteRow, igniteCol, maxSteps, centerLat, centerLng, fuelMap, elevationMap, weatherData, suppressionConfig } = e.data;

    const enrichedConfig = {
      ...config!,
      tempMean: weatherData?.tempMean ?? 25,
      tempMax: weatherData?.tempMax ?? 35,
      precipitation: weatherData?.precipitation ?? 0,
      cumulativePrecip: weatherData?.cumulativePrecip ?? 0,
    };

    const result = runSimulation(
      enrichedConfig, igniteRow!, igniteCol!, () => 0, maxSteps!,
      centerLat!, centerLng!, fuelMap, elevationMap, suppressionConfig,
    );

    const gridCells = config!.gridSize * config!.gridSize;
    const packBuffer = (history: typeof result.baseline): ArrayBuffer => {
      const buf = new Uint8Array(history.length * gridCells);
      for (let i = 0; i < history.length; i++) buf.set(history[i].grid, i * gridCells);
      return buf.buffer;
    };
    const baselineBuffer = packBuffer(result.baseline);
    const suppressedBuffer = result.suppressed ? packBuffer(result.suppressed.history) : undefined;

    const response: WorkerResponse = {
      type: "complete",
      step: result.baseline.length,
      baselineBuffer,
      baselineLength: result.baseline.length,
      suppressedBuffer,
      suppressedLength: result.suppressed?.history.length,
      suppressionDiags: result.suppressed?.diags,
      gridSize: config!.gridSize,
    };

    const transfer: ArrayBuffer[] = [baselineBuffer];
    if (suppressedBuffer) transfer.push(suppressedBuffer);
    self.postMessage(response, { transfer });
  } catch (err) {
    const response: WorkerResponse = {
      type: "error",
      step: 0,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
