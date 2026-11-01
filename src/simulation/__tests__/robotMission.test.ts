import { describe, it, expect } from "vitest";
import {
  createMission,
  advanceMission,
  missionPose,
  missionMarginMin,
  missionFitsForecast,
  syncMission,
} from "../robot/mission";
import { ROBOT_DEFAULTS } from "../robot/types";
import type { PlannerGrid } from "../robot/types";

const N = 30;
const idx = (r: number, c: number) => r * N + c;
const STAGING = idx(15, 2), TARGET = idx(15, 27);

function openGrid(): PlannerGrid {
  return { gridSize: N, cellSizeMeters: 50, ignitionMin: new Float32Array(N * N).fill(Infinity) };
}

describe("mission", () => {
  it("happy path: outbound → scouting → returning → done", () => {
    const g = openGrid();
    let m = createMission(STAGING, TARGET, 0, g, ROBOT_DEFAULTS);
    expect(m.phase).toBe("outbound");
    expect(m.route).not.toBeNull();
    expect(m.escape).not.toBeNull();

    const before = missionPose(m, -5, N);
    expect([before.row, before.col]).toEqual([15, 2]);

    const end = m.route!.arrivalMin.at(-1)!;
    const mid = missionPose(m, end / 2, N);
    expect(mid.col).toBeGreaterThan(2);
    expect(mid.col).toBeLessThan(27);
    expect(mid.headingDeg).toBeCloseTo(90, 5);

    m = advanceMission(m, end / 2, g, ROBOT_DEFAULTS);
    expect(m.phase).toBe("outbound");
    m = advanceMission(m, end, g, ROBOT_DEFAULTS);
    expect(m.phase).toBe("scouting");
    m = advanceMission(m, end + ROBOT_DEFAULTS.scoutHoldMin + 1, g, ROBOT_DEFAULTS);
    expect(m.phase).toBe("returning");
    expect(m.route!.cells.at(-1)).toBe(STAGING);
    m = advanceMission(m, m.route!.arrivalMin.at(-1)!, g, ROBOT_DEFAULTS);
    expect(m.phase).toBe("done");
    const home = missionPose(m, 1e6, N);
    expect([home.row, home.col]).toEqual([15, 2]);
  });

  function assertNeverInFire(m: ReturnType<typeof createMission>, g: PlannerGrid, from: number) {
    const to = m.route!.arrivalMin.at(-1)!;
    for (let t = from; t <= to; t += 0.25) {
      const p = missionPose(m, t, N);
      const cell = Math.round(p.row) * N + Math.round(p.col);
      expect(g.ignitionMin[cell]).toBeGreaterThan(t);
    }
  }

  it("wind shift: re-plans around new fire on the route", () => {
    let m = createMission(STAGING, TARGET, 0, openGrid(), ROBOT_DEFAULTS);
    const now = 2; // dog is a few cells out
    const shifted = openGrid();
    for (let r = 8; r <= 22; r++) shifted.ignitionMin[idx(r, 20)] = now + 10;
    m = advanceMission(m, now, shifted, ROBOT_DEFAULTS);
    expect(m.phase).toBe("outbound");
    expect(m.replanCount).toBe(1);
    expect(m.event).toBe("Re-planned: fire forecast changed");
    for (let r = 8; r <= 22; r++) expect(m.route!.cells).not.toContain(idx(r, 20));
    assertNeverInFire(m, shifted, now);
  });

  it("wind shift: retreats when the target becomes unreachable", () => {
    let m = createMission(STAGING, TARGET, 0, openGrid(), ROBOT_DEFAULTS);
    const now = 2;
    const shifted = openGrid();
    for (let r = 0; r < N; r++) shifted.ignitionMin[idx(r, 20)] = now + 10;
    m = advanceMission(m, now, shifted, ROBOT_DEFAULTS);
    expect(m.phase).toBe("retreating");
    expect(m.event).toBe("No safe route forward — retreating");
    expect(m.route!.cells.at(-1)).toBe(STAGING);
    assertNeverInFire(m, shifted, now);
  });

  it("no escape: holds when surrounded by fire", () => {
    let m = createMission(STAGING, TARGET, 0, openGrid(), ROBOT_DEFAULTS);
    const now = 2;
    const shifted = openGrid();
    shifted.ignitionMin.fill(now + 5);
    m = advanceMission(m, now, shifted, ROBOT_DEFAULTS);
    expect(m.phase).toBe("holding");
    expect(m.event).toBe("No safe path — holding");
    expect(m.escape).toBeNull();
  });

  it("paused time: advancing twice at the same minute is idempotent", () => {
    const g = openGrid();
    const m0 = createMission(STAGING, TARGET, 0, g, ROBOT_DEFAULTS);
    const a = advanceMission(m0, 3, g, ROBOT_DEFAULTS);
    const b = advanceMission(a, 3, g, ROBOT_DEFAULTS);
    expect(b.phase).toBe(a.phase);
    expect(b.route).toEqual(a.route);
    expect(b.escape).toEqual(a.escape);
    expect(missionPose(b, 3, N)).toEqual(missionPose(a, 3, N));
  });

  it("missionMarginMin reports the closest fire along the remaining route", () => {
    const g = openGrid();
    g.ignitionMin[idx(15, 20)] = 200;
    const m = createMission(STAGING, TARGET, 0, g, ROBOT_DEFAULTS);
    const arr = m.route!.arrivalMin[m.route!.cells.indexOf(idx(15, 20))];
    expect(missionMarginMin(m, 0, g)).toBeCloseTo(200 - arr, 4);
    expect(missionMarginMin(createMission(STAGING, TARGET, 0, openGrid(), ROBOT_DEFAULTS), 0, openGrid())).toBe(Infinity);
  });

  it("keeps an escape path under the entry margin when the stricter escape margin fails", () => {
    // Fire reaches every cell at minute 50: 60-min escape margin is already
    // impossible at t=0, but a 30-min margin still leaves a way home.
    const g = openGrid();
    g.ignitionMin.fill(50);
    let m = createMission(STAGING, TARGET, 0, g, ROBOT_DEFAULTS);
    expect(m.phase).toBe("outbound");
    expect(m.escape).not.toBeNull();
    m = advanceMission(m, 2, g, ROBOT_DEFAULTS);
    expect(m.escape).not.toBeNull();
    expect(m.escape!.cells.at(-1)).toBe(STAGING);
  });

  it("scouting: fire approaching the target sends the dog home instead of trapping it", () => {
    const g = openGrid();
    let m = createMission(STAGING, TARGET, 0, g, ROBOT_DEFAULTS);
    const end = m.route!.arrivalMin.at(-1)!;
    m = advanceMission(m, end, g, ROBOT_DEFAULTS);
    expect(m.phase).toBe("scouting");
    const shifted = openGrid();
    shifted.ignitionMin[TARGET] = end + 1 + 20; // target ignites in 20 min, everything else clear
    m = advanceMission(m, end + 1, shifted, ROBOT_DEFAULTS);
    expect(m.phase).toBe("returning");
    expect(m.event).toBe("Fire approaching — heading back");
    expect(m.route!.cells.at(-1)).toBe(STAGING);
  });

  it("outbound: a threat to the dog's own cell makes it move, not hold", () => {
    const g = openGrid();
    let m = createMission(STAGING, TARGET, 0, g, ROBOT_DEFAULTS);
    const now = 2;
    const pose = missionPose(m, now, N);
    const here = Math.round(pose.row) * N + Math.floor(pose.col);
    const shifted = openGrid();
    shifted.ignitionMin[here] = now + 10;
    m = advanceMission(m, now, shifted, ROBOT_DEFAULTS);
    expect(m.phase).not.toBe("holding");
  });

  it("escape path is re-checked while the dog stands still", () => {
    const g = openGrid();
    let m = createMission(STAGING, TARGET, 0, g, ROBOT_DEFAULTS);
    const end = m.route!.arrivalMin.at(-1)!;
    m = advanceMission(m, end, g, ROBOT_DEFAULTS); // scouting at the target
    const oldEscape = m.escape!;
    // Fire will cross the old escape path's middle; the target itself stays clear.
    const later = openGrid();
    const mid = oldEscape.cells[Math.floor(oldEscape.cells.length / 2)];
    const col = mid % N;
    for (let r = 0; r < N; r++) if (r !== 0) later.ignitionMin[idx(r, col)] = end + 40;
    // By end+20 every arrival time on the old escape is in the past.
    expect(oldEscape.arrivalMin.at(-1)!).toBeLessThan(end + 20);
    m = advanceMission(m, end + 20, later, ROBOT_DEFAULTS);
    expect(m.phase).toBe("scouting");
    expect(m.escape?.cells ?? []).not.toContain(mid);
  });

  it("missionFitsForecast: needs time for outbound, scouting hold and the walk home", () => {
    const g = openGrid();
    const m = createMission(STAGING, TARGET, 10, g, ROBOT_DEFAULTS);
    const outbound = m.route!.arrivalMin.at(-1)! - 10;
    const needed = 10 + outbound + ROBOT_DEFAULTS.scoutHoldMin + outbound;
    expect(missionFitsForecast(m, needed, ROBOT_DEFAULTS)).toBe(true);
    expect(missionFitsForecast(m, needed - 1, ROBOT_DEFAULTS)).toBe(false);
  });

  describe("syncMission (pose is a function of sim time)", () => {
    const STEP = 15;
    const g = openGrid();
    const start = () => [{ min: 30, mission: createMission(STAGING, TARGET, 30, g, ROBOT_DEFAULTS), grid: g }];

    it("scrubbing back before launch puts the dog at staging", () => {
      let log = syncMission(start(), 30 + 4 * STEP, STEP, () => g, ROBOT_DEFAULTS);
      expect(log.at(-1)!.mission.phase).not.toBe("outbound");
      log = syncMission(log, 0, STEP, () => g, ROBOT_DEFAULTS);
      const m = log.at(-1)!.mission;
      expect(m.phase).toBe("outbound");
      const p = missionPose(m, 0, N);
      expect([p.row, p.col]).toEqual([15, 2]);
    });

    it("scrubbing back mid-mission restores the earlier state", () => {
      const full = syncMission(start(), 30 + 6 * STEP, STEP, () => g, ROBOT_DEFAULTS);
      const back = syncMission(full, 30 + STEP, STEP, () => g, ROBOT_DEFAULTS);
      const stepped = syncMission(start(), 30 + STEP, STEP, () => g, ROBOT_DEFAULTS);
      expect(back.at(-1)!.mission).toEqual(stepped.at(-1)!.mission);
    });

    it("a forward jump replays every step, so scouting starts at arrival", () => {
      const jumped = syncMission(start(), 30 + 20 * STEP, STEP, () => g, ROBOT_DEFAULTS);
      let stepped = start();
      for (let t = 30 + STEP; t <= 30 + 20 * STEP; t += STEP) stepped = syncMission(stepped, t, STEP, () => g, ROBOT_DEFAULTS);
      expect(jumped.at(-1)!.mission).toEqual(stepped.at(-1)!.mission);
      expect(jumped.at(-1)!.mission.phase).toBe("done");
    });

    it("a new forecast at the same minute re-checks the current state", () => {
      const log = start();
      const shifted = openGrid();
      for (let r = 0; r < N; r++) shifted.ignitionMin[idx(r, 20)] = 30 + 10;
      const after = syncMission(log, 30, STEP, () => shifted, ROBOT_DEFAULTS);
      expect(after.at(-1)!.mission.phase).toBe("retreating");
      expect(after.at(-1)!.grid).toBe(shifted);
    });

    it("replays each minute against the forecast in force at that minute", () => {
      const old = openGrid(), corrected = openGrid();
      // 5-min steps: the dog is mid-route when the corrected forecast takes over at minute 35.
      for (let r = 0; r < N; r++) corrected.ignitionMin[idx(r, 20)] = 35 + 10; // only the corrected forecast sees fire
      const gridAt = (min: number) => (min >= 35 ? corrected : old);
      const log = syncMission(start(), 35, 5, gridAt, ROBOT_DEFAULTS);
      expect(log.at(-1)!.grid).toBe(corrected);
      expect(log.at(-1)!.mission.phase).toBe("retreating");
      const back = syncMission(log, 30, 5, gridAt, ROBOT_DEFAULTS);
      expect(back.at(-1)!.mission.phase).toBe("outbound");
    });

    it("replay after a rewind matches live when a new forecast lands on the arrival step", () => {
      const old = openGrid(), corrected = openGrid();
      corrected.ignitionMin[TARGET] = 65; // the corrected forecast sees fire reaching the target soon
      const gridAt = (min: number) => (min >= 45 ? corrected : old);
      // Live: minute 45 is first reached on the old forecast, then the report re-checks it.
      let live = syncMission(start(), 45, STEP, () => old, ROBOT_DEFAULTS);
      live = syncMission(live, 45, STEP, gridAt, ROBOT_DEFAULTS);
      // Replay: rewind to launch, then play forward again.
      const replay = syncMission(syncMission(live, 30, STEP, gridAt, ROBOT_DEFAULTS), 45, STEP, gridAt, ROBOT_DEFAULTS);
      expect(replay.at(-1)!.mission).toEqual(live.at(-1)!.mission);
    });

    it("same minute returns the same log", () => {
      const log = start();
      expect(syncMission(log, 30, STEP, () => g, ROBOT_DEFAULTS)).toBe(log);
    });
  });
});
