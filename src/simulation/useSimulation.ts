import { useState, useRef, useCallback, useEffect } from "react";
import type { SimulationConfig, SimulationState, FuelType } from "./types";
import type { SuppressionConfig, SuppressionStepDiag } from "./types";
import type { WorkerResponse } from "./worker";
import { apiSimulate, isServerReachable, ApiUnreachableError } from "../services/simulationApi";
import { rleDecode } from "../utils/rle";

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
  /** Inject a precomputed history (used by the scenario loader). */
  setHistory: (h: DualHistory) => void;
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
    async (
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
      setIsRunning(true);
      setHistory({ baseline: [] });

      // Try the local Node API first (much faster on a powerful workstation).
      // If unreachable or it errors, fall back to the browser worker path.
      const apiReachable = await isServerReachable();
      if (apiReachable) {
        try {
          const result = await apiSimulate({
            config,
            fuelMap: fuelMap ?? [],
            elevationMap: elevationMap ? Array.from(elevationMap) : undefined,
            igniteRow,
            igniteCol,
            centerLat,
            centerLng,
            maxSteps,
            weather: weatherData,
            suppression: suppressionConfig,
          });

          const gridCells = config.gridSize * config.gridSize;
          const baseStates: SimulationState[] = result.baseline.rleSteps.map((rle, i) => ({
            grid: rleDecode(rle, gridCells),
            timestep: i,
          }));
          let suppressedStates: SimulationState[] | undefined;
          if (result.suppressed) {
            suppressedStates = result.suppressed.rleSteps.map((rle, i) => ({
              grid: rleDecode(rle, gridCells),
              timestep: i,
            }));
          }

          setHistory({
            baseline: baseStates,
            suppressed: suppressedStates,
            diags: (result.suppressed?.diags as SuppressionStepDiag[] | undefined) ?? undefined,
          });
          setIsRunning(false);
          console.log(`Sim via API in ${result.elapsedMs}ms`);
          return;
        } catch (err) {
          if (err instanceof ApiUnreachableError) {
            console.warn("API became unreachable mid-request; falling back to browser worker");
          } else {
            console.warn("API simulation failed; falling back to browser worker:", err);
          }
          // Fall through to the worker path.
        }
      }

      // Fallback: original browser worker path. Keep it byte-for-byte the same
      // as before (just paste the existing logic here).
      const worker = workerRef.current;
      if (!worker) {
        setIsRunning(false);
        return;
      }

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "complete" && e.data.baselineBuffer) {
          const { baselineBuffer, baselineLength, suppressedBuffer, suppressedLength, suppressionDiags, gridSize } = e.data;
          const gridCellsW = gridSize! * gridSize!;
          const baseline = new Uint8Array(baselineBuffer);
          const baseStatesW: SimulationState[] = [];
          for (let i = 0; i < baselineLength!; i++) {
            baseStatesW.push({
              grid: baseline.subarray(i * gridCellsW, (i + 1) * gridCellsW),
              timestep: i,
            });
          }
          let suppressedStatesW: SimulationState[] | undefined;
          if (suppressedBuffer && suppressedLength) {
            const supp = new Uint8Array(suppressedBuffer);
            suppressedStatesW = [];
            for (let i = 0; i < suppressedLength; i++) {
              suppressedStatesW.push({
                grid: supp.subarray(i * gridCellsW, (i + 1) * gridCellsW),
                timestep: i,
              });
            }
          }
          setHistory({ baseline: baseStatesW, suppressed: suppressedStatesW, diags: suppressionDiags });
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

  return { history, isRunning, startSimulation, reset, setHistory };
}
