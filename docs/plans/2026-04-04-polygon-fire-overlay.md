# Polygon Fire Perimeter Visualization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the scattered dots/flame billboards fire overlay with a filled polygon perimeter visualization — layered orange fill with temporal shading and a red active perimeter outline, matching the Eaton Fire map style.

**Architecture:** Compute a concave hull from cumulative hotspot points per frame. Render as Cesium ground-clamped polygon entities: lighter fill for older burns, darker for recent, red polyline for the active perimeter. A center label shows fire name + acreage. The existing `HistoricalFireOverlay` component gets rewritten; `FireEffects` particle systems are kept but reduced to only a few along the active perimeter.

**Tech Stack:** CesiumJS (Entity API — polygon, polyline, label), TypeScript, React

---

### Task 1: Create the concave hull utility

**Files:**
- Create: `src/utils/concaveHull.ts`
- Test: `src/utils/__tests__/concaveHull.test.ts`

This utility takes an array of `[lng, lat]` points and returns the ordered boundary polygon vertices. The algorithm:
1. Compute centroid of all points
2. Divide space into angular sectors (e.g., 72 sectors = 5 degrees each)
3. For each sector, pick the farthest point from the centroid
4. Return the ordered boundary points, skipping empty sectors

This works well for fire perimeters since fires spread roughly outward from ignition.

**Step 1: Write the test**

```typescript
// src/utils/__tests__/concaveHull.test.ts
import { describe, it, expect } from "vitest";
import { computeFirePerimeter } from "../concaveHull";

describe("computeFirePerimeter", () => {
  it("returns empty array for < 3 points", () => {
    expect(computeFirePerimeter([])).toEqual([]);
    expect(computeFirePerimeter([[0, 0]])).toEqual([]);
    expect(computeFirePerimeter([[0, 0], [1, 1]])).toEqual([]);
  });

  it("returns a polygon for a simple point cloud", () => {
    // Square of points with some interior points
    const points: [number, number][] = [
      [0, 0], [1, 0], [2, 0],
      [0, 1], [1, 1], [2, 1],
      [0, 2], [1, 2], [2, 2],
    ];
    const hull = computeFirePerimeter(points);
    expect(hull.length).toBeGreaterThanOrEqual(4);
    // All hull points should be from the input
    for (const p of hull) {
      expect(points).toContainEqual(p);
    }
  });

  it("returns only outer points, not interior", () => {
    // Ring of points with center point
    const points: [number, number][] = [];
    for (let a = 0; a < 360; a += 45) {
      const rad = (a * Math.PI) / 180;
      points.push([Math.cos(rad) * 10, Math.sin(rad) * 10]);
    }
    points.push([0, 0]); // interior point
    const hull = computeFirePerimeter(points);
    // Center point should NOT be in the hull
    expect(hull).not.toContainEqual([0, 0]);
    expect(hull.length).toBe(8); // just the ring points
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/concaveHull.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/utils/concaveHull.ts

/**
 * Compute a fire perimeter polygon from a cloud of hotspot points.
 * Uses angular-sector farthest-point selection from centroid.
 * Works well for fire shapes that spread roughly outward.
 *
 * @param points Array of [lng, lat] coordinate pairs
 * @param sectors Number of angular sectors (more = finer boundary, default 90)
 * @returns Ordered boundary points as [lng, lat][] forming a closed polygon
 */
export function computeFirePerimeter(
  points: [number, number][],
  sectors = 90
): [number, number][] {
  if (points.length < 3) return [];

  // Compute centroid
  let cx = 0, cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;

  // For each angular sector, find the farthest point
  const sectorSize = (2 * Math.PI) / sectors;
  const boundary: ([number, number] | null)[] = new Array(sectors).fill(null);
  const maxDist: number[] = new Array(sectors).fill(0);

  for (const p of points) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    let angle = Math.atan2(dy, dx); // -PI to PI
    if (angle < 0) angle += 2 * Math.PI;
    const sectorIdx = Math.min(Math.floor(angle / sectorSize), sectors - 1);
    const dist = dx * dx + dy * dy;
    if (dist > maxDist[sectorIdx]) {
      maxDist[sectorIdx] = dist;
      boundary[sectorIdx] = p;
    }
  }

  // Collect non-null boundary points in order
  return boundary.filter((p): p is [number, number] => p !== null);
}

/**
 * Compute the centroid of a set of points.
 */
export function computeCentroid(points: [number, number][]): [number, number] {
  let cx = 0, cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  return [cx / points.length, cy / points.length];
}

/**
 * Estimate burned area in hectares from hotspot count.
 * Each VIIRS hotspot ≈ 375m x 375m pixel = 14.0625 ha
 */
export function estimateAreaHectares(hotspotCount: number): number {
  return hotspotCount * 14;
}

/**
 * Format area for display: hectares or km² depending on size.
 */
export function formatArea(hectares: number): string {
  if (hectares >= 10000) {
    return (hectares / 100).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " km²";
  }
  return hectares.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " ha";
}

/**
 * Format area in acres for display.
 */
export function formatAcres(hectares: number): string {
  const acres = hectares * 2.471;
  return acres.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " acres";
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/concaveHull.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/concaveHull.ts src/utils/__tests__/concaveHull.test.ts
git commit -m "feat: add concave hull utility for fire perimeter computation"
```

---

