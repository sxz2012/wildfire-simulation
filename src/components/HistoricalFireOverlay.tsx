import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  Color,
  Entity,
  PolygonHierarchy,
  ClassificationType,
  ColorMaterialProperty,
  HeightReference,
  LabelStyle,
  VerticalOrigin,
  HorizontalOrigin,
  NearFarScalar,
  BillboardCollection,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import type { HistoricalFire } from "../data/historicalFires";
import {
  computeFirePerimeter,
  computeCentroid,
  estimateAreaHectares,
  formatAcres,
} from "../utils/concaveHull";

interface HistoricalFireOverlayProps {
  fire: HistoricalFire;
  currentFrame: number;
  viewer: CesiumViewer | null;
}

function createSmokeImage(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(180, 180, 180, 0.35)");
  gradient.addColorStop(0.4, "rgba(140, 140, 140, 0.2)");
  gradient.addColorStop(1, "rgba(100, 100, 100, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

/** Interpolate color from light amber (old burn) to deep orange (recent burn) */
function burnColor(age: number, totalLayers: number): Color {
  const t = totalLayers > 1 ? age / (totalLayers - 1) : 1;
  const r = 1.0;
  const g = 0.85 - t * 0.35;
  const b = 0.2 - t * 0.15;
  const a = 0.25 + t * 0.2;
  return new Color(r, g, b, a);
}

export default function HistoricalFireOverlay({
  fire,
  currentFrame,
  viewer,
}: HistoricalFireOverlayProps) {
  const entitiesRef = useRef<Entity[]>([]);
  const smokeRef = useRef<BillboardCollection | null>(null);
  const smokeImage = useMemo(() => createSmokeImage(), []);

  // Pre-compute cumulative hotspot positions and perimeters per frame
  const frameData = useMemo(() => {
    const cumulative: [number, number][] = [];
    const seen = new Set<string>();
    const result: {
      cumulativePerimeter: [number, number][];
      framePerimeter: [number, number][];
      cumulativeCount: number;
      centroid: [number, number];
    }[] = [];

    for (const frame of fire.frames) {
      for (const h of frame.hotspots) {
        const key = `${h.lat.toFixed(4)},${h.lng.toFixed(4)}`;
        if (!seen.has(key)) {
          seen.add(key);
          cumulative.push([h.lng, h.lat]);
        }
      }

      const cumulativePerimeter = computeFirePerimeter(cumulative.slice());
      const framePoints: [number, number][] = frame.hotspots.map((h) => [h.lng, h.lat]);
      const framePerimeter = computeFirePerimeter(framePoints);
      const centroid: [number, number] = cumulative.length > 0
        ? computeCentroid(cumulative)
        : [fire.location.lng, fire.location.lat];

      result.push({
        cumulativePerimeter,
        framePerimeter,
        cumulativeCount: cumulative.length,
        centroid,
      });
    }

    return result;
  }, [fire]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // Cleanup previous
    for (const entity of entitiesRef.current) {
      viewer.entities.remove(entity);
    }
    entitiesRef.current = [];
    if (smokeRef.current) {
      viewer.scene.primitives.remove(smokeRef.current);
      smokeRef.current = null;
    }

    if (currentFrame < 0 || currentFrame >= frameData.length) return;

    const current = frameData[currentFrame];
    if (current.cumulativePerimeter.length < 3) return;

    // --- Layer 1: Layered burn polygons with temporal shading ---
    const layerCount = Math.min(currentFrame + 1, 5);
    const framesPerLayer = Math.max(1, Math.ceil((currentFrame + 1) / layerCount));

    for (let layer = 0; layer < layerCount; layer++) {
      const layerEndFrame = Math.min((layer + 1) * framesPerLayer - 1, currentFrame);
      const data = frameData[layerEndFrame];
      if (data.cumulativePerimeter.length < 3) continue;

      const positions = data.cumulativePerimeter.map(([lng, lat]) =>
        Cartesian3.fromDegrees(lng, lat)
      );

      const color = burnColor(layer, layerCount);

      const entity = viewer.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(positions),
          material: new ColorMaterialProperty(color),
          classificationType: ClassificationType.BOTH,
        },
      });
      entitiesRef.current.push(entity);
    }

    // --- Layer 2: Active fire perimeter outline (red) ---
    const outlinePositions = current.cumulativePerimeter.map(([lng, lat]) =>
      Cartesian3.fromDegrees(lng, lat)
    );
    if (outlinePositions.length > 0) {
      outlinePositions.push(outlinePositions[0]);
    }

    const outlineEntity = viewer.entities.add({
      polyline: {
        positions: outlinePositions,
        width: 3,
        material: Color.fromCssColorString("#DC2626"),
        clampToGround: true,
      },
    });
    entitiesRef.current.push(outlineEntity);

    // --- Layer 3: Active frame perimeter (glowing orange, thicker) ---
    if (current.framePerimeter.length >= 3) {
      const activePositions = current.framePerimeter.map(([lng, lat]) =>
        Cartesian3.fromDegrees(lng, lat)
      );
      activePositions.push(activePositions[0]);

      const activeOutline = viewer.entities.add({
        polyline: {
          positions: activePositions,
          width: 4,
          material: Color.fromCssColorString("#FF6B00"),
          clampToGround: true,
        },
      });
      entitiesRef.current.push(activeOutline);
    }

    // --- Layer 4: Center label with fire name + acreage ---
    const [cLng, cLat] = current.centroid;
    const areaHa = estimateAreaHectares(current.cumulativeCount);
    const labelText = `${fire.name.replace(/ \(.*\)$/, "")}\n${formatAcres(areaHa)}`;

    const labelEntity = viewer.entities.add({
      position: Cartesian3.fromDegrees(cLng, cLat, 0),
      label: {
        text: labelText,
        font: "bold 16px DM Sans, sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.CENTER,
        horizontalOrigin: HorizontalOrigin.CENTER,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1000, 1.2, 200000, 0.4),
      },
    });
    entitiesRef.current.push(labelEntity);

    // --- Layer 5: Sparse smoke billboards at active perimeter ---
    if (current.framePerimeter.length > 0) {
      const smokeBillboards = new BillboardCollection();
      viewer.scene.primitives.add(smokeBillboards);
      smokeRef.current = smokeBillboards;

      const smokeStep = Math.max(1, Math.ceil(current.framePerimeter.length / 20));
      const windAngle = (Math.PI / 4) * 0.7;
      const driftLat = Math.cos(windAngle) * 0.008;
      const driftLng = Math.sin(windAngle) * 0.008;

      for (let i = 0; i < current.framePerimeter.length; i += smokeStep) {
        const [lng, lat] = current.framePerimeter[i];
        for (let s = 1; s <= 2; s++) {
          const jLat = (Math.random() - 0.5) * 0.003;
          const jLng = (Math.random() - 0.5) * 0.003;
          smokeBillboards.add({
            position: Cartesian3.fromDegrees(
              lng + driftLng * s + jLng,
              lat + driftLat * s + jLat,
              600 + s * 400 + Math.random() * 300
            ),
            image: smokeImage,
            width: 30 + s * 15,
            height: 30 + s * 15,
            color: Color.WHITE.withAlpha(0.5 - s * 0.15),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
        }
      }
    }

    return () => {
      if (!viewer || viewer.isDestroyed()) return;
      for (const entity of entitiesRef.current) {
        viewer.entities.remove(entity);
      }
      entitiesRef.current = [];
      if (smokeRef.current) {
        viewer.scene.primitives.remove(smokeRef.current);
        smokeRef.current = null;
      }
    };
  }, [viewer, currentFrame, frameData, fire.name, smokeImage]);

  return null;
}
