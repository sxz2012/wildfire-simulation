import { useState, useRef, useCallback, useEffect } from "react";
import type { SimulationConfig, SimulationState, FuelType } from "./types";
import type { SuppressionConfig, SuppressionStepDiag } from "./types";
import type { WorkerResponse } from "./worker";

interface DualHistory {
  baseline: SimulationState[];
  suppressed?: SimulationState[];
  diags?: SuppressionStepDiag[];
}

interface UseSimulationReturn {
  history: DualHistory;
  isRunning: boolean;
  startSimulation: (
    config: SimulationConfig,
    igniteRow: number,
    igniteCol: number,
    centerLat: number,
    centerLng: number,
    fuelMap?: FuelType[],
    weatherData?: { tempMean: number; tempMax: number; precipitation: number; cumulativePrecip: number },
    maxSteps?: number,
    elevationMap?: Float32Array,
    suppressionConfig?: SuppressionConfig,
  ) => void;
  reset: () => void;
}

export function useSimulation(): UseSimulationReturn {
  const [history, setHistory] = useState<DualHistory>({ baseline: [] });
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
      maxSteps = 500,
      elevationMap?: Float32Array,
      suppressionConfig?: SuppressionConfig,
    ) => {
      const worker = workerRef.current;
      if (!worker) return;

      setIsRunning(true);
      setHistory({ baseline: [] });

      // Replace the onmessage handler for this simulation run
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "complete" && e.data.baselineBuffer) {
          const { baselineBuffer, baselineLength, suppressedBuffer, suppressedLength, suppressionDiags, gridSize } = e.data;
          const gridCells = gridSize! * gridSize!;
          // Use subarray (zero-copy view) instead of slice (copy) to halve the
          // memory footprint. Each step now points into the original transferred
          // ArrayBuffer; as long as ANY subarray is held, the buffer is kept
          // alive — and React drops them all atomically when reset is called.
          const baseline = new Uint8Array(baselineBuffer);
          const baseStates: SimulationState[] = [];
          for (let i = 0; i < baselineLength!; i++) {
            baseStates.push({
              grid: baseline.subarray(i * gridCells, (i + 1) * gridCells),
              timestep: i,
            });
          }

          let suppressedStates: SimulationState[] | undefined;
          if (suppressedBuffer && suppressedLength) {
            const supp = new Uint8Array(suppressedBuffer);
            suppressedStates = [];
            for (let i = 0; i < suppressedLength; i++) {
              suppressedStates.push({
                grid: supp.subarray(i * gridCells, (i + 1) * gridCells),
                timestep: i,
              });
            }
          }
          setHistory({ baseline: baseStates, suppressed: suppressedStates, diags: suppressionDiags });
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
        elevationMap,
        weatherData,
        suppressionConfig,
      });
    },
    []
  );

  const reset = useCallback(() => {
    setHistory({ baseline: [] });
    setIsRunning(false);
  }, []);

  return { history, isRunning, startSimulation, reset };
}
