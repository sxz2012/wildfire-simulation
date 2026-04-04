import { useEffect, useRef } from "react";
import {
  Rectangle,
  SingleTileImageryProvider,
  ImageryLayer,
} from "cesium";
import {
  CellState,
  type SimulationState,
  type SimulationConfig,
} from "../simulation/types";
import type { Viewer as CesiumViewer } from "cesium";

interface FireOverlayProps {
  state: SimulationState | null;
  previousState: SimulationState | null; // state from ~5 steps ago for "recently burned" detection
  config: SimulationConfig;
  centerLat: number;
  centerLng: number;
  viewer: CesiumViewer | null;
}

export default function FireOverlay({
  state,
  previousState,
  config,
  centerLat,
  centerLng,
  viewer,
}: FireOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef<ImageryLayer | null>(null);

  useEffect(() => {
    if (!viewer || !state) {
      // Remove existing layer if state is null
      if (layerRef.current && viewer && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layerRef.current);
        layerRef.current = null;
      }
      return;
    }

    const { gridSize, cellSizeMeters } = config;

    // Create or reuse canvas
    if (
      !canvasRef.current ||
      canvasRef.current.width !== gridSize ||
      canvasRef.current.height !== gridSize
    ) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = gridSize;
      canvasRef.current.height = gridSize;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(gridSize, gridSize);
    const data = imageData.data;

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const idx = row * gridSize + col;
        const cellState = state.grid[idx];
        const pixelIndex = idx * 4;

        if (cellState === CellState.Burning) {
          // Bright orange — actively burning
          data[pixelIndex] = 255;
          data[pixelIndex + 1] = 165;
          data[pixelIndex + 2] = 0;
          data[pixelIndex + 3] = 200;
        } else if (cellState === CellState.Burned) {
          // Check if recently burned (was Burning 5 steps ago)
          const wasRecentlyBurning =
            previousState && previousState.grid[idx] === CellState.Burning;
          if (wasRecentlyBurning) {
            // Dark red — recently burned
            data[pixelIndex] = 180;
            data[pixelIndex + 1] = 30;
            data[pixelIndex + 2] = 30;
            data[pixelIndex + 3] = 180;
          } else {
            // Charcoal — fully burned out
            data[pixelIndex] = 50;
            data[pixelIndex + 1] = 50;
            data[pixelIndex + 2] = 50;
            data[pixelIndex + 3] = 160;
          }
        } else {
          data[pixelIndex + 3] = 0; // Transparent
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Compute the geographic extent of the grid
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng =
      111320 * Math.cos((centerLat * Math.PI) / 180);
    const halfExtentLat =
      ((gridSize / 2) * cellSizeMeters) / metersPerDegreeLat;
    const halfExtentLng =
      ((gridSize / 2) * cellSizeMeters) / metersPerDegreeLng;

    const rectangle = Rectangle.fromDegrees(
      centerLng - halfExtentLng,
      centerLat - halfExtentLat,
      centerLng + halfExtentLng,
      centerLat + halfExtentLat,
    );

    // Remove old layer
    if (layerRef.current && !viewer.isDestroyed()) {
      viewer.imageryLayers.remove(layerRef.current);
      layerRef.current = null;
    }

    // Add new imagery layer from canvas
    const provider = new SingleTileImageryProvider({
      url: canvas.toDataURL(),
      rectangle,
      tileWidth: gridSize,
      tileHeight: gridSize,
    });

    layerRef.current = viewer.imageryLayers.addImageryProvider(provider);

    // No cleanup return here — we manage the layer lifecycle above.
    // Returning a cleanup would remove the layer on every re-render before the
    // next effect runs, causing flicker.
  }, [state, config, centerLat, centerLng, viewer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (layerRef.current && viewer && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [viewer]);

  return null; // This component renders imperatively, no JSX output
}
