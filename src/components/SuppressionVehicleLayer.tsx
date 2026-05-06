import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  BillboardCollection,
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

  const currCachedRef = useRef<SimulationState>(curr);
  const configCachedRef = useRef<SimulationConfig>(config);
  const centerLatCachedRef = useRef<number>(centerLat);
  const centerLngCachedRef = useRef<number>(centerLng);
  const dropEventsCachedRef = useRef<DropEvent[]>(dropEvents);
  const currentStepCachedRef = useRef<number>(currentStep);

  const engineImage = useMemo(() => createColoredDisc(48, "#dc2626", "E"), []);
  const crewImage = useMemo(() => createColoredDisc(48, "#facc15", "C"), []);
  const dozerImage = useMemo(() => createColoredDisc(48, "#f97316", "D"), []);
  const helitackImage = useMemo(() => createColoredDisc(48, "#3b82f6", "H"), []);
  const tankerImage = useMemo(() => createColoredDisc(48, "#38bdf8", "T"), []);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const groundCollection = new BillboardCollection();
    const helitackCollection = new BillboardCollection();
    const tankerCollection = new BillboardCollection();
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

  useEffect(() => {
    const collection = helitackCollectionRef.current;
    if (!collection) return;
    const counts = perTypeCounts({
      bundle: suppression.resources,
      step: currentStep,
      deployStep,
      endStep,
    });
    if (collection.length !== counts.helitack) {
      collection.removeAll();
      helitackBillboardsRef.current = [];
      for (let i = 0; i < counts.helitack; i++) {
        const bb = collection.add({
          position: Cartesian3.fromDegrees(centerLng, centerLat, 60),
          image: helitackImage,
          scale: 1.0,
          verticalOrigin: VerticalOrigin.BOTTOM,
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
      const elapsedSec = (performance.now() - startMs) / 1000;
      const omega = (2 * Math.PI) / orbitPeriodSec;
      const N = billboards.length;
      const metersPerDegLat = 111_320;
      const metersPerDegLng = 111_320 * Math.cos((centroid.lat * Math.PI) / 180);
      for (let i = 0; i < N; i++) {
        const baseAngle = (i / N) * 2 * Math.PI;
        const angle = baseAngle + omega * elapsedSec;
        const dxMeters = orbitRadiusMeters * Math.cos(angle);
        const dyMeters = orbitRadiusMeters * Math.sin(angle);
        const lat = centroid.lat + dyMeters / metersPerDegLat;
        const lng = centroid.lng + dxMeters / metersPerDegLng;
        billboards[i].position = Cartesian3.fromDegrees(lng, lat, orbitAltitudeMeters);
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
