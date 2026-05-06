import type { Viewer as CesiumViewer } from "cesium";
import { Cartographic, sampleTerrainMostDetailed } from "cesium";

/**
 * Sample real terrain elevations for the simulation grid centered at
 * (centerLat, centerLng) using the viewer's loaded terrain provider.
 *
 * Returns a Float32Array of `gridSize × gridSize` elevations in meters.
 *
 * For performance the grid is sampled sparsely and bilinearly interpolated.
 * Results are cached by (lat, lng, gridSize, cellSizeMeters) so repeat
 * sims at the same location don't re-flood Cesium Ion with terrain
 * tile fetches (the browser's per-host connection limit was exhausting
 * during back-to-back test cycles, surfacing as ERR_INSUFFICIENT_RESOURCES
 * and downstream OOM).
 */

interface CachedElevations {
  data: Float32Array;
  promise: Promise<Float32Array> | null;
}

const elevationCache = new Map<string, CachedElevations>();

function cacheKey(lat: number, lng: number, gridSize: number, cellSizeMeters: number): string {
  // Round lat/lng to 4 decimals (~11 m). Repeated clicks within the same
  // 11 m square share the same elevation data — that's well below grid
  // resolution so it's a sound approximation.
  return `${lat.toFixed(4)},${lng.toFixed(4)},${gridSize},${cellSizeMeters}`;
}

export async function sampleElevations(
  viewer: CesiumViewer,
  centerLat: number,
  centerLng: number,
  gridSize: number,
  cellSizeMeters: number,
): Promise<Float32Array> {
  const key = cacheKey(centerLat, centerLng, gridSize, cellSizeMeters);
  const cached = elevationCache.get(key);
  if (cached) {
    if (cached.promise) return cached.promise;
    return cached.data;
  }

  const elevations = new Float32Array(gridSize * gridSize);
  const provider = viewer.terrainProvider;
  if (!provider) return elevations;

  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const halfGrid = gridSize / 2;
  // Cut sample density 4x (gridSize/50 → gridSize/20). At gridSize=600 this
  // drops samples from 2500 → ~400. Bilinear interpolation between samples
  // keeps slopes smooth; the simulation doesn't need finer terrain detail
  // than that.
  const sampleStep = Math.max(1, Math.floor(gridSize / 20));

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

  const promise = (async () => {
    try {
      const sampled = await sampleTerrainMostDetailed(provider, positions);

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
    elevationCache.set(key, { data: elevations, promise: null });
    return elevations;
  })();

  elevationCache.set(key, { data: elevations, promise });
  return promise;
}
