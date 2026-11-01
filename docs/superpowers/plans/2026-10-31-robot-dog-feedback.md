# Robot-Dog Feedback (Loop Step 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the robot-dog mock simulation into a hidden "true" fire and the dog's forecast, let a Wind shift change only the truth, have the dog report its readings at the fire edge so the forecast snaps back, keep it all rewindable on the timeline, then re-record the video and restructure the poster.

**Architecture:** New pure module `src/simulation/robot/worlds.ts` holds conditions, forecast versions (time-stamped), the report rule and the comparison metrics. The **true fire is the displayed history** (`history.baseline`, stitched with `tailReplaceCommits`), so rewinding the truth is free. The **forecast is a list of versions** `{ fromMin, history, grid }`; the version in force at a minute is the one with the latest `fromMin ≤ minute`, which makes the forecast, the dog's plan, the match number and the readings card rewindable. `syncMission` takes a `gridAt(min)` function so the dog replays against the forecast known at each minute.

**Tech Stack:** TypeScript, React 19, CesiumJS imperative entities/collections, Vitest, existing dev API (`apiExtend`), Python Playwright + `ffmpeg` (recording), headless Chrome (poster PDFs).

**Spec:** `docs/superpowers/specs/2026-10-31-robot-dog-feedback-design.md`

## Global Constraints

- Mock label stays visible; readings text must say values are simulated: card title **"Dog readings (simulated) — measured vs forecast"**.
- True local conditions vs archive: **tempC +5, humidity −10 (floor 5)**, same wind (`TRUE_LOCAL_OFFSET`).
- `apiExtend` calls for both worlds pass `weather: { tempMean: tempC, tempMax: tempC + 5, precipitation: 0, cumulativePrecip: 0 }` (same mapping as `handleStartWildfire`), `suppression: null`, the `elevationMap`, and at most **96** steps (`WIND_SHIFT_WINDOW_STEPS`).
- Forecast match = IoU of interior cells that are not Unburned, forecast vs truth, at `min(step + 16, last step)` (**16 steps = 4 h**), shown as an integer percent.
- Readings card visible while `report.min ≤ now < report.min + 3 × timestep`; afterwards the HUD shows "Last report: 58% → 91%" (real numbers).
- Escape path: always visible while a mission is active, green `#2E8540`, with arrowheads pointing toward staging every **12 cells** (600 m).
- **Never pass a `Uint8Array`, `SimulationState[]` or forecast-version list as a React prop** (React 19 dev logging deep-walks changed props; see `tailReplaceCommits`). Pass small derived arrays/primitives only.
- Pure logic in `src/simulation/robot/` has no React/Cesium imports; tests in `src/simulation/__tests__/`.
- Coordinates as before: `idx = row * n + col`, row north, col east; wind is meteorological "from".

## Review Focus

- Scrub back before the report (or the shift) and forward again → dashed line, match number, card and dog pose match what was shown the first time; no second report is created. (Task 1 `shouldReport` test + Task 4 manual check.)
- Dev API down at mission launch or at report time → launch refused / report skipped with a visible notice; the old forecast and the dog keep working; playback resumes. (Task 4 step.)
- Wind shift never pressed → the dog still reports at the edge and the match improves modestly (the hotter/drier offset); Wind shift pressed while walking home → no report unless the true fire comes within the entry margin. (Task 1 tests.)
- True fire reaches within the entry margin of the dog during outbound → it reports early and the mission re-plans/retreats on the corrected forecast; it is never drawn inside a true burning cell. (Task 1 test + Task 4 check.)
- 5× playback with two worlds → no freeze, no per-step deep prop diffs of grids, outline update ≤ ~1500 points. (Task 5 constraint + Task 4 check.)

---

### Task 1: Worlds — conditions, forecast versions, report rule

**Files:**
- Create: `src/simulation/robot/worlds.ts`
- Test: `src/simulation/__tests__/robotWorlds.test.ts`

