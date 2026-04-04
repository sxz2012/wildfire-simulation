import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  Color,
  VerticalOrigin,
  BillboardCollection,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import {
  CellState,
  type SimulationState,
  type SimulationConfig,
} from "../simulation/types";

interface FireParticlesProps {
  state: SimulationState | null;
  config: SimulationConfig;
  centerLat: number;
  centerLng: number;
  viewer: CesiumViewer | null;
}

export default function FireParticles({
  state,
  config,
  centerLat,
  centerLng,
  viewer,
}: FireParticlesProps) {
  const collectionRef = useRef<BillboardCollection | null>(null);

  // Create a small canvas-based fire icon
  const fireImage = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, "rgba(255, 200, 50, 0.9)");
    gradient.addColorStop(0.5, "rgba(255, 100, 0, 0.7)");
    gradient.addColorStop(1, "rgba(255, 50, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 16);
    return canvas;
  }, []);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // Remove previous collection
    if (collectionRef.current) {
      viewer.scene.primitives.remove(collectionRef.current);
      collectionRef.current = null;
    }

    if (!state) return;

    const { gridSize, cellSizeMeters } = config;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
    const halfGrid = gridSize / 2;
    const cellLat = cellSizeMeters / metersPerDegreeLat;
    const cellLng = cellSizeMeters / metersPerDegreeLng;

    const frontCells: Cartesian3[] = [];

    for (let row = 1; row < gridSize - 1; row++) {
      for (let col = 1; col < gridSize - 1; col++) {
        if (state.grid[row * gridSize + col] !== CellState.Burning) continue;

        const hasUnburnedNeighbor = [
          state.grid[(row - 1) * gridSize + col],
          state.grid[(row + 1) * gridSize + col],
          state.grid[row * gridSize + col - 1],
          state.grid[row * gridSize + col + 1],
        ].some((s) => s === CellState.Unburned);

        if (!hasUnburnedNeighbor) continue;

        const lat = centerLat + (row - halfGrid) * cellLat;
        const lng = centerLng + (col - halfGrid) * cellLng;
        frontCells.push(Cartesian3.fromDegrees(lng, lat, 100));
      }
    }

    // Sample max 100 positions for performance
    let positions = frontCells;
    if (positions.length > 100) {
      const step = Math.ceil(positions.length / 100);
      positions = positions.filter((_, i) => i % step === 0);
    }

    if (positions.length === 0) return;

    const billboards = viewer.scene.primitives.add(new BillboardCollection());
    collectionRef.current = billboards;

    for (const pos of positions) {
      billboards.add({
        position: pos,
        image: fireImage,
        width: 20,
        height: 20,
        verticalOrigin: VerticalOrigin.BOTTOM,
        color: Color.WHITE,
        scale: 1.5,
      });
    }

    return () => {
      if (collectionRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(collectionRef.current);
        collectionRef.current = null;
      }
    };
  }, [state, config, centerLat, centerLng, viewer, fireImage]);

  return null;
}
