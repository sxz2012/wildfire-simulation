# Robot-Dog Feedback (Loop Step 5) — Design

**Date:** 2026-10-31
**Branch:** main (the robot-dog mock simulation already merged)
**Builds on:** `docs/superpowers/specs/2026-10-31-robot-dog-mock-simulation-design.md`
**Deadline:** live demo, re-recorded video and updated poster before the IEEE CIC NextGen poster session on **2026-11-06**.

## Intent

The poster's loop (center panel) has five steps: 1 Predict, 2 Safe route, 3 Escape path, 4 Scout, 5 Feedback. Steps 1–4 now run in the app's robot-dog mock simulation. Step 5 — "send back real fire position, wind and fuel so the next forecast is better" — does not.

The point the user wants judges to see: **the dog has better-quality data about its surroundings than the coarse inputs the forecast uses** (one archive weather value for the whole 30 km area, land cover seen from above). When the dog's on-the-ground readings are fed back, the forecast measurably improves.

The story (agreed with the user):

1. The forecast runs on coarse archive weather. A hidden "true" fire runs on the real local conditions. On screen, the fire you see is the true fire; a dashed yellow line is where the forecast thinks the edge is. The dog plans on the forecast.
2. A judge presses **Wind shift**. The *true* wind turns toward the dog and strengthens; the true fire turns and speeds up. The forecast does not know — the dashed line drifts away from the real edge and a "Forecast match" number drops. The dog is walking on stale information.
3. The dog reaches the fire edge and **automatically** sends its readings: wind, temperature, humidity, and where the fire edge really is.
4. A readings card pops up: measured vs forecast for each value. The forecast is re-run from the true fire edge with the measured weather; the dashed line snaps onto the real fire and the match number jumps.
5. The dog re-plans on the corrected forecast (or retreats along the escape path if it now must).

This replaces today's behaviour, where pressing Wind shift changes the forecast instantly — the forecast "knowing" about the shift was a cheat.

## Goals