**Interfaces:**
- Consumes: `PlannerGrid` (`robot/types.ts`), `SimulationState`, `CellState` (`simulation/types.ts`), `MissionPhase` (`robot/mission.ts`).
- Produces:
  - `interface Conditions { windDirection: number; windSpeed: number; humidity: number; tempC: number }`
  - `const TRUE_LOCAL_OFFSET = { tempC: 5, humidity: -10 }`
  - `trueConditions(archive: Conditions): Conditions`
  - `conditionsWeather(c: Conditions): { tempMean: number; tempMax: number; precipitation: number; cumulativePrecip: number }`
  - `interface ForecastVersion { fromMin: number; history: SimulationState[]; grid: PlannerGrid }`
  - `forecastAt(versions: ForecastVersion[], min: number): ForecastVersion` (first version applies to all earlier minutes)
  - `interface Report { min: number; measured: Conditions; assumed: Conditions; edgeOffsetM: number; matchBefore: number; matchAfter: number }`
  - `shouldReport(a: { phase: MissionPhase | null; trueFireNear: boolean; nowMin: number; reports: Report[]; shiftMin: number | null }): boolean`
  - `activeReport(reports: Report[], nowMin: number, timestepMin: number): { report: Report | null; cardVisible: boolean }`

- [ ] **Step 1: Write the failing tests** (`robotWorlds.test.ts`)

```ts
it("trueConditions: hotter and drier, wind unchanged, humidity floored", () => {
  expect(trueConditions({ windDirection: 270, windSpeed: 15, humidity: 30, tempC: 31 }))
    .toEqual({ windDirection: 270, windSpeed: 15, humidity: 20, tempC: 36 });
  expect(trueConditions({ windDirection: 0, windSpeed: 5, humidity: 8, tempC: 20 }).humidity).toBe(5);
});
it("conditionsWeather maps like handleStartWildfire", () => {
  expect(conditionsWeather({ windDirection: 0, windSpeed: 0, humidity: 0, tempC: 30 }))
    .toEqual({ tempMean: 30, tempMax: 35, precipitation: 0, cumulativePrecip: 0 });
});
it("forecastAt picks the latest version starting at or before the minute", () => {
  const v = [{ fromMin: 100 }, { fromMin: 400 }] as ForecastVersion[];
  expect(forecastAt(v, 0)).toBe(v[0]);
  expect(forecastAt(v, 399)).toBe(v[0]);
  expect(forecastAt(v, 400)).toBe(v[1]);
});
describe("shouldReport", () => {
  const base = { phase: "outbound" as const, trueFireNear: false, nowMin: 500, reports: [], shiftMin: null };
  it("reports on reaching the edge", () => expect(shouldReport({ ...base, phase: "scouting" })).toBe(true));
  it("reports early when the true fire comes near", () => expect(shouldReport({ ...base, trueFireNear: true })).toBe(true));
  it("does not report while just walking", () => expect(shouldReport(base)).toBe(false));
  it("once per new information: no repeat while still scouting", () =>
    expect(shouldReport({ ...base, phase: "scouting", reports: [{ min: 450 } as Report] })).toBe(false));
  it("reports again after a shift newer than the last report", () =>
    expect(shouldReport({ ...base, phase: "scouting", reports: [{ min: 450 } as Report], shiftMin: 480 })).toBe(true));
  it("a shift while walking home alone does not report", () =>
    expect(shouldReport({ ...base, phase: "returning", reports: [{ min: 450 } as Report], shiftMin: 480 })).toBe(false));
  it("after a rewind (a future report exists) no new report is made", () =>
    expect(shouldReport({ ...base, phase: "scouting", reports: [{ min: 600 } as Report] })).toBe(false));
});
it("activeReport: card for 3 steps after the report, then collapsed; none before", () => {
  const r = [{ min: 450 } as Report];
  expect(activeReport(r, 440, 15)).toEqual({ report: null, cardVisible: false });
  expect(activeReport(r, 450, 15)).toEqual({ report: r[0], cardVisible: true });
  expect(activeReport(r, 494, 15).cardVisible).toBe(true);
  expect(activeReport(r, 495, 15)).toEqual({ report: r[0], cardVisible: false });
});
```

