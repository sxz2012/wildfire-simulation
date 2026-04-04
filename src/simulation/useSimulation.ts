import { useState, useRef, useCallback } from "react";
import type { SimulationConfig, SimulationState } from "./types";
import type { WorkerResponse } from "./worker";

interface UseSimulationReturn {
  history: SimulationState[];
  isRunning: boolean;
  startSimulation: (
    config: SimulationConfig,
    igniteRow: number,
    igniteCol: number,
    maxSteps?: number
  ) => void;
  reset: () => void;
}

export function useSimulation(): UseSimulationReturn {
  const [history, setHistory] = useState<SimulationState[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  const startSimulation = useCallback(
    (
      config: SimulationConfig,
      igniteRow: number,
      igniteCol: number,
      maxSteps = 500
    ) => {
      workerRef.current?.terminate();

      const worker = new Worker(
        new URL("./worker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current = worker;
      setIsRunning(true);
      setHistory([]);

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "complete" && e.data.history) {
          const states: SimulationState[] = e.data.history.map((s) => ({
            grid: new Uint8Array(s.grid),
            timestep: s.timestep,
          }));
          setHistory(states);
          setIsRunning(false);
          worker.terminate();
        }
      };

      worker.postMessage({ type: "run", config, igniteRow, igniteCol, maxSteps });
    },
    []
  );

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    setHistory([]);
    setIsRunning(false);
  }, []);

  return { history, isRunning, startSimulation, reset };
}
