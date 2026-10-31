# Robot-Dog Mock Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a labeled "mock simulation" robot-dog mode to the wildfire app: the dog plans safe routes and an escape path on the model's fire forecast, re-plans/retreats after a scripted wind shift, and the run is captured as a video and a poster still.

**Architecture:** Pure planning logic lives in `src/simulation/robot/` (hazard map from simulation history → time-dependent Dijkstra planner → a pure mission state machine). React/Cesium pieces (`RobotDogLayer`, `RobotDogHUD`) render the mission; `App.tsx` owns robot state alongside the existing pause→resume flow and reuses `apiExtend` for the wind-shift re-forecast. A Playwright script drives the app through `window.__robotDemo` hooks to record the video and still.

**Tech Stack:** TypeScript, React 19, CesiumJS (resium-free imperative entities, as in existing layers), Vitest, three.js `GLTFExporter` (model export only), Python Playwright + Homebrew `ffmpeg` (recording).

**Spec:** `docs/superpowers/specs/2026-10-31-robot-dog-mock-simulation-design.md`

## Global Constraints

- Live-mode defaults: speed **1.5 m/s**, entry margin **30 min**, escape margin **60 min**, max slope **35°**, wind shift **+10 km/h** blowing from the fire toward the dog. All live in one tunable `ROBOT_DEFAULTS` object.
- Mock label text, verbatim, visible whenever robot mode is on: **"Mock simulation — planning on the model's fire forecast. No physical robot."**
- Robot mode only on live simulations with **no** `history.suppressed`; the button is hidden otherwise.
- Planner and wind shift use `history.baseline` only; the wind-shift `apiExtend` call passes `suppression: null` **and** the terrain `elevationMap`.
- Robot mode must not change `appMode` away from `"simulation"` (the `activeFire` rebuild effect in `App.tsx` only runs in that mode). Robot state is separate React state.
- Exiting robot mode keeps the shifted fire; no second history kept in memory.
- No per-frame canvas re-encodes; Cesium entities with `CallbackProperty` or per-step updates only. Planner off the render loop (runs on step changes, not per frame).
- Pure logic in `src/simulation/robot/` has no React/Cesium imports; tests in `src/simulation/__tests__/`.
- Coordinates: cell `idx = row * gridSize + col`; row increases **north**, col increases **east** (see `createGrid` in `src/simulation/grid.ts`); `config.windDirection` is meteorological **"from"** degrees.

## Review Focus

- A judge clicks staging/target on water, inside the burned area, or outside the 30 km grid → snap to nearest safe cell within 1 km with a notice, or reject with a message; never start a mission on an unsafe cell. (Task 3 tests.)
- The timeline is paused, scrubbed backward, or played at 5× while the dog is out → dog pose is a pure function of sim time: paused = frozen, scrubbed before mission start = at staging, no planner crash. (Task 4 tests.)
- "Wind shift" pressed before the dog is placed, twice, or with the dev API server down → button disabled until a mission is active and after one shift; on API failure show an error and keep the old forecast. (Task 7 step.)
- Terrain sampling failed (`elevationMap` undefined) → planner treats terrain as flat; nothing throws. (Task 3 test.)
- The fire forecast ends (history shorter than the mission) → cells unburned at the last step are treated as never igniting; dog finishes normally. (Task 2 test.)

---

### Task 1: Robot config, types and hazard map

**Files:**
- Create: `src/simulation/robot/types.ts`
- Create: `src/simulation/robot/hazard.ts`
- Test: `src/simulation/__tests__/robotHazard.test.ts`

