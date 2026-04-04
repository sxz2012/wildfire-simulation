import { FuelType } from "../simulation/types";
import type { Viewer as CesiumViewer } from "cesium";
import { Cartesian3, SceneTransforms } from "cesium";

/**
 * Sample satellite imagery colors from the Cesium viewer to estimate vegetation type.
 * Green → Forest, Yellow/Brown → Grass, Dark Green → Shrub, Gray/Urban → Grass (low fuel)
 */
function classifyPixelColor(r: number, g: number, b: number): FuelType {
  // Normalize to 0-1
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  // Compute vegetation index from color
  // Green dominance indicates vegetation density
  const greenDominance = gn - (rn + bn) / 2;
  const brightness = (rn + gn + bn) / 3;

  // Very dark (shadows, water) → treat as non-burnable (grass with low spread)
  if (brightness < 0.15) return FuelType.Grass;

  // Strong green → forest
  if (greenDominance > 0.05 && gn > 0.3) return FuelType.Forest;

  // Moderate green → shrub
  if (greenDominance > 0.0 && gn > 0.25) return FuelType.Shrub;

  // Brown/yellow/tan → grass
  return FuelType.Grass;
}

/**
 * Sample vegetation types for a grid of lat/lng positions from the Cesium viewer's rendered imagery.
 * Returns a flat array of FuelType values matching the grid layout.
 */
export function sampleVegetation(
  viewer: CesiumViewer,
  centerLat: number,
  centerLng: number,
  gridSize: number,
  cellSizeMeters: number
): FuelType[] {
  const fuels: FuelType[] = new Array(gridSize * gridSize).fill(FuelType.Shrub);

  const canvas = viewer.scene.canvas as HTMLCanvasElement;
  const ctx = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!ctx) return fuels;

  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const halfGrid = gridSize / 2;

  // Read the entire framebuffer once
  const width = canvas.width;
  const height = canvas.height;
  const pixels = new Uint8Array(width * height * 4);

  // Force a render to ensure the framebuffer is current
  viewer.scene.render();

  const gl = ctx as WebGLRenderingContext;
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // Sample every Nth cell for performance (interpolate the rest)
  const sampleStep = Math.max(1, Math.floor(gridSize / 50));

  for (let row = 0; row < gridSize; row += sampleStep) {
    for (let col = 0; col < gridSize; col += sampleStep) {
      const lat = centerLat + (row - halfGrid) * cellSizeMeters / metersPerDegreeLat;
      const lng = centerLng + (col - halfGrid) * cellSizeMeters / metersPerDegreeLng;

      const cartesian = Cartesian3.fromDegrees(lng, lat, 0);
      const windowPos = SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian);

      if (!windowPos) continue;

      const px = Math.round(windowPos.x);
      const py = Math.round(windowPos.y);

      if (px < 0 || px >= width || py < 0 || py >= height) continue;

      // WebGL framebuffer is flipped vertically
      const fbY = height - 1 - py;
      const pixelIdx = (fbY * width + px) * 4;

      const r = pixels[pixelIdx];
      const g = pixels[pixelIdx + 1];
      const b = pixels[pixelIdx + 2];

      const fuel = classifyPixelColor(r, g, b);

      // Fill surrounding cells with the same value
      for (let dr = 0; dr < sampleStep && row + dr < gridSize; dr++) {
        for (let dc = 0; dc < sampleStep && col + dc < gridSize; dc++) {
          fuels[(row + dr) * gridSize + (col + dc)] = fuel;
        }
      }
    }
  }

  return fuels;
}
