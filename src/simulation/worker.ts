import { runSimulation } from "./runner";
import type { SimulationConfig } from "./types";

export interface WorkerRequest {
  type: "run";
  config: SimulationConfig;
  igniteRow: number;
  igniteCol: number;
  maxSteps: number;
}

export interface WorkerResponse {
  type: "complete" | "error";
  step: number;
  /** Flat buffer: all grid snapshots concatenated */
  gridBuffer?: ArrayBuffer;
  /** Number of timesteps in the history */
  historyLength?: number;
  /** Grid size (cells per side) for slicing the buffer */
  gridSize?: number;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const { config, igniteRow, igniteCol, maxSteps } = e.data;

    const result = runSimulation(config, igniteRow, igniteCol, () => 0, maxSteps);

    // Pack all snapshots into a single ArrayBuffer for zero-copy transfer
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

    // Transfer the buffer (zero-copy, no serialization overhead)
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
