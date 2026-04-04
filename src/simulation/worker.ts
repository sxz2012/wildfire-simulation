import { runSimulation } from "./runner";
import type { SimulationConfig, FuelType } from "./types";

export interface WorkerRequest {
  type: "run";
  config: SimulationConfig;
  igniteRow: number;
  igniteCol: number;
  maxSteps: number;
  centerLat: number;
  centerLng: number;
  /** Optional fuel map from satellite imagery sampling */
  fuelMap?: FuelType[];
}

export interface WorkerResponse {
  type: "complete" | "error";
  step: number;
  gridBuffer?: ArrayBuffer;
  historyLength?: number;
  gridSize?: number;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const { config, igniteRow, igniteCol, maxSteps, centerLat, centerLng, fuelMap } = e.data;

    const result = runSimulation(
      config, igniteRow, igniteCol, () => 0, maxSteps,
      centerLat, centerLng, fuelMap
    );

    const gridCells = config.gridSize * config.gridSize;
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
      gridSize: config.gridSize,
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