**Interfaces:**
- Produces:
  - `interface RobotConfig { speedMps: number; slopeCostK: number; maxSlopeDeg: number; entryMarginMin: number; escapeMarginMin: number; snapRadiusCells: number; scoutHoldMin: number; windShiftDeltaKmh: number; searchPadCells: number }`
  - `const ROBOT_DEFAULTS: RobotConfig = { speedMps: 1.5, slopeCostK: 3, maxSlopeDeg: 35, entryMarginMin: 30, escapeMarginMin: 60, snapRadiusCells: 20, scoutHoldMin: 30, windShiftDeltaKmh: 10, searchPadCells: 80 }`
  - `interface Plan { cells: number[]; arrivalMin: number[]; minMarginMin: number }` (arrival times are absolute sim minutes)
  - `interface PlannerGrid { gridSize: number; cellSizeMeters: number; ignitionMin: Float32Array; elevation?: Float32Array; passable?: Uint8Array }`
  - `computeIgnitionMinutes(history: SimulationState[], timestepMinutes: number): Float32Array` — per cell, `firstStepWhereState !== Unburned * timestepMinutes`; `Infinity` if never.
  - `passableFromFuel(fuelMap: FuelType[] | null | undefined, gridSize: number): Uint8Array | undefined` — 0 for `FuelType.Water`, 1 otherwise; `undefined` when no fuel map.

- [ ] **Step 1: Write the failing tests** — `computeIgnitionMinutes`: 3-step history on a 3×3 grid where cell 4 is Burning at step 0, cell 5 Burning at step 2, cell 0 never burns → `[Infinity, …]` with `out[4] === 0`, `out[5] === 30` (timestep 15), `out[0] === Infinity`; a Burned-at-step-1 cell that was never seen Burning gets `15`. `passableFromFuel`: Water → 0, Grass → 1; `undefined` input → `undefined`.
- [ ] **Step 2: Run** `npx vitest run src/simulation/__tests__/robotHazard.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts` and `hazard.ts` (single pass over steps, fill once per cell).
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(robot): hazard map from simulation history"`

### Task 2: Time-dependent safe-path planner

**Files:**
- Create: `src/simulation/robot/planner.ts`
- Test: `src/simulation/__tests__/robotPlanner.test.ts`

**Interfaces:**
- Consumes: `RobotConfig`, `Plan`, `PlannerGrid` (Task 1).
- Produces:
  - `planPath(grid: PlannerGrid, startIdx: number, goalIdx: number, startMin: number, marginMin: number, robot: RobotConfig): Plan | null`
  - `planStillSafe(plan: Plan, fromMin: number, ignitionMin: Float32Array, marginMin: number): boolean` — every cell whose arrival ≥ `fromMin` satisfies `arrival + marginMin < ignitionMin[cell]`.
  - `remainingMarginMin(plan: Plan, nowMin: number, ignitionMin: Float32Array): number` — min over remaining cells of `ignition − arrival` (Infinity if none).
  - `cellSlopeDeg(a: number, b: number, elevation: Float32Array | undefined, gridSize: number, cellSizeMeters: number): number` — 0 when `elevation` undefined.

Algorithm (Dijkstra on earliest arrival time, 8-connected, binary heap; restricted to the bounding box of start/goal padded by `searchPadCells`, clipped to the grid):
```
stepMin(a,b) = dist(a,b) / speedMps / 60 * (1 + slopeCostK * tan(slopeDeg))   // dist = cellSize or cellSize*√2
skip b if passable?.[b] === 0 or slopeDeg > maxSlopeDeg
skip b if t + stepMin + marginMin >= ignitionMin[b]     // safety rule
start cell itself must satisfy startMin + marginMin < ignitionMin[start], else return null
minMarginMin = min over path of ignitionMin[c] − arrivalMin[c]
```
(Waiting in place is not modeled; with a monotone hazard the earliest arrival is always the safest.)

- [ ] **Step 1: Write the failing tests** (20×20 grid, cellSize 50, `ROBOT_DEFAULTS`):
  - `open field straight line`: no fire (all Infinity), start (10,2) → goal (10,17): `cells.length === 16`, `arrivalMin.at(-1)` ≈ `15 * 50 / 1.5 / 60` (±0.01), `minMarginMin === Infinity`.
  - `bends around a fire wall`: column 10 rows 5–14 ignite at minute 5 → path exists, no cell in that wall, every cell satisfies `arrival + 30 < ignition`.
  - `blocked returns null`: full column 10 igniting at minute 5 → `null`.
  - `water impassable`: `passable` zero on full column 10 → `null`.
  - `avoids steep slope`: elevation makes a 40° ridge on column 10 except row 0 → path crosses at row 0.
  - `flat when elevation missing`: `cellSlopeDeg(..., undefined, ...) === 0`.
  - `unsafe start`: start cell igniting at minute 10, startMin 0, margin 30 → `null`.
  - `planStillSafe` turns false after the ignition map is replaced with an earlier fire on a remaining cell; `remainingMarginMin` equals the hand-computed minimum.
