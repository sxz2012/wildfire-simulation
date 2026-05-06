/**
 * Frontend client for the local Node dev-server. Tries the API first;
 * surfaces a clear error if the server isn't running. Browser-worker
 * fallback is left to the caller (App.tsx) — it can decide to silently
 * fall back, or to surface the error.
 */
import type {
  FuelType,
  ResourceCount,
  SimulationConfig,
  SuppressionConfig,
} from "../simulation/types";

const API_BASE = "http://localhost:3001";

export class ApiUnreachableError extends Error {
  constructor() {
    super("Local Node server unreachable. Run `npm run server` on the workstation.");
    this.name = "ApiUnreachableError";
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiUnreachableError();
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function isServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface ApiSimulateRequest {
  config: SimulationConfig;
  fuelMap: FuelType[];
  elevationMap?: number[];
  igniteRow: number;
  igniteCol: number;
  centerLat: number;
  centerLng: number;
  maxSteps: number;
  weather?: { tempMean: number; tempMax: number; precipitation: number; cumulativePrecip: number };
  suppression?: SuppressionConfig;
}

export async function apiSimulate(req: ApiSimulateRequest) {
  return postJson<{
    elapsedMs: number;
    gridSize: number;
    baseline: { rleSteps: number[][]; length: number };
    suppressed?: { rleSteps: number[][]; length: number; diags: unknown[] };
    finalAreaHa: number;
  }>("/api/simulate", req);
}

export interface ApiQ1Request extends Omit<ApiSimulateRequest, "suppression"> {
  bundle: ResourceCount[];
  thresholdAreaHa: number;
}

export async function apiQ1(req: ApiQ1Request) {
  return postJson<{
    elapsedMs: number;
    maxDelayMin: number | null;
    bisectionTrace: Array<{ delayMin: number; finalAreaHa: number; passed: boolean }>;
  }>("/api/q1", req);
}

export interface ApiQ2Request extends Omit<ApiSimulateRequest, "suppression"> {
  delayMin: number;
  thresholdAreaHa: number;
}

export async function apiQ2(req: ApiQ2Request) {
  return postJson<{
    elapsedMs: number;
    minTier: string | null;
    tierTrace: Array<{ tier: string; finalAreaHa: number; passed: boolean }>;
  }>("/api/q2", req);
}