- [ ] **Step 2: Run** `npx vitest run src/simulation/__tests__/robotWorlds.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `worlds.ts` with the signatures above. `shouldReport`: false if any report has `min > nowMin`; trigger = `phase === "scouting" || trueFireNear`; covered = a report exists with `min ≤ nowMin` and `min ≥ (shiftMin ?? -Infinity)` — except that a shift while not scouting and not near never triggers by itself (it only un-covers). `activeReport` uses the latest report with `min ≤ nowMin`.
- [ ] **Step 4: Run** the test file — Expected: PASS. Then `npm test` — all green.
- [ ] **Step 5: Commit** `git commit -m "feat(robot): true vs forecast worlds, forecast versions and report rule"`

### Task 2: Comparison metrics and drawing helpers

**Files:**
- Modify: `src/simulation/robot/worlds.ts`
- Test: `src/simulation/__tests__/robotWorlds.test.ts`

**Interfaces:**
- Produces:
  - `forecastMatch(forecast: Uint8Array, truth: Uint8Array, n: number): number` — integer percent IoU of interior (rows/cols 1..n−2) cells `!== CellState.Unburned`; 100 when both sets are empty.
  - `matchAtHorizon(forecast: SimulationState[], truth: SimulationState[], step: number, n: number, horizonSteps = 16): number` — compares both at `min(step + horizonSteps, forecast.length − 1, truth.length − 1)`.
  - `edgeOffsetMeters(forecast: Uint8Array, truth: Uint8Array, dogIdx: number, n: number, cellSizeM: number): number` — (distance to nearest forecast Burning cell) − (distance to nearest true Burning cell), rounded to 10 m; positive = true fire closer than forecast. Infinity-safe: 0 if either has no Burning cells.
  - `forecastEdgeCells(state: Uint8Array, n: number, maxPoints = 1500): number[]` — interior affected cells with ≥1 Unburned 4-neighbour, uniformly strided down to ≤ maxPoints.
  - `arrowChunks(cells: number[], every = 12): Array<[number, number]>` — `[fromIdxInPlan, toIdxInPlan]` pairs covering the path in consecutive chunks of `every` cells (last chunk may be shorter, min length 2).

- [ ] **Step 1: Write the failing tests**

```ts
const N = 10, grid = (cells: number[], v = CellState.Burning) => { const g = new Uint8Array(N * N); cells.forEach(c => (g[c] = v)); return g; };
it("forecastMatch: identical 100, disjoint 0, half overlap 33", () => {
  expect(forecastMatch(grid([22, 23]), grid([22, 23]), N)).toBe(100);
  expect(forecastMatch(grid([22]), grid([77]), N)).toBe(0);
  expect(forecastMatch(grid([22, 23]), grid([23, 24]), N)).toBe(33);
});
it("forecastMatch ignores the burned border", () => {
  const a = grid([22]); a[0] = CellState.Burned; a[9] = CellState.Burned;
  expect(forecastMatch(a, grid([22]), N)).toBe(100);
});
it("edgeOffsetMeters: true fire 2 cells closer → +100 m at 50 m cells", () => {
  const dog = 5 * N + 1;
  expect(edgeOffsetMeters(grid([5 * N + 8]), grid([5 * N + 6]), dog, N, 50)).toBe(100);
});
it("forecastEdgeCells returns the ring, not the interior", () => {
  const block: number[] = []; for (let r = 3; r <= 5; r++) for (let c = 3; c <= 5; c++) block.push(r * N + c);
  const edge = forecastEdgeCells(grid(block), N);
  expect(edge).not.toContain(4 * N + 4);
  expect(edge.length).toBe(8);
  expect(forecastEdgeCells(grid(block), N, 4).length).toBeLessThanOrEqual(4);
});
it("arrowChunks splits a 30-cell path into 12-cell chunks", () => {
  expect(arrowChunks(Array.from({ length: 30 }, (_, i) => i))).toEqual([[0, 12], [12, 24], [24, 29]]);
});
```

- [ ] **Step 2: Run** the test file — Expected: FAIL (functions not exported).
- [ ] **Step 3: Implement** the five functions in `worlds.ts`. `edgeOffsetMeters` may scan all cells (called once per report).
- [ ] **Step 4: Run** test file, then `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(robot): forecast match, edge offset and drawing helpers"`