- [ ] **Step 2: Run** `npx vitest run src/simulation/__tests__/robotPlanner.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `planner.ts`.
- [ ] **Step 4: Run** the test — Expected: PASS. Also time a 600×600 open-field plan across 300 cells in a test; assert `< 300 ms`.
- [ ] **Step 5: Commit** `git commit -m "feat(robot): time-dependent safe path planner"`

### Task 3: Geometry, placement snapping and wind shift math

**Files:**
- Create: `src/simulation/robot/geo.ts`
- Create: `src/simulation/robot/windShift.ts`
- Test: `src/simulation/__tests__/robotGeo.test.ts`

**Interfaces:**
- Consumes: `PlannerGrid`, `RobotConfig` (Task 1).
- Produces:
  - `cellCenter(idx: number, gridSize: number, cellSizeMeters: number, centerLat: number, centerLng: number): { lat: number; lng: number }` — same formula as `createGrid`.
  - `latLngToCell(lat: number, lng: number, gridSize: number, cellSizeMeters: number, centerLat: number, centerLng: number): number | null` — `null` outside the grid.
  - `snapToSafeCell(idx: number, grid: PlannerGrid, nowMin: number, marginMin: number, radiusCells: number): number | null` — nearest (Euclidean in cells) passable cell with `nowMin + marginMin < ignitionMin`; `null` if none within radius.
  - `burningCentroid(state: Uint8Array, gridSize: number): { row: number; col: number } | null` — mean of Burning cells.
  - `shiftedWind(dogIdx: number, centroid: { row: number; col: number }, gridSize: number, current: { windSpeed: number; windDirection: number }, deltaKmh: number): { windSpeed: number; windDirection: number }` — `windDirection` = bearing from dog to centroid (0 = north, 90 = east), `windSpeed = min(60, current.windSpeed + deltaKmh)`.

- [ ] **Step 1: Write the failing tests**: `latLngToCell(cellCenter(i))` round-trips for corners and center of a 600 grid; point 20 km outside → `null`; `snapToSafeCell` on a burning cell returns a neighbour outside the fire; on water returns the nearest land cell; fully burning radius → `null`; `burningCentroid` of an empty grid → `null`; `shiftedWind` with centroid due north → `windDirection === 0`, due east → `90`, due south-west → `225`; speed capped at 60.
- [ ] **Step 2: Run** `npx vitest run src/simulation/__tests__/robotGeo.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(robot): grid geometry, placement snapping, wind shift"`

### Task 4: Mission state machine

**Files:**
- Create: `src/simulation/robot/mission.ts`
- Test: `src/simulation/__tests__/robotMission.test.ts`

**Interfaces:**
- Consumes: `planPath`, `planStillSafe`, `remainingMarginMin` (Task 2); `PlannerGrid`, `RobotConfig`, `Plan` (Task 1).
- Produces:
  - `type MissionPhase = "outbound" | "scouting" | "returning" | "retreating" | "holding" | "done"`
  - `interface Mission { stagingIdx: number; targetIdx: number; phase: MissionPhase; route: Plan | null; escape: Plan | null; holdUntilMin: number | null; event: string | null; replanCount: number }`
  - `createMission(stagingIdx: number, targetIdx: number, startMin: number, grid: PlannerGrid, robot: RobotConfig): Mission`
  - `advanceMission(m: Mission, nowMin: number, grid: PlannerGrid, robot: RobotConfig): Mission` — pure; returns a new object.
  - `missionPose(m: Mission, nowMin: number, gridSize: number): { row: number; col: number; headingDeg: number }` — fractional row/col interpolated along `route.arrivalMin`; before the route starts → its first cell; heading 0 = north.
  - `missionMarginMin(m: Mission, nowMin: number, grid: PlannerGrid): number`

