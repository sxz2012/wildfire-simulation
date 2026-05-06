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
  centerLng: number,
  /** Real-world ignition timestamp. When provided, frame dates are emitted
   *  as ISO strings so the UI can show actual clock dates/times. When
   *  omitted, frames fall back to "Day N, HH:MM" simulation-relative labels. */
  originDate?: Date,
): HistoricalFire {
  const { gridSize, cellSizeMeters, timestepMinutes } = config;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const halfGrid = gridSize / 2;
  const cellLat = cellSizeMeters / metersPerDegreeLat;
  const cellLng = cellSizeMeters / metersPerDegreeLng;

  const frames: FireFrame[] = history.map((state, stepIdx) => {
    const hotspots: { lat: number; lng: number; frp: number }[] = [];

    // Memory cap: a fully-developed fire on a 600x600 grid can have
    // 50k+ Burning cells per frame. Materializing every cell as an
    // object for 200 frames produces 10M+ tiny objects and OOMs the
    // tab. We uniform-sample down to MAX_HOTSPOTS_PER_FRAME — the
    // renderer (HistoricalFireOverlay) already further subsamples for
    // billboards, so 500 here looks continuous on screen.
    const MAX_HOTSPOTS_PER_FRAME = 500;
    const burningIndices: number[] = [];
    const grid = state.grid;
    const total = grid.length;
    for (let i = 0; i < total; i++) {
      if (grid[i] === CellState.Burning) burningIndices.push(i);
    }
    const sampleStep = burningIndices.length > MAX_HOTSPOTS_PER_FRAME
      ? Math.ceil(burningIndices.length / MAX_HOTSPOTS_PER_FRAME)
      : 1;
    for (let k = 0; k < burningIndices.length; k += sampleStep) {
      const idx = burningIndices[k];
      const row = Math.floor(idx / gridSize);
      const col = idx - row * gridSize;
      const lat = centerLat + (row - halfGrid) * cellLat;
      const lng = centerLng + (col - halfGrid) * cellLng;
      hotspots.push({
        lat: Math.round(lat * 100000) / 100000,
        lng: Math.round(lng * 100000) / 100000,
        frp: 10,
      });
    }

    let date: string;
    if (originDate) {
      // ISO timestamp at originDate + stepIdx timesteps. Components detect
      // "T" / trailing "Z" and render in the viewer's local timezone.
      date = new Date(originDate.getTime() + stepIdx * timestepMinutes * 60_000).toISOString();
    } else {
      const totalMinutes = stepIdx * timestepMinutes;
      const day = Math.floor(totalMinutes / 1440) + 1;
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const mins = totalMinutes % 60;
      date = `Day ${day}, ${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
    }

    return { date, hotspots };
  });

  // Pre-fire frame (no hotspots yet) sits at the same wall-clock moment as
  // the ignition step. Label it with the ignition timestamp itself so the
  // UI's Origin field reads as a real date/time rather than "Before ignition".
  const ignitionLabel = originDate ? originDate.toISOString() : "Day 1, 00:00";
  frames.unshift({ date: ignitionLabel, hotspots: [] });

  return {
    name: "Simulation",
    description: "Simulated fire spread",
    startDate: "simulation",
    endDate: "simulation",
    location: { lat: centerLat, lng: centerLng, altitude: 15000 },
    frames,
  };
}
