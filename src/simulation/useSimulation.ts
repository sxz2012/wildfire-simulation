import { useState, useRef, useCallback } from "react";
import type { SimulationConfig, SimulationState, FuelType } from "./types";
import type { WorkerResponse } from "./worker";

interface UseSimulationReturn {
  history: SimulationState[];
  isRunning: boolean;
  startSimulation: (
    config: SimulationConfig,
    igniteRow: number,
    igniteCol: number,
    centerLat: number,
    centerLng: number,
    fuelMap?: FuelType[],
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
      centerLat: number,
      centerLng: number,
      fuelMap?: FuelType[],
      maxSteps = 300
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
        if (e.data.type === "complete" && e.data.gridBuffer) {
          const { gridBuffer, historyLength, gridSize } = e.data;
          const fullBuffer = new Uint8Array(gridBuffer);
          const gridCells = gridSize! * gridSize!;

          const states: SimulationState[] = [];
          for (let i = 0; i < historyLength!; i++) {
            states.push({
              grid: fullBuffer.slice(i * gridCells, (i + 1) * gridCells),
              timestep: i,
            });
          }

          setHistory(states);
          setIsRunning(false);
          worker.terminate();
        } else if (e.data.type === "error") {
          console.error("Simulation worker error:", e.data.error);
          setIsRunning(false);
          worker.terminate();
        }
      };

      worker.onerror = (err) => {
        console.error("Worker failed to load:", err);
        setIsRunning(false);
      };

      worker.postMessage({
        type: "run",
        config,
        igniteRow,
        igniteCol,
        maxSteps,
        centerLat,
        centerLng,
        fuelMap,
      });
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
