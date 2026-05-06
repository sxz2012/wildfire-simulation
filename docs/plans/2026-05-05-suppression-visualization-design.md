# Suppression Visualization — Design

**Date:** 2026-05-05
**Branch:** version3 (or successor)
**Status:** Validated
**Builds on:** `2026-05-04-suppression-modeling-design.md`, `2026-05-04-suppression-inverse-search-design.md`

## Goal

Make wildfire suppression *visible* during a live demo. Today, suppression is computed by the model but the only on-screen effect is fewer fire dots; the audience cannot tell whether resources are deployed or working. This design adds an operational, literal visualization: distinct 3D models per resource type, type-specific motion behaviors, a containment-line cell renderer, and an operational dashboard HUD.

## Posture

**Operational / literal**, layered as decoration on top of the existing sim. Resource counts and effects come straight from the existing `SuppressionConfig` and `SuppressionStepDiag` — no engine changes. Motion behaviors that are richer than the sim (helicopter orbits, tanker drop passes) are clearly cosmetic; the suppression accounting is unchanged.

## Visual elements

### 1. Five distinct 3D models

| Resource | Model | Behavior |
|---|---|---|
| Fire engine | `engine.glb` | Anchored to flipped cells, terrain-clamped |
| Hand crew | `crew.glb` | Anchored to flipped cells, terrain-clamped |
| Dozer | `dozer.glb` | Anchored to flipped cells, terrain-clamped |
| Helitack | `helitack.glb` | Orbits active fire centroid, ~60 m altitude, ~400 m radius, 30 s/loop, staggered when multiple |
| Air tanker | `tanker.glb` | Drop passes every 30 sim-min along longest axis of fire, 150 m altitude |

`minimumPixelSize ≈ 36 px` so models stay readable at the demo zoom (whole-fire view, 10–15 km).

### 2. Ground-resource positioning

Each step:
1. Compute the **flipped set** = cells where `prev[idx]==Burning && curr[idx]==Suppressed`.
2. Distribute ground entities (engines/crews/dozers) over a uniform sample of flipped cells.
3. If the flipped set is empty for this step, hold last-frame positions (anti-jitter).
4. Tween between consecutive frames' positions over the timestep duration to keep motion smooth.

Honest to the sim: each entity sits at a cell the model says line was built on this step.

### 3. Helitack orbits

Each helitack circles the active-fire centroid (mean lat/lng of currently-Burning cells). Stagger angles 360°/N apart (so 3 helitack are 120° apart). Altitude ~60 m above terrain. Orbit period 30 s real-time.

### 4. Tanker drop passes

Cadence: every 30 sim-min after deployment. Trajectory: spawn 5 km off the fire's longest current axis at 150 m altitude, fly in a straight line over the fire centroid, exit 5 km off the other side. Pass duration: ~3 sim-minutes (so the drop "feels" measured, not instant).

Mid-pass paints a **red retardant polyline** on terrain — 6 km long × ~80 m wide, opacity 1.0. Polyline persists for the rest of the run; opacity fades to ~0.3 over 10 sim-min so older drops don't dominate.

When 2 tankers are deployed (Type 1), drops alternate, giving a ~15 min cadence.

### 5. Cyan containment line

Every cell that was ever in the `Suppressed` state renders as a saturated cyan billboard for the rest of the run. As the sim advances, a growing cyan rim wraps the fire perimeter — *the* "we're winning" visual. Implemented as a single canvas-imagery layer (incremental paint of newly-suppressed cells per step), reusing the `FireOverlay` pattern.

### 6. Cinematic arrival, instant retirement

At the deployment step (`⌈delayMin / timestepMinutes⌉`):
- Ground resources fade in along a straight line from the nearest edge-of-frame point toward their first work cell, ~30 sim-sec drive.
- Aircraft fly in from off-screen along a 5 km approach.

At sim end (no Burning cells remaining), entities despawn instantly — the audience's attention is on the contained fire, not the cooldown.

## Operational HUD

Persistent top-right card, ~280 px wide, shown only when suppression is enabled.

```
ACTIVE RESPONSE — Day 1, 02:30      [bundle: Type 2]

👷 5 crews    🚒 0 engines    🚜 3 dozers
🚁 2 helitack    ✈️ 1 tanker  (last drop 00:12 ago)
─────────────────────────────────────
Line built          1,820 m   ▲ 240 m/min
Active perimeter    4,210 m
Containment         62 %  ████████░░
```

**Number sources:**
- Per-type counts — derived from bundle + current step (no engine change). Zeroes pre-deployment / post-end; full bundle counts in between.
- Last drop ago — from drop scheduler (precomputed event list).
- Line built / active perimeter / containment — `diags[currentStep]`.
- Line-build rate — smoothed delta of `cumulativeLineMeters` over a 5-step window.

**Behavior:** flashes containment bar green at 100 %; freezes with "Fire contained — HH:MM" footer when the fire ends.

## Architecture

**No sim-engine changes.** Everything derived from existing `SuppressionResult.history` + `SuppressionStepDiag[]` + `SuppressionConfig`.

### New components

