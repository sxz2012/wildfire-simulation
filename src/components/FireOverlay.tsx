import { useMemo } from "react";
import { Entity, RectangleGraphics } from "resium";
import { Rectangle, Color, ClassificationType } from "cesium";
import {
  CellState,
  type SimulationState,
  type SimulationConfig,
} from "../simulation/types";

interface FireOverlayProps {
  state: SimulationState | null;
  config: SimulationConfig;
  centerLat: number;
  centerLng: number;
}

export default function FireOverlay({
  state,
  config,
  centerLat,
  centerLng,
}: FireOverlayProps) {
  const cells = useMemo(() => {
    if (!state) return [];

    const { gridSize, cellSizeMeters } = config;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng =
      111320 * Math.cos((centerLat * Math.PI) / 180);
    const halfGrid = gridSize / 2;
    const cellLat = cellSizeMeters / metersPerDegreeLat;
    const cellLng = cellSizeMeters / metersPerDegreeLng;

    const result: { key: string; rect: Rectangle; color: Color }[] = [];

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cellState = state.grid[row * gridSize + col];
        if (cellState === CellState.Unburned) continue;

        const lat = centerLat + (row - halfGrid) * cellLat;
        const lng = centerLng + (col - halfGrid) * cellLng;

        const rect = Rectangle.fromDegrees(
          lng - cellLng / 2,
          lat - cellLat / 2,
          lng + cellLng / 2,
          lat + cellLat / 2
        );

        const color =
          cellState === CellState.Burning
            ? Color.ORANGE.withAlpha(0.7)
            : Color.BLACK.withAlpha(0.5);

        result.push({ key: `${row}-${col}`, rect, color });
      }
    }

    return result;
  }, [state, config, centerLat, centerLng]);

  return (
    <>
      {cells.map(({ key, rect, color }) => (
        <Entity key={key}>
          <RectangleGraphics
            coordinates={rect}
            material={color}
            classificationType={ClassificationType.BOTH}
          />
        </Entity>
      ))}
    </>
  );
}