Transitions (`event` is a short HUD string set when something changes, else `null`):
- `outbound`: if route reached (`nowMin >= arrivalMin.at(-1)`) → `scouting`, `holdUntilMin = nowMin + scoutHoldMin`. Else if `!planStillSafe(route, nowMin, …, entryMarginMin)` → re-plan from the current pose cell to target (`event: "Re-planned: fire forecast changed"`, `replanCount+1`); if that fails → `retreating` on the escape plan (`event: "No safe route forward — retreating"`); if no escape → `holding`.
- Every advance while not `done`: if `escape` is null or no longer safe under `escapeMarginMin`, recompute escape from the current cell to staging.
- `scouting` → after `holdUntilMin`, `returning` with `planPath(current → staging, entryMarginMin)`.
- `returning`/`retreating` reaching staging → `done`. If their route becomes unsafe, re-plan to staging; if impossible → `holding`.
- `holding` (`event: "No safe path — holding"`): each advance tries escape again; success → `retreating`.

- [ ] **Step 1: Write the failing tests** (30×30 synthetic grids, `ROBOT_DEFAULTS`):
  - happy path: open field → phases go `outbound → scouting → returning → done` as `nowMin` advances; `missionPose` at mid-route is between start and goal; at `nowMin` < start it is staging.
  - wind shift: after creation, swap in an `ignitionMin` where fire reaches the remaining route in 10 min → next `advanceMission` gives `outbound` with a new route and `replanCount === 1`, or `retreating` when the target becomes unreachable; never a pose inside a cell with `ignitionMin <= nowMin`.
  - no escape: surround the dog with fire → `holding` with event `"No safe path — holding"`.
  - paused time: calling `advanceMission` twice with the same `nowMin` returns equal phase/route (idempotent).
- [ ] **Step 2: Run** `npx vitest run src/simulation/__tests__/robotMission.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `mission.ts`.
- [ ] **Step 4: Run** all robot tests `npx vitest run src/simulation/__tests__/robot*` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(robot): mission state machine with re-plan and retreat"`

### Task 5: Robot-dog glTF model

**Files:**
- Modify: `docs/poster/src/robot-dog-3d.html` (add `window.__exportGlb = async () => base64` using `GLTFExporter.parseAsync(dog, { binary: true })`; export only the `dog` group, not the shadow plane)
- Create: `docs/poster/scripts/export_robot_glb.py` (Playwright: open the page, call `__exportGlb`, write the bytes)
- Create: `public/models/robot-dog.glb`

**Interfaces:**
- Produces: `/models/robot-dog.glb`, model facing **+X** in three.js space (Y up), ~1.3 m long, origin at ground level under the body center.

- [ ] **Step 1: Implement** the export hook and script.
- [ ] **Step 2: Run** `python3 -I docs/poster/scripts/export_robot_glb.py` — Expected: `public/models/robot-dog.glb` exists, 20–500 KB, starts with bytes `glTF`.
- [ ] **Step 3: Commit** `git commit -m "feat(robot): export robot-dog glTF model"`

### Task 6: Cesium layer and HUD

**Files:**
- Create: `src/components/RobotDogLayer.tsx`
- Create: `src/components/RobotDogHUD.tsx`

