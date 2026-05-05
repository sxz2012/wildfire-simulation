import { useEffect, useRef } from "react";
import {
  SingleTileImageryProvider,
  Rectangle,
  ImageryLayer,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import { CellState, type SimulationConfig } from "../simulation/types";

interface GhostFireOverlayProps {
  baselineSnapshot: Uint8Array | null;
  suppressedSnapshot: Uint8Array | null;
  centerLat: number;
  centerLng: number;
  config: SimulationConfig;
  viewer: CesiumViewer | null;
  alpha?: number;
}

const burnedLike = (s: number) =>
  s === CellState.Burning || s === CellState.Burned;

/**
 * Counterfactual fire overlay: cells that burned in the BASELINE run
 * but did NOT burn (and aren't fireline) in the SUPPRESSED run. Shown
 * as a translucent red tint so the user can see the area suppression
 * saved without needing two side-by-side maps.
 */
export default function GhostFireOverlay({
  baselineSnapshot,
  suppressedSnapshot,
  centerLat,
  centerLng,
  config,
  viewer,
  alpha = 0.25,
}: GhostFireOverlayProps) {
  const layerRef = useRef<ImageryLayer | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !baselineSnapshot || !suppressedSnapshot) return;

    const { gridSize, cellSizeMeters } = config;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
    const halfGrid = gridSize / 2;
    const halfLat = (halfGrid * cellSizeMeters) / metersPerDegreeLat;
    const halfLng = (halfGrid * cellSizeMeters) / metersPerDegreeLng;

    const canvas = document.createElement("canvas");
    canvas.width = gridSize;
    canvas.height = gridSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imgData = ctx.createImageData(gridSize, gridSize);
    const px = imgData.data;

    let count = 0;
    for (let row = 0; row < gridSize; row++) {
      const canvasRow = gridSize - 1 - row;
      for (let col = 0; col < gridSize; col++) {
        const idx = row * gridSize + col;
        if (!burnedLike(baselineSnapshot[idx])) continue;
        if (burnedLike(suppressedSnapshot[idx])) continue;
        if (suppressedSnapshot[idx] === CellState.Suppressed) continue;
        count++;
        const i = (canvasRow * gridSize + col) * 4;
        px[i] = 220;     // counterfactual red R
        px[i + 1] = 60;  // G
        px[i + 2] = 30;  // B
        px[i + 3] = 255; // A — full pixel; layer-level alpha controls transparency
      }
    }
    if (count === 0) return;
    ctx.putImageData(imgData, 0, 0);

    let cancelled = false;
    let createdLayer: ImageryLayer | null = null;

    SingleTileImageryProvider.fromUrl(canvas.toDataURL("image/png"), {
      rectangle: Rectangle.fromDegrees(
        centerLng - halfLng, centerLat - halfLat,
        centerLng + halfLng, centerLat + halfLat,
      ),
    })
      .then((provider) => {
        if (cancelled || !viewer || viewer.isDestroyed()) return;
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = alpha;
        layerRef.current = layer;
        createdLayer = layer;
      })
      .catch((err) => console.warn("GhostFireOverlay failed:", err));

    return () => {
      cancelled = true;
      const layer = layerRef.current ?? createdLayer;
      if (layer && viewer && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layer);
      }
      layerRef.current = null;
    };
  }, [viewer, baselineSnapshot, suppressedSnapshot, centerLat, centerLng, config, alpha]);

  return null;
}
