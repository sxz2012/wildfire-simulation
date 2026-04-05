import { useState, useRef, useCallback, useEffect } from "react";
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
    weatherData?: { tempMean: number; tempMax: number; precipitation: number; cumulativePrecip: number },
    maxSteps?: number
  ) => void;
  reset: () => void;
}

export function useSimulation(): UseSimulationReturn {
  const [history, setHistory] = useState<SimulationState[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const modelLoadedRef = useRef(false);

  // Pre-load the ML model into a persistent worker
  useEffect(() => {
    const worker = new Worker(
      new URL("./worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    // Load ML model
    fetch(new URL("../data/xgboost_model.json", import.meta.url).href)
      .then((res) => res.json())
      .then((modelJson) => {
        worker.postMessage({ type: "loadModel", modelJson });
      })
      .catch((err) => {
        console.warn("ML model not loaded, using fallback:", err);
      });

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type === "modelLoaded") {
        modelLoadedRef.current = true;
        console.log("ML fire spread model loaded");
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const startSimulation = useCallback(
    (
      config: SimulationConfig,
      igniteRow: number,
      igniteCol: number,
      centerLat: number,
      centerLng: number,
      fuelMap?: FuelType[],
      weatherData?: { tempMean: number; tempMax: number; precipitation: number; cumulativePrecip: number },
      maxSteps = 500
    ) => {
      const worker = workerRef.current;
      if (!worker) return;

      setIsRunning(true);
      setHistory([]);

      // Replace the onmessage handler for this simulation run
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
        } else if (e.data.type === "error") {
          console.error("Simulation worker error:", e.data.error);
          setIsRunning(false);
        }
      };

      worker.onerror = (err) => {
        console.error("Worker error:", err);
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
        weatherData,
      });
    },
    []
  );

  const reset = useCallback(() => {
    setHistory([]);
    setIsRunning(false);
  }, []);

  return { history, isRunning, startSimulation, reset };
}
