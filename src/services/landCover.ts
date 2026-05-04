import { fromUrl } from "geotiff";
import { FuelType } from "../simulation/types";

/**
 * ESA WorldCover (v200, 2021) class codes — 10m global land cover dataset.
 * See https://esa-worldcover.org/en/data-access for details.
 */
export const WORLDCOVER = {
  TREE: 10,
  SHRUBLAND: 20,
  GRASSLAND: 30,
  CROPLAND: 40,
  BUILT_UP: 50,
  BARE: 60,
  SNOW_ICE: 70,
  WATER: 80,
  HERBACEOUS_WETLAND: 90,
  MANGROVE: 95,
  MOSS_LICHEN: 100,
} as const;

/**
 * Map a WorldCover code to the simulation's FuelType. Non-flammable classes
 * (water, snow, urban, bare, wetlands) are mapped to Water, which the
 * simulation treats as a hard non-spread cell.
 */
export function worldCoverToFuel(code: number): FuelType {
  switch (code) {
    case WORLDCOVER.TREE:
      return FuelType.Forest;
    case WORLDCOVER.SHRUBLAND:
      return FuelType.Shrub;
    case WORLDCOVER.GRASSLAND:
    case WORLDCOVER.CROPLAND:
      return FuelType.Grass;
    case WORLDCOVER.WATER:
    case WORLDCOVER.SNOW_ICE:
    case WORLDCOVER.BUILT_UP:
    case WORLDCOVER.BARE:
    case WORLDCOVER.HERBACEOUS_WETLAND:
    case WORLDCOVER.MANGROVE:
    case WORLDCOVER.MOSS_LICHEN:
      return FuelType.Water;
    default:
      return FuelType.Grass;
  }
}

const TILE_DEGREES = 3;
// Microsoft Planetary Computer hosts the WorldCover COGs in Azure Blob Storage.
// Reads require a SAS token (free, no auth) issued by Planetary Computer's
// token endpoint. Tokens last ~45 minutes; we cache and refresh as needed.
const BASE_URL =
  "https://ai4edataeuwest.blob.core.windows.net/esa-worldcover/v200/2021/map";
const SAS_ENDPOINT =
  "https://planetarycomputer.microsoft.com/api/sas/v1/token/esa-worldcover";

interface SasToken {
  token: string;
  expiresAt: number; // ms since epoch
}

let cachedSasToken: SasToken | null = null;

async function getSasToken(): Promise<string> {
  const now = Date.now();
  // Refresh if missing or within 60s of expiry.
  if (cachedSasToken && cachedSasToken.expiresAt - now > 60_000) {
    return cachedSasToken.token;
  }
  const res = await fetch(SAS_ENDPOINT);
  if (!res.ok) {
    throw new Error(`SAS token request failed: ${res.status}`);
  }
  const body = (await res.json()) as { token: string; "msft:expiry"?: string };
  cachedSasToken = {
    token: body.token,
    expiresAt: body["msft:expiry"]
      ? Date.parse(body["msft:expiry"])
      : now + 45 * 60_000,
  };
  return cachedSasToken.token;
}

/** WorldCover tiles are 3°×3° and named by their southwest corner (e.g. N36W123). */
function tileNameFor(lat: number, lng: number): string {
  const tileLat = Math.floor(lat / TILE_DEGREES) * TILE_DEGREES;
  const tileLng = Math.floor(lng / TILE_DEGREES) * TILE_DEGREES;
  const ns = tileLat >= 0 ? "N" : "S";
  const ew = tileLng >= 0 ? "E" : "W";
  const latStr = String(Math.abs(tileLat)).padStart(2, "0");
  const lngStr = String(Math.abs(tileLng)).padStart(3, "0");
  return `${ns}${latStr}${ew}${lngStr}`;
}

function parseTileName(name: string): { minLat: number; minLng: number } {
  const ns = name[0];
  const lat = parseInt(name.slice(1, 3), 10) * (ns === "N" ? 1 : -1);
  const ew = name[3];
  const lng = parseInt(name.slice(4, 7), 10) * (ew === "E" ? 1 : -1);
  return { minLat: lat, minLng: lng };
}

function tileUrlFor(name: string, sasToken: string): string {
  // Filename is mixed-case as hosted by Planetary Computer
  // (ESA_WorldCover_10m_2021_v200_<TILE>_Map.tif), even though ESA's own
  // distribution uses all-caps. Match Planetary Computer's casing.
  return `${BASE_URL}/ESA_WorldCover_10m_2021_v200_${name}_Map.tif?${sasToken}`;
}

interface FetchedTile {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  data: Uint8Array;
  windowColMin: number;
  windowRowMin: number;
  windowWidth: number;
  windowHeight: number;
  tileWidth: number;
  tileHeight: number;
}

/**
 * Sample ESA WorldCover land cover for a simulation grid centered at
 * (centerLat, centerLng).
 *
 * Reads only the relevant pixel window from the WorldCover Cloud-Optimized
 * GeoTIFFs via HTTP range requests (typical: a few hundred KB downloaded
 * per simulation). Returns a FuelType array matching the grid layout, or
 * null if any required tile fails to load.
 *
 * Handles grids that span multiple WorldCover tiles by fetching tiles in
 * parallel.
 */