### Task 3: Mission replays against the forecast known at each minute

**Files:**
- Modify: `src/simulation/robot/mission.ts` (`syncMission`)
- Modify: `src/App.tsx` (the one `syncMission` call — pass `() => plannerGrid` for now)
- Test: `src/simulation/__tests__/robotMission.test.ts`

**Interfaces:**
- Produces: `syncMission(log: MissionEntry[], nowMin: number, stepMin: number, gridAt: (min: number) => PlannerGrid, robot: RobotConfig): MissionEntry[]` — each replayed minute uses `gridAt(min)`; the same-minute re-check fires when `gridAt(nowMin) !== last.grid`.

- [ ] **Step 1: Write the failing test** (and change existing `syncMission` tests to pass `() => g`)

```ts
it("replays each minute against the forecast in force at that minute", () => {
  const old = openGrid(), corrected = openGrid();
  for (let r = 0; r < N; r++) corrected.ignitionMin[idx(r, 20)] = 30 + STEP + 10; // only the corrected forecast sees fire
  const gridAt = (min: number) => (min >= 30 + STEP ? corrected : old);
  const log = syncMission(start(), 30 + STEP, STEP, gridAt, ROBOT_DEFAULTS);
  expect(log.at(-1)!.grid).toBe(corrected);
  expect(log.at(-1)!.mission.phase).toBe("retreating");
  const back = syncMission(log, 30, STEP, gridAt, ROBOT_DEFAULTS);
  expect(back.at(-1)!.mission.phase).toBe("outbound");
});
```

