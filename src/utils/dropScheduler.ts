import { CellState, ResourceType } from "../simulation/types";
import type { SimulationConfig, SimulationState, SuppressionConfig } from "../simulation/types";

const DROP_CADENCE_SIM_MIN = 30;
const DROP_DURATION_SIM_MIN = 3;
const DROP_OFFSET_KM = 5;

export interface DropEvent {
  tankerIdx: number;
  startStep: number;
  centerStep: number;
  endStep: number;
  axisStart: { lat: number; lng: number };
  axisEnd: { lat: number; lng: number };
}

export function dropScheduler(
  history: SimulationState[],
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
  suppression: SuppressionConfig,
  deployStep: number,
): DropEvent[] {
  const tankerEntry = suppression.resources.find((r) => r.type === ResourceType.AirTanker);
  const tankers = tankerEntry?.count ?? 0;
  if (tankers <= 0) return [];

  const cadenceSteps = Math.max(1, Math.round(DROP_CADENCE_SIM_MIN / config.timestepMinutes));
  const durationSteps = Math.max(1, Math.round(DROP_DURATION_SIM_MIN / config.timestepMinutes));
  const interTankerOffset = Math.floor(cadenceSteps / tankers);

  const { gridSize, cellSizeMeters } = config;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const cellLat = cellSizeMeters / metersPerDegLat;
  const cellLng = cellSizeMeters / metersPerDegLng;
  const half = gridSize / 2;
  const offsetLat = (DROP_OFFSET_KM * 1000) / metersPerDegLat;
  const offsetLng = (DROP_OFFSET_KM * 1000) / metersPerDegLng;

  const events: DropEvent[] = [];

  for (let tIdx = 0; tIdx < tankers; tIdx++) {
    for (let s = deployStep + tIdx * interTankerOffset; s < history.length; s += cadenceSteps) {
      const grid = history[s].grid;
      let minRow = Infinity;
      let maxRow = -Infinity;
      let minCol = Infinity;
      let maxCol = -Infinity;
      let found = false;
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] === CellState.Burning) {
          const row = Math.floor(i / gridSize);
          const col = i - row * gridSize;
          if (row < minRow) minRow = row;
          if (row > maxRow) maxRow = row;
          if (col < minCol) minCol = col;
          if (col > maxCol) maxCol = col;
          found = true;
        }
      }
      if (!found) continue;

      const latSpanMeters = (maxRow - minRow + 1) * cellSizeMeters;
      const lngSpanMeters = (maxCol - minCol + 1) * cellSizeMeters;
      const centerRowLat = centerLat + ((minRow + maxRow) / 2 - half) * cellLat;
      const centerColLng = centerLng + ((minCol + maxCol) / 2 - half) * cellLng;

      let axisStart: { lat: number; lng: number };
      let axisEnd: { lat: number; lng: number };
      if (latSpanMeters >= lngSpanMeters) {
        const minLat = centerLat + (minRow - half) * cellLat;
        const maxLat = centerLat + (maxRow - half) * cellLat;
        axisStart = { lat: minLat - offsetLat, lng: centerColLng };
        axisEnd = { lat: maxLat + offsetLat, lng: centerColLng };
      } else {
        const minLng = centerLng + (minCol - half) * cellLng;
        const maxLng = centerLng + (maxCol - half) * cellLng;
        axisStart = { lat: centerRowLat, lng: minLng - offsetLng };
        axisEnd = { lat: centerRowLat, lng: maxLng + offsetLng };
      }

      const startStep = Math.max(deployStep, s - Math.floor(durationSteps / 2));
      const endStep = Math.min(history.length - 1, s + Math.ceil(durationSteps / 2));

      events.push({
        tankerIdx: tIdx,
        startStep,
        centerStep: s,
        endStep,
        axisStart,
        axisEnd,
      });
    }
  }

  events.sort((a, b) => a.centerStep - b.centerStep || a.tankerIdx - b.tankerIdx);
  return events;
}
