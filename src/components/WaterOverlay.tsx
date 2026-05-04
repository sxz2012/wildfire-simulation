import { useEffect, useRef } from "react";
import {
  SingleTileImageryProvider,
  Rectangle,
  ImageryLayer,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import { FuelType, type SimulationConfig } from "../simulation/types";

interface WaterOverlayProps {
  fuelMap: FuelType[];
  centerLat: number;
  centerLng: number;
  config: SimulationConfig;
  viewer: CesiumViewer | null;
  /** Layer opacity (0-1). Default 0.45 — visible over base map but not opaque. */
  alpha?: number;
}

/**
 * Renders a translucent blue tint over Water-classified grid cells.
 *
 * Useful both as a visualization (lets the user SEE which cells the sim
 * treats as water) and as confirmation that fire stops at the right
 * boundary. Built from the same fuelMap the simulation runs on, so the
 * overlay is exact.
 */
export default function WaterOverlay({
  fuelMap,
  centerLat,
  centerLng,
  config,
  viewer,
  alpha = 0.45,
}: WaterOverlayProps) {
  const layerRef = useRef<ImageryLayer | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !fuelMap) return;

    const { gridSize, cellSizeMeters } = config;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
    const halfGrid = gridSize / 2;
    const halfLatExtent = (halfGrid * cellSizeMeters) / metersPerDegreeLat;
    const halfLngExtent = (halfGrid * cellSizeMeters) / metersPerDegreeLng;

    // Build a canvas where Water cells are blue and everything else is
    // transparent. Grid row 0 is the southern edge; canvas pixel row 0 is
    // the top of the image (north). Flip rows when writing pixels.
    const canvas = document.createElement("canvas");
    canvas.width = gridSize;
    canvas.height = gridSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imgData = ctx.createImageData(gridSize, gridSize);
    const px = imgData.data;

    let waterCount = 0;
    for (let row = 0; row < gridSize; row++) {
      const canvasRow = gridSize - 1 - row;
      for (let col = 0; col < gridSize; col++) {
        if (fuelMap[row * gridSize + col] !== FuelType.Water) continue;
        waterCount++;
        const i = (canvasRow * gridSize + col) * 4;
        px[i] = 60; // R — slightly muted blue
        px[i + 1] = 130; // G
        px[i + 2] = 220; // B
        px[i + 3] = 255; // A — full pixel; layer-level alpha controls transparency
      }
    }
    if (waterCount === 0) return;
    ctx.putImageData(imgData, 0, 0);

    let cancelled = false;
    let createdLayer: ImageryLayer | null = null;

    SingleTileImageryProvider.fromUrl(canvas.toDataURL("image/png"), {
      rectangle: Rectangle.fromDegrees(
        centerLng - halfLngExtent,
        centerLat - halfLatExtent,
        centerLng + halfLngExtent,
        centerLat + halfLatExtent,
      ),
    })
      .then((provider) => {
        if (cancelled || !viewer || viewer.isDestroyed()) return;
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = alpha;
        layerRef.current = layer;
        createdLayer = layer;
      })
      .catch((err) => {
        console.warn("WaterOverlay failed to create imagery layer:", err);
      });

    return () => {
      cancelled = true;
      const layer = layerRef.current ?? createdLayer;
      if (layer && viewer && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layer);
      }
      layerRef.current = null;
    };
  }, [viewer, fuelMap, centerLat, centerLng, config, alpha]);

  return null;
}
