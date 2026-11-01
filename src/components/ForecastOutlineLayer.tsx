import { useEffect, useRef } from "react";
import { BillboardCollection, Cartesian3, HeightReference } from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import { cellCenter } from "../simulation/robot/geo";

interface ForecastOutlineLayerProps {
  viewer: CesiumViewer | null;
  /** Edge cells of the dog's forecast fire at the current step (from forecastEdgeCells). */
  edgeCells: number[];
  gridSize: number;
  cellSizeMeters: number;
  centerLat: number;
  centerLng: number;
}

const DOT_COLOR = "#FFF3A0";
const DOT_PX = 7;

function dotImage(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = DOT_PX * 2;
  const g = c.getContext("2d")!;
  g.fillStyle = DOT_COLOR;
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(DOT_PX, DOT_PX, DOT_PX - 2, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  return c;
}

/** Dotted yellow line where the dog's forecast thinks the fire edge is. */
export default function ForecastOutlineLayer({
  viewer,
  edgeCells,
  gridSize,
  cellSizeMeters,
  centerLat,
  centerLng,
}: ForecastOutlineLayerProps): null {
  const collectionRef = useRef<BillboardCollection | null>(null);
  const imageRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const collection = new BillboardCollection({ scene: viewer.scene });
    viewer.scene.primitives.add(collection);
    collectionRef.current = collection;
    imageRef.current = dotImage();
    return () => {
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(collection);
      collectionRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const collection = collectionRef.current;
    if (!collection || collection.isDestroyed()) return;
    collection.removeAll();
    for (const idx of edgeCells) {
      const ll = cellCenter(idx, gridSize, cellSizeMeters, centerLat, centerLng);
      collection.add({
        position: Cartesian3.fromDegrees(ll.lng, ll.lat),
        image: imageRef.current!,
        width: DOT_PX,
        height: DOT_PX,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
  }, [edgeCells, gridSize, cellSizeMeters, centerLat, centerLng]);

  return null;
}
