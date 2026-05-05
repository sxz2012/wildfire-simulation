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

    // Pack the sparse samples into a sparse 2D grid for fast lookup, then
    // bilinearly interpolate every grid cell. Block-filling caused 12x12-cell
    // slabs of identical elevation -> zero slope inside a slab, sharp slope
    // spike at slab boundaries. The ML / Rothermel model read those spikes
    // as steep cliffs and the fire failed to cross block edges, producing
    // tetris-shaped fire footprints. Bilinear interpolation removes the
    // spikes without needing more samples.
    const sampleRows = Math.ceil(gridSize / sampleStep);
    const sampleCols = Math.ceil(gridSize / sampleStep);
    const sparse = new Float32Array(sampleRows * sampleCols);
    for (let i = 0; i < sampled.length; i++) {
      const { row, col } = sampledCells[i];
      const sr = Math.floor(row / sampleStep);
      const sc = Math.floor(col / sampleStep);
      sparse[sr * sampleCols + sc] = sampled[i].height ?? 0;
    }

    for (let row = 0; row < gridSize; row++) {
      const sr0 = Math.min(Math.floor(row / sampleStep), sampleRows - 1);
      const sr1 = Math.min(sr0 + 1, sampleRows - 1);
      const tr = sr0 === sr1 ? 0 : (row - sr0 * sampleStep) / sampleStep;
      for (let col = 0; col < gridSize; col++) {
        const sc0 = Math.min(Math.floor(col / sampleStep), sampleCols - 1);
        const sc1 = Math.min(sc0 + 1, sampleCols - 1);
        const tc = sc0 === sc1 ? 0 : (col - sc0 * sampleStep) / sampleStep;

        const h00 = sparse[sr0 * sampleCols + sc0];
        const h01 = sparse[sr0 * sampleCols + sc1];
        const h10 = sparse[sr1 * sampleCols + sc0];
        const h11 = sparse[sr1 * sampleCols + sc1];

        const h0 = h00 * (1 - tc) + h01 * tc;
        const h1 = h10 * (1 - tc) + h11 * tc;
        elevations[row * gridSize + col] = h0 * (1 - tr) + h1 * tr;
      }
    }
  } catch (err) {
    console.warn("Terrain sampling failed, falling back to zero elevations:", err);
  }

  return elevations;
}
