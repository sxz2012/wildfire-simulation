import {
  CellState,
  FUEL_PROPERTIES,
  type GridCell,
  type SimulationConfig,
} from "./types";

export function createGrid(
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
  elevationFn: (lat: number, lng: number) => number
): GridCell[] {
  const { gridSize, cellSizeMeters, defaultFuel } = config;
  const grid: GridCell[] = new Array(gridSize * gridSize);

  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

  const halfGrid = gridSize / 2;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const offsetRow = row - halfGrid;
      const offsetCol = col - halfGrid;

      const lat = centerLat + (offsetRow * cellSizeMeters) / metersPerDegreeLat;
      const lng =
        centerLng + (offsetCol * cellSizeMeters) / metersPerDegreeLng;

      grid[row * gridSize + col] = {
        state: CellState.Unburned,
        fuel: defaultFuel,
        elevation: elevationFn(lat, lng),
        burnTimer: 0,
        lat,
        lng,
      };
    }
  }

  return grid;
}

export function getCell(
  grid: GridCell[],
  row: number,
  col: number,
  gridSize: number
): GridCell {
  return grid[row * gridSize + col];
}

export function igniteCell(
  grid: GridCell[],
  row: number,
  col: number,
  gridSize: number
): void {
  const cell = grid[row * gridSize + col];
  cell.state = CellState.Burning;
  cell.burnTimer = FUEL_PROPERTIES[cell.fuel].burnDuration;
}