### Task 2: Rewrite HistoricalFireOverlay with polygon rendering

**Files:**
- Modify: `src/components/HistoricalFireOverlay.tsx` (full rewrite)

Replace the current point/billboard approach with Cesium Entity polygons:
- One polygon per "time layer" with graduated fill colors (older = lighter, newer = darker orange)
- A red polyline for the active perimeter of the latest frame
- A central label with fire name + acreage
- Keep smoke billboards for the active frame (reduced count)

**Step 1: Rewrite the component**

Replace the entire content of `src/components/HistoricalFireOverlay.tsx` with:

```typescript
import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  Color,
  Entity,
  PolygonHierarchy,
  ClassificationType,
  ColorMaterialProperty,
  ConstantProperty,
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
  // age 0 = oldest, totalLayers-1 = most recent
  const t = totalLayers > 1 ? age / (totalLayers - 1) : 1;
  // Light amber -> deep orange
  const r = 1.0;
  const g = 0.85 - t * 0.35; // 0.85 -> 0.50
  const b = 0.2 - t * 0.15;  // 0.20 -> 0.05
  const a = 0.25 + t * 0.2;  // 0.25 -> 0.45
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

    // --- Layer 1: Cumulative burned area polygon (filled, clamped to ground) ---
    // Build layered polygons: group frames into time bands for temporal shading
    const layerCount = Math.min(currentFrame + 1, 5); // max 5 layers for performance
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
    // Use the cumulative perimeter for the outer red line
    const outlinePositions = current.cumulativePerimeter.map(([lng, lat]) =>
      Cartesian3.fromDegrees(lng, lat)
    );
    // Close the loop
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
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/HistoricalFireOverlay.tsx
git commit -m "feat: replace dot overlay with layered polygon fire perimeter visualization"
```

---

### Task 3: Update Legend to match new polygon style

**Files:**
- Modify: `src/components/Legend.tsx`

Update the legend items to reflect the new polygon visualization style — show graduated fill + perimeter line instead of dot colors.

**Step 1: Update Legend items**

In `src/components/Legend.tsx`, replace the historical legend items:

Old:
```typescript
{ color: "#FF4500", glow: "rgba(255,69,0,0.4)", label: "Active fire" },
{ color: "#CC2200", glow: "rgba(204,34,0,0.3)", label: "Burned area" },
{ color: "rgba(150,150,150,0.5)", glow: "rgba(150,150,150,0.3)", label: "Smoke" },
```

New:
```typescript
{ color: "#FFB84D", glow: "rgba(255,184,77,0.4)", label: "Earlier burn" },
{ color: "#E06600", glow: "rgba(224,102,0,0.4)", label: "Recent burn" },
{ color: "#DC2626", glow: "rgba(220,38,38,0.4)", label: "Active perimeter" },
{ color: "rgba(150,150,150,0.5)", glow: "rgba(150,150,150,0.3)", label: "Smoke" },
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/components/Legend.tsx
git commit -m "feat: update legend to match polygon perimeter visualization"
```

---

### Task 4: Reduce FireEffects to perimeter-only particles

**Files:**
- Modify: `src/App.tsx` (change which positions are passed to FireEffects)

Currently `FireEffects` receives ALL hotspots from the current frame. Change it to only receive a sparse sample of the active perimeter points, so particles appear along the fire edge rather than blanketing the entire area.

**Step 1: Update App.tsx FireEffects positions**

In `src/App.tsx`, change the `activePositions` prop from:

```tsx
activePositions={
  activeFire.frames[currentStep]?.hotspots.map((h) => ({ lat: h.lat, lng: h.lng })) ?? []
}
```

To: compute perimeter positions and pass a sparse sample:

```tsx
activePositions={(() => {
  const frame = activeFire.frames[currentStep];
  if (!frame || frame.hotspots.length === 0) return [];
  // Use only boundary hotspots for particle effects
  const pts: [number, number][] = frame.hotspots.map((h) => [h.lng, h.lat]);
  const perim = computeFirePerimeter(pts);
  // Sparse sample — max 15 positions for particles
  const step = Math.max(1, Math.ceil(perim.length / 15));
  return perim
    .filter((_, i) => i % step === 0)
    .map(([lng, lat]) => ({ lat, lng }));
})()}
```

Add the import at the top of App.tsx:
```typescript
import { computeFirePerimeter } from "./utils/concaveHull";
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`

**Step 3: Test manually in browser**

- Start dev server: `npm run dev`
- Select a historical fire (Camp Fire)
- Verify: polygon fill visible, red perimeter outline, label in center
- Verify: fire particles appear only along the perimeter edge
- Verify: smoke drifts from the active perimeter
- Verify: temporal layers show graduated color (lighter to darker orange)
- Verify: timeline scrubbing works — polygon grows as frames advance

**Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: constrain fire particles to perimeter edge only"
```

---

### Task 5: Run full test suite and final verification

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass (including new concaveHull tests)

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build, no errors

**Step 3: Final commit if any cleanup needed**

---

## Performance Notes

- The `frameData` memo pre-computes all perimeters once per fire load — no per-frame recomputation
- Max 5 polygon layers keeps entity count low even for 125-frame fires
- Smoke limited to 20 perimeter positions max
- Fire particles limited to 15 perimeter positions
- `ClassificationType.BOTH` ensures polygons render on top of 3D tiles and terrain
