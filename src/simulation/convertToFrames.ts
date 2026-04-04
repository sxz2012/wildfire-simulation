import { CellState, type SimulationConfig, type SimulationState } from "./types";
import type { HistoricalFire, FireFrame } from "../data/historicalFires";

/**
 * Convert simulation grid history into the same frame-based format
 * used by historical fire replays.
 */
export function convertSimulationToFire(
  history: SimulationState[],
  config: SimulationConfig,
  centerLat: number,
  centerLng: number
): HistoricalFire {
  const { gridSize, cellSizeMeters, timestepMinutes } = config;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const halfGrid = gridSize / 2;
  const cellLat = cellSizeMeters / metersPerDegreeLat;
  const cellLng = cellSizeMeters / metersPerDegreeLng;

  const frames: FireFrame[] = history.map((state, stepIdx) => {
    const hotspots: { lat: number; lng: number; frp: number }[] = [];

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        if (state.grid[row * gridSize + col] === CellState.Burning) {
          const lat = centerLat + (row - halfGrid) * cellLat;
          const lng = centerLng + (col - halfGrid) * cellLng;
          hotspots.push({ lat: Math.round(lat * 100000) / 100000, lng: Math.round(lng * 100000) / 100000, frp: 10 });
        }
      }
    }

    // Generate a time label for this step
    const totalMinutes = stepIdx * timestepMinutes;
    const day = Math.floor(totalMinutes / 1440) + 1;
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;
    const date = `Day ${day}, ${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;

    return { date, hotspots };
  });

  // Add empty pre-fire frame
  frames.unshift({ date: "Before ignition", hotspots: [] });

  return {
    name: "Simulation",
    description: "Simulated fire spread",
    startDate: "simulation",
    endDate: "simulation",
    location: { lat: centerLat, lng: centerLng, altitude: 15000 },
    frames,
  };
}