**Interfaces:**
- Consumes: `Mission`, `missionPose`, `missionMarginMin` (Task 4); `cellCenter` (Task 3); `/models/robot-dog.glb` (Task 5).
- Produces:
  - `RobotDogLayer({ viewer, mission, nowMin, gridSize, cellSizeMeters, centerLat, centerLng, stagingLatLng, targetLatLng }): null` — imperative entities like `SuppressionVehicleLayer`: dog model (`heightReference: CLAMP_TO_GROUND`, `minimumPixelSize` ≈ 48 so it reads at 15 km altitude, orientation from `headingDeg`; verify visually that the model faces its direction of travel and fix with a constant yaw offset), blue route polyline `#2D6CDF` and green escape polyline `#2E8540` (both `clampToGround`, width 5), home marker at staging, flag marker at target. Removes all entities on unmount.
  - Smooth motion: the layer receives `nowMin` per timeline step and interpolates pose per animation frame toward the next step using the measured interval between the last two step changes (cap fraction at 1).
  - Camera follow: prop `follow: boolean` (default false); when true, the camera keeps the dog centered at its current height/pitch each frame (`viewer.camera.lookAt` offset, released via `lookAtTransform(Matrix4.IDENTITY)` when turned off or on unmount).
  - `RobotDogHUD({ phase, event, marginMin, windLabel, windShifted, onWindShift, onExit, shiftPending, follow, onToggleFollow }): JSX.Element` — includes a "Follow dog" toggle.
  - HUD phase/margin fields: — fire-panel style box top-right; shows phase in plain words (`outbound` → "Scouting route", `scouting` → "At fire edge", `returning` → "Returning", `retreating` → "Retreating", `holding` → "No safe path — holding" in red, `done` → "Safe at staging"), margin as "Fire margin: N min" (∞ shown as "clear"), wind label, buttons "🌬 Wind shift" (disabled when `windShifted || shiftPending`) and "Exit robot mode", and the verbatim mock label.

- [ ] **Step 1: Implement** both components.
- [ ] **Step 2: Run** `npm run build` — Expected: TypeScript passes.
- [ ] **Step 3: Commit** `git commit -m "feat(robot): Cesium robot layer and HUD"`