- [ ] **Step 2: Run** `npx vitest run src/simulation/__tests__/robotMission.test.ts` — Expected: FAIL (type error / wrong phase).
- [ ] **Step 3: Implement** the signature change; update the App call site to `() => plannerGrid`.
- [ ] **Step 4: Run** `npm test` and `npx tsc -b` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git commit -m "refactor(robot): syncMission takes the forecast in force per minute"`

### Task 4: App wiring — two worlds, truth-only wind shift, automatic report, rewind

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Tasks 1–3; `apiExtend`, `rleDecode`, `tailReplaceCommits`, `computeIgnitionMinutes`, `passableFromFuel`, `shiftedWind`, `burningCentroid`.
- Produces (for Tasks 5–6):
  - `RobotState` gains `forecasts: ForecastVersion[]`, `reports: Report[]`, `archive: Conditions`, `truth: Conditions`, `shiftMin: number | null`, `reportPending: boolean`.
  - Derived per render: `forecastNow = forecastAt(robot.forecasts, robotNowMin)`, `plannerGrid = forecastNow.grid`, `matchPct` (`matchAtHorizon(forecastNow.history, history.baseline, currentStep, n)`), `forecastEdge` (`forecastEdgeCells(forecastNow.history[step].grid, n)` — a `number[]`), `{ report, cardVisible } = activeReport(...)`.
  - `window.__robotDemo.start` returns `Promise<string | null>`; `state()` adds `reports: number`, `match: number | null`.

- [ ] **Step 1: Store archive conditions.** In `handleStartWildfire`, keep `{ windDirection, windSpeed, humidity, tempC: weather.temperature }` in new state `archiveConditions` (cleared by `runReset`).
- [ ] **Step 2: Launch forks the worlds** (`launchMission` becomes async; notice "Preparing the true fire…" while pending):
  - `version0 = { fromMin: -Infinity, history: history.baseline, grid: <current plannerGrid> }` — the archive forecast as it is.
  - `truth = trueConditions(archive)`; `apiExtend` from `history.baseline[step]` with `truth` (config wind/humidity + `conditionsWeather`), 96 steps; stitch into `history.baseline` with `tailReplaceCommits` + `flushSync` (same as today's wind shift). The displayed fire is now the truth.
  - `createMission` against `version0.grid`; refuse with existing messages (`No safe route…`, `Not enough forecast left…`) and on API error: "Couldn't start — is the dev server running? (npm run server)".
- [ ] **Step 3: Wind shift changes only the truth.** `handleWindShift`: new true wind via `shiftedWind` (from the dog toward the true fire's burning centroid); `apiExtend` from the truth state at `step` with the shifted truth conditions; stitch into `history.baseline`; set `robot.truth` and `robot.shiftMin = robotNowMin`. Do **not** call `setActiveConfig` or touch `forecasts`. Weather label: "True wind shifted — the forecast doesn't know yet".
- [ ] **Step 4: Planner grid comes from forecast versions.** Replace the `plannerGrid` memo: `ignitionMin` per version computed once when the version is created (store it in `version.grid`); `syncMission(..., (min) => forecastAt(robot.forecasts, min).grid, ...)`. Remove the old memo over `history.baseline`.
- [ ] **Step 5: Automatic report.** Effect after the mission sync: `trueFireNear = trueIgn[dogCell] - robotNowMin < entryMarginMin` (true ignition map = `computeIgnitionMinutes(history.baseline, ts)`, memoized on `history.baseline`); if `shouldReport({...})` and not `reportPending`: pause playback; `measured = robot.truth`; `matchBefore = matchPct`; `apiExtend` from the truth state at `step` with `measured`; new version `{ fromMin: robotNowMin, history: [...forecastNow.history.slice(0, step + 1), ...resumed.slice(1)], grid }`; `matchAfter` computed on it; push `Report { min, measured, assumed: archive-or-last-measured, edgeOffsetM, matchBefore, matchAfter }`; resume playback. On API error: notice "Dog report failed — is the dev server running?", no version added.
- [ ] **Step 6: Run** `npx tsc -b && npm test` — Expected: clean, all green.
- [ ] **Step 7: Manual check** (both dev servers up; adapt `check_robot.py` flow): mission start → match ~85–90 %; Wind shift during outbound → match drops; dog reaches edge → report, card, match jumps, re-plan; scrub back before the report → old dashed line and match; forward → same report, no new one. Playback at 5× does not freeze.
- [ ] **Step 8: Commit** `git commit -m "feat(robot): true vs forecast fire, truth-only wind shift, automatic dog report"`

### Task 5: Visuals — forecast outline, escape arrows, match and readings card

**Files:**
- Create: `src/components/ForecastOutlineLayer.tsx`
- Create: `src/components/ReadingsCard.tsx`
- Modify: `src/components/RobotDogLayer.tsx` (escape arrows)
- Modify: `src/components/RobotDogHUD.tsx` (match line, last-report line)
- Modify: `src/App.tsx` (render the new pieces)

**Interfaces:**
- Consumes: `forecastEdge: number[]`, `matchPct`, `report`, `cardVisible` from Task 4; `arrowChunks` from Task 2.
- Produces:
  - `ForecastOutlineLayer({ viewer, edgeCells: number[], gridSize, cellSizeMeters, centerLat, centerLng })` — a `BillboardCollection({ scene })` of small pale-yellow (`#FFF3A0`) dots, `heightReference: CLAMP_TO_GROUND`, rebuilt only when `edgeCells` changes.
  - `ReadingsCard({ report: Report })` — title from Global Constraints; rows: Wind `290° 28 km/h (270° 15)`, Temp `38 °C (31)`, Humidity `12 % (30)`, Fire edge `400 m closer` (or `farther`), and `Forecast match 58% → 91%`; measured values bold, assumed in parentheses.
  - `RobotDogHUD` new props `matchPct: number | null`, `lastReport: Report | null` → lines "Forecast match: N%" and, when the card is collapsed, "Last report: A% → B%".
  - `RobotDogLayer`: escape drawn as the existing green line plus one `PolylineArrowMaterialProperty(ESCAPE_COLOR)` ground polyline per `arrowChunks(escape.cells)` chunk (width 12); rebuilt only when the escape plan object changes.
