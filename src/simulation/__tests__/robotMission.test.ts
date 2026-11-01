import { describe, it, expect } from "vitest";
import {
  createMission,
  advanceMission,
  missionPose,
  missionMarginMin,
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
});
