# Robot-Dog Mock Simulation — Design

**Date:** 2026-10-31
**Branch:** demo
**Deadline:** usable live demo, a recorded video, and a poster still before the IEEE CIC NextGen poster session on **2026-11-06**.

## Intent

The poster ("Fire-Aware Robot Dogs") proposes that a robot dog can use our ML fire-spread forecast to move safely near a wildfire. Today nothing in the app shows that. This feature adds a **mock simulation** of a robot dog inside the existing 3D wildfire simulator, so judges can *see* the idea work on real terrain.

It must tell this ~30-second story (agreed with the user):

1. A fire is spreading on real 3D terrain (e.g., the Big Sur hills).
2. A robot dog heads out to scout the fire edge.
3. Its route bends around cells the forecast says will ignite before it can pass.
4. A highlighted escape path always stays open behind it.
5. The wind shifts; the fire is re-forecast; the dog visibly re-plans and pulls back to safety.

One build serves three outputs:
- **Live mode** in the app for the laptop at the judging table.
- **Recorded video** (~30 s, MP4) of the same run.
- **Still image** for the poster, added to the right panel (`docs/poster/right.html`) and the PDFs rebuilt.

## Goals

- A "Robot Dog" mode that works after any live (click-to-ignite) simulation.
- A planner that uses the forecast (the simulation's future steps) as a time-dependent hazard map.
- Always-visible planned route (blue) and escape path (green).
- A scripted **wind shift** that re-forecasts the fire mid-run and forces a re-plan / retreat.
- A status readout: mode (scouting / re-planning / retreating / safe), and time-to-fire margin.
- A permanent on-screen label: **"Mock simulation — planning on the model's fire forecast. No physical robot."**

## Non-goals

- No robot physics, gait, or dynamics; the dog follows its path at a fixed speed.
- No real sensor modeling. "Feedback" (loop step 5 on the poster) is **not** simulated.
- No changes to the ML model or fire-spread code.
- No support for precomputed scenario playback or historical replays (live simulations only).

## Anti-goals (would be a failure even if it "works")

- Anything that could read as a real robot test. The mock label must be in every frame of the video and the still.
- The dog ever standing inside a burning cell in the demo run.
- Freezing or crashing the tab during the demo (the app has a history of OOM fixes — see recent `perf:`/`fix:` commits about capping layers and repaint throttling).

## Existing pieces to build on

- **Forecast = simulation history.** `history.baseline: SimulationState[]`, each a `Uint8Array` of cell states (`CellState`: Unburned/Burning/Burned), indexed by `currentStep`. From it, compute per-cell **predicted ignition step** (first step a cell is Burning). This is the hazard map.
- **Grid geometry:** `DEFAULT_CONFIG` — 600×600 cells, 50 m cells, 15-min timesteps (`src/simulation/types.ts`). Cells carry `lat`, `lng`, `elevation`; `elevationMap` (Float32Array) is held in `App.tsx`.
- **Wind convention:** `config.windDirection` is meteorological "from" degrees (`spread.ts` adds 180°).
- **Re-forecast from a mid-run grid:** `apiExtend` (dev server `/api/extend`) + the history-stitching pattern already used by the pause→draw→compute→resume flow in `App.tsx` (~lines 490–560). Reuse this: snapshot the grid at the shift step, extend with the new wind, stitch.
- **3D models on terrain:** `SuppressionVehicleLayer.tsx` shows the pattern for glTF entities from `public/models/*.glb`.
- **Robot model:** a three.js robot-dog model already exists at `docs/poster/src/robot-dog-3d.html`. Export it to `public/models/robot-dog.glb` (three.js `GLTFExporter`) so the in-app dog matches the poster style. (The user's photo-style poster image is 2D and can't be used in 3D.)

## Behaviour

### User flow

1. User starts a live simulation as usual (Simulate → click globe → Start).
2. A **"🐕 Robot Dog"** button appears (same placement pattern as "🛡 Suggest Containment"). Clicking it pauses playback and enters robot mode.
3. User clicks a **staging point** (where the dog starts; also its safe retreat point), then a **scout target** near the fire edge.
4. Playback resumes. The dog walks its route; blue route and green escape path are drawn on the terrain.
5. User presses **"🌬 Wind shift"** (or it fires automatically at a set time — see Video). The fire re-forecasts with the new wind; the dog re-plans; if no safe forward route exists it retreats along the escape path to staging.
6. "Exit robot mode" clears the layer and returns to normal.

### Planner (decided)

- **Time-dependent shortest path** (A* or Dijkstra) on the 8-connected grid from the dog's current cell to the target.
- **Robot speed:** 1.5 m/s on flat ground (~33 s per 50 m cell). Slope cost: travel time multiplied by `1 + k·|slope|`; cells with slope above ~35° are impassable. (k and the cap are builder's call; keep the dog plausible on steep Big Sur terrain.)
- **Safety rule:** a cell may be entered at time *t* only if its predicted ignition time is later than *t + margin*, margin default **30 min**. Already burning/burned cells are impassable.
- **Escape path:** at every re-plan, also compute a path from the dog's current cell back to staging under a stricter rule — every cell must stay unignited for a **60-min** horizon after the dog would pass. Draw it green.
- **Re-plan triggers:** on the wind shift, and whenever the current route or escape path stops satisfying its rule as time advances.
- **Retreat rule:** if no safe route to the target exists but the escape path does, follow the escape path and show "Retreating". If the dog reaches the target, show "Scouting fire edge" and hold for a few seconds before returning along the escape path.
- **Time-to-fire margin** shown in the HUD = minimum over the remaining route of (predicted ignition time − planned arrival time).

### Wind shift (decided)

- Scripted: rotate the wind so it blows **from the fire toward the dog**, pushing the fire at the dog (meteorological "from" bearing = bearing from the dog to the burning-cell centroid), and raise speed modestly (e.g., +10 km/h). This guarantees the story's re-plan moment. Being scripted is acceptable because the whole run is labeled a mock.
- Implementation: snapshot `history.baseline[currentStep]`, call the extend path with the modified config, stitch the new future onto the past, recompute the hazard map, trigger re-plan.
- The HUD and a toast announce: "Wind shifted to <dir> at <speed> km/h — fire re-forecast".

### Visuals

- Dog: `robot-dog.glb` clamped to terrain, heading along its path. Its position is **interpolated smoothly in time** between simulation steps (a 15-min step is ~27 cells of walking, so per-step jumps would look broken).
- Route: blue polyline on terrain; escape path: green; target: small flag/marker; staging: home marker.
- HUD panel (fire-panel style, matches existing UI): mode, margin, wind, and the permanent mock label.
- Camera: a "follow dog" toggle helps the video; default off for live use.

## Video and still (decided)

- Record with Playwright (Chrome, headed) against the dev server, scripted: Big Sur location, Summer seasonal weather, ignite, enter robot mode, place staging + target, auto wind shift at a fixed point, retreat. Output `docs/poster/media/robot-dog-demo.mp4` (ffmpeg is available via Playwright's bundled ffmpeg or Homebrew; builder's call).
- Still: a frame showing fire + dog + blue route + green escape path + mock label, cropped and added to the poster's right panel under "Status & next", with a caption like "Mock simulation: the robot dog re-plans after a wind shift." Update the status line "Robot-dog route planning on the forecast" from "next" to "in progress (mock simulation)". Rebuild PDFs with `docs/poster/build.sh`.

## Constraints

- Must run smoothly on the user's Mac in Chrome during a live demo; avoid per-frame canvas re-encodes (see OOM history). Planner runs off the render loop (worker or chunked) if it takes more than ~100 ms.
- Requires the dev API server (`npm run server`) for the wind-shift re-forecast, like the existing resume flow.
- Pure planner logic goes in `src/simulation/` (no React), with unit tests (vitest), matching project conventions.

## Calls made after the builder check (Claude's calls — user to confirm)

1. **Suppression conflict.** Robot mode is **disabled while a Suggest Containment result is active** (`history.suppressed` exists); the button is hidden in that state. The planner and wind-shift re-forecast work only on `history.baseline`, which is what's displayed when no suppression is active. The wind-shift extend call passes no suppression roster.
2. **Tunable numbers.** Speed, entry margin, escape margin, wind-shift strength/timing, pre-robot burn time and scripted target placement are all **tunable constants** in one config object. The values above are live-mode defaults. The recording script may use different values so beats 3–5 read clearly; a small headless tuning run of the planner against a real Big Sur history is in scope.
3. **No safe path.**
   - At placement: if the clicked staging or target cell is unsafe, **snap to the nearest safe cell** and show a short notice; if nothing safe is within ~1 km, reject the click with a message.
   - After the shift with neither route nor escape: the dog **holds position** and the HUD shows "No safe path — holding" in red. The scripted recording caps the shift so the escape path stays feasible (the honest failure state exists for live use but isn't the demo story).
4. **Exit robot mode** keeps the shifted fire on screen (no restore of the pre-shift future), to avoid holding a second ~180 MB history. Starting a new simulation resets everything as today.
5. **Poster space.** The right panel has ~5 in of free space between "Status & next" and the references footer (see the current render), enough for a full-width still about 4–5 in tall. No poster text needs to be cut; if it overflows, shrink the still, not text.

## Code facts the plan must account for

- `elevationMap` is a local inside the start-wildfire handler (`App.tsx` ~261), not state. Lift it (and `fuelMap`, already lifted for WaterOverlay) so the planner can compute slope and the wind-shift `/api/extend` call can pass terrain. The existing resume flow omits `elevationMap`; the wind-shift call must include it.

## Left to the builder

- File/component names, state-machine structure in `App.tsx`, A* vs Dijkstra, slope constants, marker styling, exact HUD layout, interpolation method, how the auto wind-shift is scheduled for recording, and video resolution/length within ~25–40 s.
