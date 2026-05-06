import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  BillboardCollection,
  HeightReference,
  VerticalOrigin,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import type { SimulationState, SimulationConfig, SuppressionConfig } from "../simulation/types";
import { groundPositions, type LatLng } from "../utils/groundPositions";
import { perTypeCounts } from "../utils/perTypeCounts";

interface SuppressionVehicleLayerProps {
  viewer: CesiumViewer | null;
  prev: SimulationState | null;
  curr: SimulationState;
  config: SimulationConfig;
  centerLat: number;
  centerLng: number;
  suppression: SuppressionConfig;
  deployStep: number;
  endStep: number;
  currentStep: number;
}

function createColoredDisc(size: number, fillColor: string, letter: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.floor(size * 0.55)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, size / 2, size / 2 + 1);
  return canvas;
}

export default function SuppressionVehicleLayer({
  viewer,
  prev,
  curr,
  config,
  centerLat,
  centerLng,
  suppression,
  deployStep,
  endStep,
  currentStep,
}: SuppressionVehicleLayerProps): null {
  const collectionRef = useRef<BillboardCollection | null>(null);
  const lastFramePos = useRef<{ engines: LatLng[]; crews: LatLng[]; dozers: LatLng[] }>({
    engines: [],
    crews: [],
    dozers: [],
  });

  const engineImage = useMemo(() => createColoredDisc(48, "#dc2626", "E"), []);
  const crewImage = useMemo(() => createColoredDisc(48, "#facc15", "C"), []);
  const dozerImage = useMemo(() => createColoredDisc(48, "#f97316", "D"), []);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const collection = new BillboardCollection();
    viewer.scene.primitives.add(collection);
    collectionRef.current = collection;
    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(collection);
      }
      collectionRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const collection = collectionRef.current;
    if (!collection) return;

    const counts = perTypeCounts({
      bundle: suppression.resources,
      step: currentStep,
      deployStep,
      endStep,
    });

    const enginePositions = groundPositions(
      prev,
      curr,
      config,
      centerLat,
      centerLng,
      counts.engines,
      lastFramePos.current.engines,
    );
    const crewPositions = groundPositions(
      prev,
      curr,
      config,
      centerLat,
      centerLng,
      counts.crews,
      lastFramePos.current.crews,
    );
    const dozerPositions = groundPositions(
      prev,
      curr,
      config,
      centerLat,
      centerLng,
      counts.dozers,
      lastFramePos.current.dozers,
    );

    lastFramePos.current.engines = enginePositions;
    lastFramePos.current.crews = crewPositions;
    lastFramePos.current.dozers = dozerPositions;

    collection.removeAll();

    for (const pos of enginePositions) {
      collection.add({
        position: Cartesian3.fromDegrees(pos.lng, pos.lat),
        image: engineImage,
        scale: 1.0,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      });
    }
    for (const pos of crewPositions) {
      collection.add({
        position: Cartesian3.fromDegrees(pos.lng, pos.lat),
        image: crewImage,
        scale: 1.0,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      });
    }
    for (const pos of dozerPositions) {
      collection.add({
        position: Cartesian3.fromDegrees(pos.lng, pos.lat),
        image: dozerImage,
        scale: 1.0,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      });
    }
  }, [
    viewer,
    prev,
    curr,
    config,
    centerLat,
    centerLng,
    suppression,
    deployStep,
    endStep,
    currentStep,
    engineImage,
    crewImage,
    dozerImage,
  ]);

  return null;
}