export async function sampleLandCover(
  centerLat: number,
  centerLng: number,
  gridSize: number,
  cellSizeMeters: number,
): Promise<FuelType[] | null> {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const halfGrid = gridSize / 2;

  // Precompute lat/lng for every row and column.
  const cellLats = new Float64Array(gridSize);
  const cellLngs = new Float64Array(gridSize);
  for (let row = 0; row < gridSize; row++) {
    cellLats[row] =
      centerLat + ((row - halfGrid) * cellSizeMeters) / metersPerDegreeLat;
  }
  for (let col = 0; col < gridSize; col++) {
    cellLngs[col] =
      centerLng + ((col - halfGrid) * cellSizeMeters) / metersPerDegreeLng;
  }

  // Determine the minimal set of tiles covering the grid (corners + center
  // are enough for any 20km grid; tiles are 3° ~ 330 km wide).
  const tileSet = new Set<string>();
  const corners: Array<[number, number]> = [
    [0, 0],
    [0, gridSize - 1],
    [gridSize - 1, 0],
    [gridSize - 1, gridSize - 1],
    [halfGrid, halfGrid],
  ];
  for (const [r, c] of corners) {
    tileSet.add(tileNameFor(cellLats[r], cellLngs[c]));
  }

  // Sign once per call and reuse for every tile.
  let sasToken: string;
  try {
    sasToken = await getSasToken();
  } catch (err) {
    console.warn("Failed to obtain WorldCover SAS token:", err);
    return null;
  }

  // Fetch each unique tile in parallel, reading only the window we need.
  const fetched = await Promise.all(
    Array.from(tileSet).map(async (name): Promise<[string, FetchedTile] | null> => {
      try {
        const tiff = await fromUrl(tileUrlFor(name, sasToken));
        const image = await tiff.getImage();
        const tileWidth = image.getWidth();
        const tileHeight = image.getHeight();

        const { minLat, minLng } = parseTileName(name);
        const maxLat = minLat + TILE_DEGREES;
        const maxLng = minLng + TILE_DEGREES;

        // Find the lat/lng bounds of cells that fall in this tile.
        let cellMinLat = Infinity,
          cellMaxLat = -Infinity;
        let cellMinLng = Infinity,
          cellMaxLng = -Infinity;
        for (let r = 0; r < gridSize; r++) {
          const lat = cellLats[r];
          if (lat < minLat || lat >= maxLat) continue;
          for (let c = 0; c < gridSize; c++) {
            const lng = cellLngs[c];
            if (lng < minLng || lng >= maxLng) continue;
            if (lat < cellMinLat) cellMinLat = lat;
            if (lat > cellMaxLat) cellMaxLat = lat;
            if (lng < cellMinLng) cellMinLng = lng;
            if (lng > cellMaxLng) cellMaxLng = lng;
          }
        }
        if (cellMinLat === Infinity) return null;

        // Convert to pixel window. Note: tile rows go top-to-bottom (north-to-south).
        const colMin = Math.max(
          0,
          Math.floor(((cellMinLng - minLng) / TILE_DEGREES) * tileWidth),
        );
        const colMax = Math.min(
          tileWidth,
          Math.ceil(((cellMaxLng - minLng) / TILE_DEGREES) * tileWidth) + 1,
        );
        const rowMin = Math.max(
          0,
          Math.floor(((maxLat - cellMaxLat) / TILE_DEGREES) * tileHeight),
        );
        const rowMax = Math.min(
          tileHeight,
          Math.ceil(((maxLat - cellMinLat) / TILE_DEGREES) * tileHeight) + 1,
        );

        const rasters = await image.readRasters({
          window: [colMin, rowMin, colMax, rowMax],
        });
        const data = rasters[0] as Uint8Array;

        return [
          name,
          {
            minLat,
            minLng,
            maxLat,
            maxLng,
            data,
            windowColMin: colMin,
            windowRowMin: rowMin,
            windowWidth: colMax - colMin,
            windowHeight: rowMax - rowMin,
            tileWidth,
            tileHeight,
          },
        ];
      } catch (err) {
        console.warn(`WorldCover tile ${name} failed:`, err);
        return null;
      }
    }),
  );

  const tiles = fetched.filter((t): t is [string, FetchedTile] => t !== null);
  if (tiles.length === 0) return null;
  const tileMap = new Map(tiles);

  // For every cell, look up the WorldCover code in the appropriate tile.
  const fuels: FuelType[] = new Array(gridSize * gridSize);

  for (let row = 0; row < gridSize; row++) {
    const lat = cellLats[row];
    for (let col = 0; col < gridSize; col++) {
      const lng = cellLngs[col];
      const idx = row * gridSize + col;

      const tile = tileMap.get(tileNameFor(lat, lng));
      if (!tile) {
        fuels[idx] = FuelType.Grass;
        continue;
      }

      const tileCol = Math.floor(
        ((lng - tile.minLng) / TILE_DEGREES) * tile.tileWidth,
      );
      const tileRow = Math.floor(
        ((tile.maxLat - lat) / TILE_DEGREES) * tile.tileHeight,
      );
      const localCol = tileCol - tile.windowColMin;
      const localRow = tileRow - tile.windowRowMin;

      if (
        localCol < 0 ||
        localCol >= tile.windowWidth ||
        localRow < 0 ||
        localRow >= tile.windowHeight
      ) {
        fuels[idx] = FuelType.Grass;
        continue;
      }

      const code = tile.data[localRow * tile.windowWidth + localCol];
      fuels[idx] = worldCoverToFuel(code);
    }
  }

  return fuels;
}
