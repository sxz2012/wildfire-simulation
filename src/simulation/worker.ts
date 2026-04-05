import { runSimulation } from "./runner";
import { loadModel } from "./mlModel";
import type { SimulationConfig, FuelType } from "./types";

export interface WorkerRequest {
  type: "run" | "loadModel";
  config?: SimulationConfig;
  igniteRow?: number;
  igniteCol?: number;
  maxSteps?: number;
  centerLat?: number;
  centerLng?: number;
  fuelMap?: FuelType[];
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
  gridBuffer?: ArrayBuffer;
  historyLength?: number;
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

    const { config, igniteRow, igniteCol, maxSteps, centerLat, centerLng, fuelMap, weatherData } = e.data;

    // Attach weather data to config for ML model access
    const enrichedConfig = {
      ...config!,
      tempMean: weatherData?.tempMean ?? 25,
      tempMax: weatherData?.tempMax ?? 35,
      precipitation: weatherData?.precipitation ?? 0,
      cumulativePrecip: weatherData?.cumulativePrecip ?? 0,
    };

    const result = runSimulation(
      enrichedConfig, igniteRow!, igniteCol!, () => 0, maxSteps!,
      centerLat!, centerLng!, fuelMap
    );

    const gridCells = config!.gridSize * config!.gridSize;
    const totalBytes = result.history.length * gridCells;
    const buffer = new Uint8Array(totalBytes);

    for (let i = 0; i < result.history.length; i++) {
      buffer.set(result.history[i].grid, i * gridCells);
    }

    const response: WorkerResponse = {
      type: "complete",
      step: result.history.length,
      gridBuffer: buffer.buffer,
      historyLength: result.history.length,
      gridSize: config!.gridSize,
    };

    self.postMessage(response, { transfer: [buffer.buffer] });
  } catch (err) {
    const response: WorkerResponse = {
      type: "error",
      step: 0,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