### Task 7: App wiring — placement, mission loop, wind shift

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/RobotPlacementTool.tsx`

**Interfaces:**
- Consumes: everything above; `apiExtend`, `rleDecode` (existing).
- Produces:
  - App state: `elevationMap` lifted to `useState<Float32Array | null>` (set where `elevationMap = sampledElevations` in `handleStartWildfire`, cleared in `runReset`); `robot: { placing: "staging" | "target" | null; stagingIdx: number | null; targetIdx: number | null; mission: Mission | null; windShifted: boolean; shiftPending: boolean; notice: string | null } | null`.
  - `RobotPlacementTool({ viewer, active, onPick(lat, lng) })` — one `LEFT_CLICK` handler using `pickPosition` → `pickEllipsoid` fallback, same as `BoundaryDrawTool`.
  - Dev-only hook (when `import.meta.env.DEV`): `window.__robotDemo = { start(staging: {lat,lng}, target: {lat,lng}): void; shiftWind(): Promise<void>; state(): { phase: MissionPhase | null; replanCount: number } }`.

Behaviour:
- "🐕 Robot Dog" button next to "🛡 Suggest Containment" with the same visibility rule (`appMode === "simulation" && !timelinePlaying && !history.suppressed && history.baseline.length > 0`). Click → `robot.placing = "staging"`; the placement bar reads "Click a staging point (safe start)", then "Click the scout target near the fire edge".
- Each pick: `latLngToCell` → `snapToSafeCell(…, nowMin, entryMarginMin, snapRadiusCells)`; null → notice "Not safe here — pick a spot away from the fire" (or "Outside the simulation area"); snapped → notice "Moved to the nearest safe spot".
- After target: `createMission(staging, target, nowMin, grid, ROBOT_DEFAULTS)`; if its route is null, show "No safe route to that target — pick another" and stay in target placement. Otherwise resume playback (same `setAutoPlay(false)` → `true` toggle used by the resume flow).
- `PlannerGrid` memo: `{ gridSize, cellSizeMeters, ignitionMin: computeIgnitionMinutes(history.baseline, timestepMinutes), elevation: elevationMap ?? undefined, passable: passableFromFuel(activeFuelMap, gridSize) }`, recomputed only when `history.baseline` changes.
- On every `currentStep` change while a mission exists: `mission = advanceMission(mission, currentStep * timestepMinutes, grid, ROBOT_DEFAULTS)`.
- Wind shift: compute `shiftedWind(currentPoseCell, burningCentroid(baseline[currentStep].grid), …)`; `apiExtend({ config: { ...activeConfig, windSpeed, windDirection }, fuelMap, elevationMap: Array.from(elevationMap), centerLat, centerLng, initialGrid: copy of baseline[currentStep].grid, initialStep: currentStep, suppression: null, maxSteps: Math.max(500, currentStep + 200) })`; decode and stitch exactly like `handleApproveRoster` but into `baseline`; `setActiveConfig` with the new wind; `setWeatherInfo` "Wind shifted to N° at S km/h — fire re-forecast"; keep `currentStep`; mark `windShifted`. On error: notice "Wind shift failed — is the dev server running? (npm run server)", keep the old forecast, leave the button enabled.
- Exit: clear `robot`, keep history. `runReset` clears `robot` too.
- Hide `ContainmentLineLayer`/Suggest Containment while `robot` is set.

- [ ] **Step 1: Implement** the wiring and placement tool.
- [ ] **Step 2: Run** `npm run build && npm test` — Expected: build passes, all tests pass (existing + robot).
- [ ] **Step 3: Manual check** with `npm run dev` + `npm run server`: Big Sur, Summer seasonal, ignite, wait ~40 s, pause, Robot Dog, place staging ~3 km upwind and target ~500 m from the fire edge; confirm: dog walks smoothly on terrain, blue/green paths drawn, HUD margins update, Wind shift re-forecasts and the dog re-plans or retreats, never stands in fire; Exit clears entities; Reset clears everything.
- [ ] **Step 4: Commit** `git commit -m "feat(robot): robot-dog mode with placement, mission loop and wind shift"`

### Task 8: Tuned demo recording, video, still and poster update

**Files:**
- Create: `docs/poster/scripts/record_robot_demo.py`
- Create: `docs/poster/media/robot-dog-demo.mp4`
- Create: `docs/poster/img/robot-mock.jpg`
- Modify: `docs/poster/right.html` (still + caption under "Status & next"; change the line "Robot-dog route planning on the forecast" to "Robot-dog route planning (mock simulation, in progress)")

**Interfaces:**
- Consumes: `window.__robotDemo` (Task 7); `docs/poster/build.sh`.

Script (Python Playwright, headed Chrome, viewport 1920×1080, `record_video_dir`): same Big Sur setup as the poster screenshots (Simulate → Seasonal/Summer → search "Big Sur" → pick the California result → click globe → Start the Wildfire), wait for the fire to grow, pause, collapse the control panel, call `__robotDemo.start(...)` with staging/target computed in-page from the fire centroid (staging ~3 km upwind of the centroid, target ~600 m beyond the downwind fire edge), set playback 1×, call `__robotDemo.shiftWind()` when the dog is ~60% along its outbound route, run until `state().phase === "done"` or 40 s. Tune `ROBOT_DEFAULTS` overrides (via a `?robotTune=` JSON query param read in dev only) until the run shows: a visibly bent route, a re-plan or retreat after the shift, and the dog never in a burning cell. Convert with `ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -crf 20 docs/poster/media/robot-dog-demo.mp4`, trimmed to 25–40 s. Save a still at the re-plan moment (fire + dog + both paths + mock label in frame), cropped to ~16:9 → `img/robot-mock.jpg`.

- [ ] **Step 1: Implement** the script and the dev-only `robotTune` query param.
- [ ] **Step 2: Run** with both servers up; iterate tuning until the three story beats are visible. Expected: MP4 25–40 s plays in QuickTime; still shows the mock label.
- [ ] **Step 3: Update** `right.html`: full-width still with caption "Mock simulation: the robot dog re-plans after a wind shift (no physical robot)." in the free space under "Status & next"; if content overflows, shrink the still, not text.
- [ ] **Step 4: Run** `bash docs/poster/build.sh` and render `out/right.pdf` to PNG (`sips -s format png -Z 1400`) — Expected: one page, still visible, footer not clipped.
- [ ] **Step 5: Commit** `git commit -m "feat(poster): robot-dog mock simulation video and still"`