- Two fires from the moment a robot mission starts: **true** (rendered as the fire) and **forecast** (rendered as a dashed edge line; the dog plans on it).
- **Wind shift** button (kept, user's choice) changes only the true conditions.
- **Automatic feedback** when the dog reaches the fire edge.
- **Readings card** (user picked mockup option C): measured vs forecast wind (direction + speed), temperature, humidity, and fire-edge offset; shown for a few seconds, then collapses into the robot HUD.
- **Forecast match** percentage visible throughout, so the drop after the shift and the jump after feedback are obvious.
- **Escape path always visible as a green line with arrows pointing home** (user requirement, applies to the whole robot mode, not only step 5).
- Re-recorded **video** and updated **poster** (see Poster).

## Non-goals

- No real sensor model, noise model or data-assimilation algorithm. "Feedback" = restart the forecast from the true fire state with the measured weather values.
- No fuel/land-cover feedback (the user named wind, temperature, humidity and fire edge only).
- No change to the ML model or the spread physics.
- No physical robot, still labelled "Mock simulation".

## Anti-goals

- The forecast must **not** become perfect after feedback. Close, not identical (the true world keeps its own differences). A 100% match would read as a trick.
- The dog must never stand in a burning cell of the **true** fire. Planning on a stale forecast is the story, but the existing safety margin plus the always-on escape path must keep the true-fire margin positive in the scripted demo; if the true fire does reach the dog's cell, the mission must retreat/hold honestly rather than render the dog inside fire.
- Nothing may present invented "true" conditions as real measurements. On-screen text says the readings are simulated.

## How it behaves

### Two worlds

- When a mission starts at step *s*, fork the fire at its state at *s* into two runs:
  - **True run:** archive weather adjusted to "real local conditions". The builder's call (mine) is that true conditions start a little hotter and drier than the archive (e.g. +5 °C, −10 % humidity) so the forecast starts slightly off — roughly 85–90 % match — not perfect.
  - **Forecast run:** the current archive weather, unchanged.
- The **fire layer** shows the true run. The **forecast** shows as a dashed yellow outline of its burning/burned area. The dog's planner hazard map comes from the forecast run.
- Both runs use the existing extend path (`apiExtend` from a grid snapshot), so no new physics.
- Both runs must pass the archive weather (temperature, precipitation) to `apiExtend`; today's wind-shift call omits it and the model silently falls back to 25/35 °C, which would make the readings card dishonest.

### Wind shift (button, unchanged placement and enable rules)

- Changes the **true** run only: true wind turns toward the dog and strengthens (reuse `shiftedWind`). Re-run the true fire from the current step.
- The forecast and the dog's plan do not change. The match number drops as the runs diverge.
- Enabled after a mission starts; one shift per mission; disabled once the mission is done (existing rules).

### Feedback (automatic)

- Fires when the dog reaches the fire edge (mission enters scouting).
- If Wind shift is pressed while the dog is already scouting at the edge, it reports again immediately (builder's call: it is standing right there).
- Builder's call (mine): the dog reports whenever it can *see* the true fire — on reaching the edge, **or** earlier/later if the true fire comes within its entry safety margin (e.g. during outbound after a shift, or while walking home). This is also the true-fire safety check: a report re-forecasts from the true state, so the existing state machine re-plans or retreats on correct data, and the dog can never walk into the true fire on stale data unseen. A Wind shift pressed while the dog walks home does not trigger a report by itself; only the true fire coming close does.
- Readings = the true run's conditions at that moment: wind direction and speed, temperature, humidity; plus the fire-edge offset = distance between the forecast's nearest edge and the true fire's nearest edge to the dog.
- Effect: the forecast run restarts from the **true** fire state at the current step with the **measured** weather. The planner hazard map updates; the mission re-plans or retreats through the existing state machine.
- It does not make the forecast identical: the true run keeps its own differences (the "local conditions" adjustment is applied on top of the measured values only in the true run — builder's call how; see Left to the builder).

### Scrubbing (user's choice: rewindable)

- Dragging the timeline back before the dog's report restores the **pre-report forecast**: the dashed line drifts again, the match number drops back, and the readings card is not shown. Scrubbing forward past the report minute shows the corrected forecast and the card again — without the dog "reporting a second time" as a new event.
- Same for the Wind shift: scrubbing back before the shift shows the true fire as it was before the shift.
- So the forecast and the true fire are stored as time segments (each with the minute it starts), and the view picks the segment for the current minute. The dog's mission log (`syncMission`) replays against the segment in force at each minute.
- Memory stays bounded: each segment covers at most the existing 96-step window from its start.



- Builder's call (mine): overlap of forecast vs true fire area (burning + burned cells, intersection over union) over the next few hours from the current step, as a percentage.
- Shown in the robot HUD at all times during a mission; the readings card shows the before → after jump.

### Readings card

- Pops up near the robot HUD when feedback fires; a dotted blue "signal" line from the dog toward it is a nice-to-have.
- Content: "Measured vs forecast" — Wind 290° 28 km/h (270° 15) · Temp 38 °C (31) · Humidity 12 % (30) · Fire edge 400 m closer · "Forecast match 58 % → 91 %". Values are whatever the runs produce; these are placeholders.
- Stays a few seconds, then collapses into a line in the HUD (builder's call).

### Escape path

- Always visible during a mission as a **green** line with **arrows pointing toward staging** (direction of travel home).

## Video

- Re-record with the existing script (`docs/poster/scripts/record_robot_demo.py`), updated: mission starts, forecast slightly off, Wind shift pressed during outbound, dashed line drifts, dog reaches edge, readings card, snap, re-plan, return home. Target 25–40 s, ending at "Safe at staging".
- Also capture stills for the poster (one per step, below).

## Poster (agreed layout)

- **Left panel = prediction:** Why → How we predict the fire → The simulator (Big Sur screenshots) → **Results** (moved from the right panel: 6 unseen fires, AUC 0.75 vs 0.50, Brier 0.076 vs 0.083, takeaway). If space is tight, tighten the flow diagram rather than shrinking text below poster size.
- **Center panel:** unchanged loop, except **step 5 turns orange** ("built & tested in simulation"). Its text may be tuned to match what's built.
- **Right panel = the dog's loop in simulation:**
  - One-line intro: mock simulation on the real forecast, no physical robot.
  - **② Safe route** (wide still): blue route bending around the forecast fire.
  - **③ Escape path** (wide still): green line with arrows home.
  - **④ Scout** and **⑤ Feedback** side by side; ⑤ shows the readings card and the match jump.
  - Short captions per still; QR + references footer; QR caption mentions the demo video in the repo.
  - "Status & next" (user's list): done — ML fire forecast, 3D simulator on real terrain, containment planner, robot-dog loop (route, escape, scout, feedback) in mock simulation; next — run forecast + planner on the dog or its controller; real sensors feeding the forecast; scout the planned containment line; tests on real robot dogs.
- **"Where to hold the line"** comes off the poster for now (the containment feature stays in the app).
- Rebuild all three PDFs with `docs/poster/build.sh`; each must stay one page with the footer unclipped.

## Constraints

- Existing stack and patterns: React + Cesium, pure robot modules in `src/simulation/robot/`, dev API server (`npm run server`) for `apiExtend`.
- React 19 dev logging deep-diffs props: any history replacement must avoid swapping 600×600 grids in place inside props (see `tailReplaceCommits`). Two runs double the exposure — keep large grids out of changed props.
- Memory: the existing single history already uses ~1 GB in the browser during playback. Two runs must be bounded (e.g. the existing 96-step re-forecast window per run).
- Robot mode keeps working after any live simulation; existing tests stay green; new behaviour test-first.

## Left to the builder

- Exact "true local conditions" offsets and how they persist through feedback (so the forecast is close but not identical).
- Forecast-match window length and whether to sample every step or every few steps.
- Dashed outline rendering technique (polyline of the forecast perimeter vs canvas overlay).
- Readings card timing and collapse behaviour.
- Arrow spacing/size on the escape path.
- Which frames of the recording become the four poster stills.
