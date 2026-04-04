import {
  CellState,
  FuelType,
  FUEL_PROPERTIES,
  type GridCell,
  type SimulationConfig,
} from "./types";

interface SpreadParams {
  slopeAngle: number; // degrees, positive = uphill
  windAlignment: number; // -1 (against) to +1 (aligned)
  humidity: number; // 0-100
  fuel: FuelType;
}

/**
 * Compute spread rate (0-1 probability of ignition per timestep).
 * Simplified Rothermel: R = R0 * (1 + phi_wind + phi_slope) * humidity_factor
 */
export function computeSpreadRate(params: SpreadParams): number {
  const { slopeAngle, windAlignment, humidity, fuel } = params;
  const fuelProps = FUEL_PROPERTIES[fuel];

  const R0 = fuelProps.spreadRate;
  const phiSlope = Math.max(-0.5, slopeAngle * 0.03);
  const phiWind = windAlignment * 0.5;
  const humidityFactor = Math.max(0, 1 - humidity / 120);

  const rate = R0 * (1 + phiWind + phiSlope) * humidityFactor * fuelProps.ignitionRate;
  return Math.max(0, Math.min(1, rate));
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

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      const cell = grid[idx];

      // Decrement burn timer for burning cells
      if (cell.state === CellState.Burning) {
        newGrid[idx].burnTimer = cell.burnTimer - 1;
        if (newGrid[idx].burnTimer <= 0) {
          newGrid[idx].state = CellState.Burned;
        }
      }

      // Spread fire from burning cells to unburned neighbors
      if (cell.state === CellState.Burning) {
        for (const [dr, dc] of NEIGHBOR_OFFSETS) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;

          const nIdx = nr * gridSize + nc;
          const neighbor = grid[nIdx];
          if (neighbor.state !== CellState.Unburned) continue;

          const elevDiff = neighbor.elevation - cell.elevation;
          const dist = Math.sqrt(dr * dr + dc * dc) * cellSizeMeters;
          const slopeAngle = (Math.atan2(elevDiff, dist) * 180) / Math.PI;

          const wAlign =
            windAlignmentFactor(dr, dc, windDirection) *
            Math.min(windSpeed / 30, 1);

          const rate = computeSpreadRate({
            slopeAngle,
            windAlignment: wAlign,
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
