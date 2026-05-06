import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  BillboardCollection,
  Color,
  HeightReference,
  VerticalOrigin,
} from "cesium";
import type { Viewer as CesiumViewer, Billboard } from "cesium";
import { CellState } from "../simulation/types";
import type { SimulationState, SimulationConfig, SuppressionConfig } from "../simulation/types";
import { groundPositions, type LatLng } from "../utils/groundPositions";
import { perTypeCounts } from "../utils/perTypeCounts";
import type { DropEvent } from "../utils/dropScheduler";

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
  dropEvents: DropEvent[];
}

function createEmojiBillboard(size: number, fillColor: string, emoji: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = `${Math.floor(size * 0.6)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, size / 2, size / 2 + 1);
  return canvas;
}

function activeFireCentroid(
  state: SimulationState,
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
): { lat: number; lng: number } | null {
  const { gridSize, cellSizeMeters } = config;
  const grid = state.grid;
  const len = grid.length;
  let sumRow = 0;
  let sumCol = 0;
  let count = 0;
  for (let i = 0; i < len; i++) {
    if (grid[i] === CellState.Burning) {
      const row = Math.floor(i / gridSize);
      const col = i - row * gridSize;
      sumRow += row;
      sumCol += col;
      count++;
    }
  }
  if (count === 0) return null;
  const avgRow = sumRow / count;
  const avgCol = sumCol / count;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const cellLat = cellSizeMeters / metersPerDegLat;
  const cellLng = cellSizeMeters / metersPerDegLng;
  const half = gridSize / 2;
  return {
    lat: centerLat + (avgRow - half) * cellLat,
    lng: centerLng + (avgCol - half) * cellLng,
  };
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
  dropEvents,
}: SuppressionVehicleLayerProps): null {
  const groundCollectionRef = useRef<BillboardCollection | null>(null);
  const helitackCollectionRef = useRef<BillboardCollection | null>(null);
  const tankerCollectionRef = useRef<BillboardCollection | null>(null);
  const helitackBillboardsRef = useRef<Billboard[]>([]);
  const tankerBillboardsRef = useRef<Map<number, Billboard>>(new Map());
  const lastFramePos = useRef<{ engines: LatLng[]; crews: LatLng[]; dozers: LatLng[] }>({
    engines: [],
    crews: [],
    dozers: [],
  });

  // Cinematic drive-in paths require glTF heading; deferred to Task 10. Fade-in only for billboards.
  const firstSeenMs = useRef<{
    engines: number | null;
    crews: number | null;
    dozers: number | null;
    helitack: number | null;
  }>({
    engines: null,
    crews: null,
    dozers: null,
    helitack: null,
  });

  const currCachedRef = useRef<SimulationState>(curr);
  const configCachedRef = useRef<SimulationConfig>(config);
  const centerLatCachedRef = useRef<number>(centerLat);
  const centerLngCachedRef = useRef<number>(centerLng);
  const dropEventsCachedRef = useRef<DropEvent[]>(dropEvents);
  const currentStepCachedRef = useRef<number>(currentStep);

  const engineImage = useMemo(() => createEmojiBillboard(64, "#dc2626", "🚒"), []);
  const crewImage = useMemo(() => createEmojiBillboard(64, "#facc15", "👷"), []);
  const dozerImage = useMemo(() => createEmojiBillboard(64, "#f97316", "🚜"), []);
  const helitackImage = useMemo(() => createEmojiBillboard(64, "#3b82f6", "🚁"), []);
  const tankerImage = useMemo(() => createEmojiBillboard(64, "#38bdf8", "✈️"), []);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    // BillboardCollection needs `scene` so heightReference (CLAMP_TO_GROUND)
    // can sample terrain. Without it Cesium throws on first add().
    const groundCollection = new BillboardCollection({ scene: viewer.scene });
    const helitackCollection = new BillboardCollection({ scene: viewer.scene });
    const tankerCollection = new BillboardCollection({ scene: viewer.scene });
    viewer.scene.primitives.add(groundCollection);
    viewer.scene.primitives.add(helitackCollection);
    viewer.scene.primitives.add(tankerCollection);
    groundCollectionRef.current = groundCollection;
    helitackCollectionRef.current = helitackCollection;
    tankerCollectionRef.current = tankerCollection;
    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(groundCollection);
        viewer.scene.primitives.remove(helitackCollection);
        viewer.scene.primitives.remove(tankerCollection);
      }
      groundCollectionRef.current = null;
      helitackCollectionRef.current = null;
      tankerCollectionRef.current = null;
      helitackBillboardsRef.current = [];
      tankerBillboardsRef.current = new Map();
    };
  }, [viewer]);

  useEffect(() => {
    currCachedRef.current = curr;
    configCachedRef.current = config;
    centerLatCachedRef.current = centerLat;
    centerLngCachedRef.current = centerLng;
    dropEventsCachedRef.current = dropEvents;
    currentStepCachedRef.current = currentStep;
  }, [curr, config, centerLat, centerLng, dropEvents, currentStep]);

  useEffect(() => {
    const collection = groundCollectionRef.current;
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

    const arrivalDurationMs = 30 * (config.timestepMinutes / 60) * 1000;
    const now = performance.now();
    const computeAlpha = (key: "engines" | "crews" | "dozers", count: number): number => {
      if (count === 0) {
        firstSeenMs.current[key] = null;
        return 1;
      }
      if (firstSeenMs.current[key] === null) {
        firstSeenMs.current[key] = now;
      }
      const start = firstSeenMs.current[key]!;
      const t = (now - start) / arrivalDurationMs;
      return Math.max(0, Math.min(1, t));
    };
    const engineAlpha = computeAlpha("engines", counts.engines);
    const crewAlpha = computeAlpha("crews", counts.crews);
    const dozerAlpha = computeAlpha("dozers", counts.dozers);

    collection.removeAll();

    for (const pos of enginePositions) {
      collection.add({
        position: Cartesian3.fromDegrees(pos.lng, pos.lat),
        image: engineImage,
        scale: 1.0,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        color: Color.WHITE.withAlpha(engineAlpha),
      });
    }
    for (const pos of crewPositions) {
      collection.add({
        position: Cartesian3.fromDegrees(pos.lng, pos.lat),
        image: crewImage,
        scale: 1.0,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        color: Color.WHITE.withAlpha(crewAlpha),
      });
    }
    for (const pos of dozerPositions) {
      collection.add({
        position: Cartesian3.fromDegrees(pos.lng, pos.lat),
        image: dozerImage,
        scale: 1.0,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        color: Color.WHITE.withAlpha(dozerAlpha),
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

  useEffect(() => {
    const collection = helitackCollectionRef.current;
    if (!collection) return;
    const counts = perTypeCounts({
      bundle: suppression.resources,
      step: currentStep,
      deployStep,
      endStep,
    });
    if (counts.helitack === 0) {
      firstSeenMs.current.helitack = null;
    } else if (firstSeenMs.current.helitack === null) {
      firstSeenMs.current.helitack = performance.now();
    }
    if (collection.length !== counts.helitack) {
      collection.removeAll();
      helitackBillboardsRef.current = [];
      for (let i = 0; i < counts.helitack; i++) {
        const bb = collection.add({
          position: Cartesian3.fromDegrees(centerLng, centerLat, 60),
          image: helitackImage,
          scale: 1.0,
          verticalOrigin: VerticalOrigin.BOTTOM,
          color: Color.WHITE.withAlpha(0),
        });
        helitackBillboardsRef.current.push(bb);
      }
    }
  }, [viewer, suppression, deployStep, endStep, currentStep, helitackImage, centerLat, centerLng]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const startMs = performance.now();
    const orbitRadiusMeters = 400;
    const orbitAltitudeMeters = 60;
    const orbitPeriodSec = 30;

    const callback = () => {
      const billboards = helitackBillboardsRef.current;
      if (billboards.length === 0) return;
      const centroid = activeFireCentroid(
        currCachedRef.current,
        configCachedRef.current,
        centerLatCachedRef.current,
        centerLngCachedRef.current,
      );
      if (!centroid) return;
      const nowMs = performance.now();
      const elapsedSec = (nowMs - startMs) / 1000;
      const omega = (2 * Math.PI) / orbitPeriodSec;
      const N = billboards.length;
      const metersPerDegLat = 111_320;
      const metersPerDegLng = 111_320 * Math.cos((centroid.lat * Math.PI) / 180);
      const aircraftArrivalMs = 3 * (configCachedRef.current.timestepMinutes / 60) * 1000;
      const seen = firstSeenMs.current.helitack;
      const alpha = seen === null ? 1 : Math.max(0, Math.min(1, (nowMs - seen) / aircraftArrivalMs));
      for (let i = 0; i < N; i++) {
        const baseAngle = (i / N) * 2 * Math.PI;
        const angle = baseAngle + omega * elapsedSec;
        const dxMeters = orbitRadiusMeters * Math.cos(angle);
        const dyMeters = orbitRadiusMeters * Math.sin(angle);
        const lat = centroid.lat + dyMeters / metersPerDegLat;
        const lng = centroid.lng + dxMeters / metersPerDegLng;
        billboards[i].position = Cartesian3.fromDegrees(lng, lat, orbitAltitudeMeters);
        billboards[i].color = Color.WHITE.withAlpha(alpha);
      }
    };
    viewer.scene.preRender.addEventListener(callback);
    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.preRender.removeEventListener(callback);
      }
    };
  }, [viewer]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const tankerAltitudeMeters = 150;

    const callback = () => {
      const collection = tankerCollectionRef.current;
      if (!collection) return;
      const dropEvts = dropEventsCachedRef.current;
      const cs = currentStepCachedRef.current;
      const billboards = tankerBillboardsRef.current;

      const activeDrops = dropEvts.filter((e) => cs >= e.startStep && cs <= e.endStep);
      const activeTankerIdxs = new Set(activeDrops.map((e) => e.tankerIdx));

      for (const [idx, bb] of billboards) {
        if (!activeTankerIdxs.has(idx)) {
          collection.remove(bb);
          billboards.delete(idx);
        }
      }

      for (const drop of activeDrops) {
        const span = drop.endStep - drop.startStep;
        const t = span > 0 ? (cs - drop.startStep) / span : 0;
        const lat = drop.axisStart.lat + (drop.axisEnd.lat - drop.axisStart.lat) * t;
        const lng = drop.axisStart.lng + (drop.axisEnd.lng - drop.axisStart.lng) * t;
        const newPosition = Cartesian3.fromDegrees(lng, lat, tankerAltitudeMeters);

        let bb = billboards.get(drop.tankerIdx);
        if (!bb) {
          bb = collection.add({
            position: newPosition,
            image: tankerImage,
            scale: 1.0,
            verticalOrigin: VerticalOrigin.BOTTOM,
          });
          billboards.set(drop.tankerIdx, bb);
        } else {
          bb.position = newPosition;
        }
      }
    };
    viewer.scene.preRender.addEventListener(callback);
    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.preRender.removeEventListener(callback);
      }
    };
  }, [viewer]);

  return null;
}