- [ ] **Step 1: Implement** the components and props above; legend in the HUD adds "forecast edge" (yellow dots).
- [ ] **Step 2: Run** `npx tsc -b && npm test` — Expected: clean, green.
- [ ] **Step 3: Manual check:** screenshot shows yellow dotted forecast edge, green escape with arrowheads pointing home, HUD match number, readings card for ~3 steps then the collapsed line.
- [ ] **Step 4: Commit** `git commit -m "feat(robot): forecast edge, escape arrows, match and readings card"`

### Task 6: Re-record the video and capture four step stills

**Files:**
- Modify: `docs/poster/scripts/record_robot_demo.py`
- Create/replace: `docs/poster/media/robot-dog-demo.mp4`, `docs/poster/img/step2-route.jpg`, `step3-escape.jpg`, `step4-scout.jpg`, `step5-feedback.jpg`
- Delete: `docs/poster/img/robot-mock.jpg` (replaced)

- [ ] **Step 1: Update the script:** `await` the now-async `start`; press Wind shift ~5 s into outbound; wait for `state().reports >= 1`; capture stills: step 2 right after start (route), step 3 a few seconds later (escape arrows clearly visible; crop to the escape), step 4 when phase becomes `scouting`, step 5 while the card is visible; 0.5× on the way home; stop at `done` or 45 s; trim and convert as today (target 25–40 s, may run to 45 s if the card needs time).
- [ ] **Step 2: Run** with both servers up — Expected: MP4 25–45 s ending at "Safe at staging"; four stills show their step, mock label visible in at least the step 5 still.
- [ ] **Step 3: Commit** `git commit -m "feat(poster): feedback demo video and step 2–5 stills"`

### Task 7: Poster restructure

**Files:**
- Modify: `docs/poster/left.html`, `docs/poster/center.html`, `docs/poster/right.html`; rebuild `docs/poster/out/*.pdf`

- [ ] **Step 1: Left panel:** append the **Results** section moved verbatim from `right.html` (metrics, bars, takeaway, its CSS). If it overflows 36 in, tighten the "How we predict" flow spacing before any font change.
- [ ] **Step 2: Center panel:** step 5 node gets class `built`; text: "Send back measured wind, temperature, humidity and the real fire edge so **the next forecast is better**."
- [ ] **Step 3: Right panel:** remove "Results" and "Where to hold the line". New section **"Robot dog in simulation"**: one line "Mock simulation on the real forecast — no physical robot."; ② and ③ full-width stills with captions; ④ and ⑤ side by side with captions (⑤ mentions the match jump with the real numbers from the run); "Status & next": done — ML fire forecast trained and tested · 3D browser simulator on real terrain · Containment planner (search) · Robot-dog loop (route, escape, scout, feedback) in mock simulation; next — Run forecast + planner on the dog or its controller · Real sensors feeding the forecast · Scout the planned containment line · Tests on real robot dogs. QR caption: "Open-source code + demo video".
- [ ] **Step 4: Run** `bash docs/poster/build.sh`; render each PDF with `sips -s format png -Z 1400` — Expected: each one page, footers unclipped, stills legible.
- [ ] **Step 5: Commit** `git commit -m "docs(poster): prediction left, dog loop simulated on the right, step 5 built"`
