import { useEffect, useRef } from "react";
import {
  SingleTileImageryProvider,
  Rectangle,
  ImageryLayer,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import { CellState, type SimulationConfig } from "../simulation/types";

interface ContainmentLineLayerProps {
  /** A snapshot of the suppressed run's grid at the current step. */
  gridSnapshot: Uint8Array | null;
  centerLat: number;
  centerLng: number;
  config: SimulationConfig;
  viewer: CesiumViewer | null;
  alpha?: number;
}

/**
 * Paints cells with state=Suppressed as a saturated cyan imagery layer —
 * the growing "containment line" around a successfully suppressed fire.
 */
export default function ContainmentLineLayer({
  gridSnapshot,
  centerLat,
  centerLng,
  config,
  viewer,
  alpha = 0.85,
}: ContainmentLineLayerProps) {
  const layerRef = useRef<ImageryLayer | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !gridSnapshot) return;

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
        if (gridSnapshot[row * gridSize + col] !== CellState.Suppressed) continue;
        count++;
        const i = (canvasRow * gridSize + col) * 4;
        px[i] = 34;      // saturated cyan R (#22d3ee)
        px[i + 1] = 211; // G
        px[i + 2] = 238; // B
        px[i + 3] = 255;
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
      .catch((err) => console.warn("ContainmentLineLayer failed:", err));

    return () => {
      cancelled = true;
      const layer = layerRef.current ?? createdLayer;
      if (layer && viewer && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layer);
      }
      layerRef.current = null;
    };
  }, [viewer, gridSnapshot, centerLat, centerLng, config, alpha]);

  return null;
}