1. **`src/components/SuppressionVehicleLayer.tsx`** — Cesium imperative layer (`viewer` prop, mirrors `FireParticles`). Owns entity pools per resource type. Per step: updates ground positions, helitack orbits, tanker drop state.
2. **`src/components/ContainmentLineLayer.tsx`** — Canvas-imagery layer (mirrors `FireOverlay`). Incremental paint of newly-suppressed cells.
3. **`src/components/RetardantTrailLayer.tsx`** — Cesium polyline collection. One polyline per drop with opacity fade.
4. **`src/components/SuppressionHUD.tsx`** — Pure React panel above Cesium canvas.
5. **`src/utils/dropScheduler.ts`** — Pure function: `(diags, suppression, deployStep) → DropEvent[]`. Precomputed once per run.
6. **`src/utils/groundPositions.ts`** — Pure function: `(prevState, currState, gridConfig, count, lastFramePositions) → LatLng[]`.
7. **`src/utils/perTypeCounts.ts`** — Pure function: `(bundle, step, deployStep, endStep) → { crews, engines, dozers, helitack, tankers }`.
8. **`src/assets/models/`** — five `.glb` files + `CREDITS.md`.

### Modified

- `src/App.tsx` — mount the four new layers when `suppression.enabled && suppressionDiags`. Pass `viewer` ref via the existing pattern.
- `src/components/ImpactSection.tsx` — pass `suppression`, `bundle`, `deployStep` props through to `SuppressionHUD`.

### Data flow per step

```
currentStep ──► history[step]          ──► SuppressionVehicleLayer  (positions)
            ├─► history[step]/[step-1] ──► ContainmentLineLayer     (incremental paint)
            ├─► dropEvents (precomputed)──► RetardantTrailLayer     (polyline state)
            └─► diags[step] + bundle   ──► SuppressionHUD           (numbers)
```

## Asset sourcing

Five permissively-licensed glTF/glb files. CC0 preferred; CC-BY allowed with attribution in `src/assets/models/CREDITS.md`.

| Model | Source candidates | Target size |
|---|---|---|
| `engine.glb` | Kenney "Vehicle Pack" (CC0); Sketchfab CC0 | < 200 KB |
| `crew.glb` | Kenney "Toon Characters" recolor + helmet (CC0) | < 80 KB |
| `dozer.glb` | Sketchfab CC-BY | < 250 KB |
| `helitack.glb` | NASA 3D Resources / Sketchfab CC-BY | < 250 KB |
| `tanker.glb` | Sketchfab CC-BY | < 300 KB |

Total budget ≈ 1 MB compressed. Pre-process with `gltf-transform optimize` (Draco compression, 512-px textures). Imported via Vite `?url`.

**Fallback** (if asset sourcing slips at demo time): Cesium's bundled `Cesium_Air.glb` for tanker; colored billboards for the other four. Documented in plan as a fallback task.

## Performance budget

| Item | Cost |
|---|---|
| 25 glTF entities at peak (Type 1) | ~2 ms/frame on workstation |
| ContainmentLineLayer canvas | < 200 cells redrawn/step |
| Retardant polylines | ~16 over 4-hour run |
| HUD React render | ≤ 5 Hz step ticks |

**Targets:** sustained 60 fps at 1× playback; 30 fps floor at 5× playback. Memory delta: ~7 MB on top of current usage.

## Testing

**Unit (vitest):**
- `__tests__/dropScheduler.test.ts` — drop events at expected step intervals; longest-axis chord chosen correctly.
- `__tests__/groundPositions.test.ts` — N entities → N positions; over-count case; empty-flipped-set retains last frame.
- `__tests__/perTypeCounts.test.ts` — zeros pre/post deployment; full counts in between; matches bundle config.

**Manual smoke (acceptance gate):**
1. Cupertino scenario, With Suppression, Type 2, 30 min delay.
2. Deployment moment: ground entities fade in along approach line; aircraft fly in.
3. A tanker drop visibly passes over the fire and paints a red trail.
4. Helitack visibly orbits at altitude.
5. Cyan rim grows on the perimeter.
6. HUD numbers update each step; rate looks plausible.
7. End-of-run state matches outcome (contained / not).
8. Toggle Wildfire Only: all suppression visuals disappear; no Cesium orphans.

## Out of scope

- Per-resource health/fuel/water tracking.
- Real road-network pathfinding for arrival.
- Acoustic effects.
- Wind affecting tanker drop trajectory.
- Per-type breakdown in `SuppressionStepDiag` (derived client-side instead).
- Automated visual-regression tests of the rendered scene (manual smoke is sufficient).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Asset sourcing slips before demo | Fallback path to `Cesium_Air.glb` + colored billboards; documented as a plan task |
| glTF licenses unclear | Pin to CC0/CC-BY only; `CREDITS.md` maintained per asset |
| 25 entities drop FPS on lower-end hardware | `minimumPixelSize` trims off-screen rendering; smoke-test gate |
| Tanker drop trajectories look wrong on irregular fires | Use longest-axis of bounding box, not perimeter — robust to fire shape |

## Success criteria

The feature ships when:
1. With Suppression on, audience sees 5 distinct vehicle types on the map.
2. Ground vehicles appear at cells the sim flipped to Suppressed this step.
3. At least one helitack visibly orbits the fire.
4. At least one tanker drop pass with retardant trail is observed during a 4-hour Type 2+ run.
5. Cyan containment ring is clearly visible by step 30+ on a successful suppression run.
6. HUD shows per-type counts that match the bundle and update at deployment / end-of-run boundaries.
7. Toggling Wildfire Only fully cleans up the suppression scene.
