import type { Viewer as CesiumViewer } from "cesium";
import { Cartographic, sampleTerrainMostDetailed } from "cesium";

/**
 * Sample real terrain elevations for the simulation grid centered at
 * (centerLat, centerLng) using the viewer's loaded terrain provider.
 *
 * Returns a Float32Array of `gridSize × gridSize` elevations in meters.
 * Cells at or below sea level (elevation <= 0) indicate ocean / bay / sea
 * surfaces — the caller can use this to mark them as water.
 *
 * For performance the grid is sampled at every Nth cell and the surrounding
 * block is filled with the same value (matches the strategy in
 * `sampleVegetation`). Falls back to all-zeros on any error.
 */
export async function sampleElevations(
  viewer: CesiumViewer,
  centerLat: number,
  centerLng: number,
  gridSize: number,
  cellSizeMeters: number,
): Promise<Float32Array> {
  const elevations = new Float32Array(gridSize * gridSize);
  const provider = viewer.terrainProvider;
  if (!provider) return elevations;

  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const halfGrid = gridSize / 2;
  const sampleStep = Math.max(1, Math.floor(gridSize / 50));

  const positions: Cartographic[] = [];
  const sampledCells: Array<{ row: number; col: number }> = [];

  for (let row = 0; row < gridSize; row += sampleStep) {
    for (let col = 0; col < gridSize; col += sampleStep) {
      const offsetRow = row - halfGrid;
      const offsetCol = col - halfGrid;
      const lat = centerLat + (offsetRow * cellSizeMeters) / metersPerDegreeLat;
      const lng = centerLng + (offsetCol * cellSizeMeters) / metersPerDegreeLng;
      positions.push(Cartographic.fromDegrees(lng, lat));
      sampledCells.push({ row, col });
    }
  }

  try {
    const sampled = await sampleTerrainMostDetailed(provider, positions);
    for (let i = 0; i < sampled.length; i++) {
      const { row, col } = sampledCells[i];
      const h = sampled[i].height ?? 0;
      for (let dr = 0; dr < sampleStep && row + dr < gridSize; dr++) {
        for (let dc = 0; dc < sampleStep && col + dc < gridSize; dc++) {
          elevations[(row + dr) * gridSize + (col + dc)] = h;
        }
      }
    }
  } catch (err) {
    console.warn("Terrain sampling failed, falling back to zero elevations:", err);
  }

  return elevations;
}
