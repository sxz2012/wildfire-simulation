import {
  CellState,
  FUEL_PROPERTIES,
  type GridCell,
  type SimulationConfig,
} from "./types";

export interface SpreadParams {
  slopeAngle: number;
  windAlignment: number; // -1 (against) to +1 (aligned)
  windStrength?: number; // 0-1 normalized
  humidity: number;
  fuel: (typeof import("./types").FuelType)[keyof typeof import("./types").FuelType];
}

/**
 * Compute spread probability per timestep.
 *
 * Key behavior:
 *   - Fire spreads MUCH faster downwind than upwind (3-5x difference)
 *   - Against strong wind, spread probability drops near zero
 *   - Crosswind spread is moderate
 *   - This creates realistic elongated fire shapes
 */
export function computeSpreadRate(params: SpreadParams): number {
  const { slopeAngle, windAlignment, windStrength = 0.5, humidity, fuel } = params;
  const fuelProps = FUEL_PROPERTIES[fuel];

  // Base spread rate
  const R0 = fuelProps.spreadRate * 0.35;

  // Slope factor
  const phiSlope = Math.max(-0.3, Math.min(0.6, slopeAngle * 0.02));

  // Wind factor — STRONGLY directional
  // windAlignment: -1 (against) to +1 (with wind)
  // With strong wind: downwind gets big boost, upwind gets suppressed
  let windFactor: number;
  if (windStrength < 0.1) {
    // Calm — spread equally in all directions (slow)
    windFactor = 0;
  } else {
    // Strong directional effect:
    // Downwind (alignment=1): factor = +2 to +4 (fast spread)
    // Crosswind (alignment=0): factor = 0 (base rate only)
    // Upwind (alignment=-1): factor = -0.7 (nearly stops)
    windFactor = windAlignment * windStrength * 3.0;
    if (windAlignment < 0) {
      // Suppress upwind spread more aggressively
      windFactor = windAlignment * windStrength * 1.5;
    }
  }

  // Humidity dampening
  const humidityFactor = Math.max(0.02, Math.exp(-humidity / 40));

  const rate = R0 * (1 + windFactor + phiSlope) * humidityFactor * fuelProps.ignitionRate;

  // Clamp — prevent negative and cap at reasonable max
  return Math.max(0, Math.min(0.6, rate));
}

function windAlignmentFactor(
  dRow: number,
  dCol: number,
  windDirection: number
): number {
  const windRad = ((windDirection + 180) * Math.PI) / 180;
  const windDr = -Math.cos(windRad);
  const windDc = Math.sin(windRad);

  const len = Math.sqrt(dRow * dRow + dCol * dCol);
  if (len === 0) return 0;

  return (dRow * windDr + dCol * windDc) / len;
}

const NEIGHBOR_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function simulateStep(
  grid: GridCell[],
  config: SimulationConfig
): GridCell[] {
  const { gridSize, windSpeed, windDirection, humidity, cellSizeMeters } = config;
  const newGrid: GridCell[] = grid.map((cell) => ({ ...cell }));

  const windStrength = Math.min(windSpeed / 40, 1.0);

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      const cell = grid[idx];

      if (cell.state === CellState.Burning) {
        newGrid[idx].burnTimer = cell.burnTimer - 1;
        if (newGrid[idx].burnTimer <= 0) {
          newGrid[idx].state = CellState.Burned;
        }
      }

      if (cell.state === CellState.Burning) {
        for (const [dr, dc] of NEIGHBOR_OFFSETS) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;

          const nIdx = nr * gridSize + nc;
          const neighbor = grid[nIdx];
          if (neighbor.state !== CellState.Unburned) continue;
          if (newGrid[nIdx].state === CellState.Burning) continue;

          const elevDiff = neighbor.elevation - cell.elevation;
          const dist = Math.sqrt(dr * dr + dc * dc) * cellSizeMeters;
          const slopeAngle = (Math.atan2(elevDiff, dist) * 180) / Math.PI;

          const wAlign = windAlignmentFactor(dr, dc, windDirection);

          const rate = computeSpreadRate({
            slopeAngle,
            windAlignment: wAlign,
            windStrength,
            humidity,
            fuel: neighbor.fuel,
          });

          if (Math.random() < rate) {
            newGrid[nIdx].state = CellState.Burning;
            newGrid[nIdx].burnTimer = FUEL_PROPERTIES[neighbor.fuel].burnDuration;
          }
        }
      }
    }
  }

  return newGrid;
}
