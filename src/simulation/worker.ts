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
  type: "progress" | "complete";
  step: number;
  history?: { grid: number[]; timestep: number }[];
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { config, igniteRow, igniteCol, maxSteps } = e.data;

  const result = runSimulation(config, igniteRow, igniteCol, () => 0, maxSteps);

  const serializableHistory = result.history.map((s) => ({
    grid: Array.from(s.grid),
    timestep: s.timestep,
  }));

  const response: WorkerResponse = {
    type: "complete",
    step: result.history.length,
    history: serializableHistory,
  };
  self.postMessage(response);
};
