import { describe, it, expect } from "vitest";
import {
  planPath,
  planStillSafe,
  remainingMarginMin,
  cellSlopeDeg,
} from "../robot/planner";
import { ROBOT_DEFAULTS } from "../robot/types";
import type { PlannerGrid } from "../robot/types";

const N = 20;
const idx = (r: number, c: number, n = N) => r * n + c;

function openGrid(n = N): PlannerGrid {
  return {
    gridSize: n,
    cellSizeMeters: 50,
    ignitionMin: new Float32Array(n * n).fill(Infinity),
  };
}

describe("planPath", () => {
  it("open field straight line", () => {
    const g = openGrid();
    const plan = planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)!;
    expect(plan).not.toBeNull();
    expect(plan.cells.length).toBe(16);
    expect(plan.cells[0]).toBe(idx(10, 2));
    expect(plan.cells.at(-1)).toBe(idx(10, 17));
    expect(plan.arrivalMin[0]).toBe(0);
    expect(Math.abs(plan.arrivalMin.at(-1)! - (15 * 50) / 1.5 / 60)).toBeLessThan(0.01);
    expect(plan.minMarginMin).toBe(Infinity);
  });

  it("bends around a fire wall", () => {
    const g = openGrid();
    for (let r = 5; r <= 14; r++) g.ignitionMin[idx(r, 10)] = 5;
    const plan = planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)!;
    expect(plan).not.toBeNull();
    for (let r = 5; r <= 14; r++) expect(plan.cells).not.toContain(idx(r, 10));
    plan.cells.forEach((c, i) => {
      expect(plan.arrivalMin[i] + 30).toBeLessThan(g.ignitionMin[c]);
    });
  });

  it("blocked returns null", () => {
    const g = openGrid();
    for (let r = 0; r < N; r++) g.ignitionMin[idx(r, 10)] = 5;
    expect(planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)).toBeNull();
  });

  it("water impassable", () => {
    const g = openGrid();
    g.passable = new Uint8Array(N * N).fill(1);
    for (let r = 0; r < N; r++) g.passable[idx(r, 10)] = 0;
    expect(planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)).toBeNull();
  });

  it("avoids steep slope", () => {
    const g = openGrid();
    g.elevation = new Float32Array(N * N);
    // 50 m rise over one 50 m cell = 45°, over a diagonal ≈ 35.3° — both above 35°.
    for (let r = 1; r < N; r++) g.elevation[idx(r, 10)] = 50;
    const plan = planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)!;
    expect(plan).not.toBeNull();
    const crossings = plan.cells.filter((c) => c % N === 10);
    expect(crossings).toEqual([idx(0, 10)]);
  });

  it("unsafe start: a burning start cell has no path", () => {
    const g = openGrid();
    g.ignitionMin[idx(10, 2)] = 0;
    expect(planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)).toBeNull();
  });

  it("threatened start: the dog may leave a cell igniting within the margin", () => {
    const g = openGrid();
    g.ignitionMin[idx(10, 2)] = 10;
    expect(planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)).not.toBeNull();
  });

  it("forecast ending early: never-igniting cells stay usable", () => {
    // Fire reached only part of the grid before the forecast ended; the rest is Infinity.
    const g = openGrid();
    g.ignitionMin[idx(0, 0)] = 0;
    const plan = planPath(g, idx(10, 2), idx(10, 17), 500, 30, ROBOT_DEFAULTS);
    expect(plan).not.toBeNull();
    expect(plan!.arrivalMin[0]).toBe(500);
  });

  it("600×600 plan over 300 cells is fast", () => {
    const g = openGrid(600);
    const t0 = performance.now();
    const plan = planPath(g, idx(300, 150, 600), idx(300, 450, 600), 0, 30, ROBOT_DEFAULTS);
    const ms = performance.now() - t0;
    expect(plan).not.toBeNull();
    expect(ms).toBeLessThan(300);
  });
});

describe("cellSlopeDeg", () => {
  it("flat when elevation missing", () => {
    expect(cellSlopeDeg(0, 1, undefined, N, 50)).toBe(0);
  });

  it("45° for a 50 m rise over one cell", () => {
    const e = new Float32Array(N * N);
    e[1] = 50;
    expect(cellSlopeDeg(0, 1, e, N, 50)).toBeCloseTo(45, 5);
  });
});

describe("planStillSafe / remainingMarginMin", () => {
  it("detects a forecast change on a remaining cell", () => {
    const g = openGrid();
    const plan = planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)!;
    expect(planStillSafe(plan, 0, g.ignitionMin, 30)).toBe(true);

    const shifted = new Float32Array(g.ignitionMin);
    shifted[idx(10, 15)] = 20; // arrival there ≈ 7.2 min → 7.2 + 30 ≥ 20
    shifted[idx(10, 3)] = 100; // margin ≈ 99.4 on an early cell
    expect(planStillSafe(plan, 0, shifted, 30)).toBe(false);

    const arrival15 = plan.arrivalMin[plan.cells.indexOf(idx(10, 15))];
    expect(remainingMarginMin(plan, 0, shifted)).toBeCloseTo(20 - arrival15, 4);
    // Cells already passed don't count.
    expect(planStillSafe(plan, plan.arrivalMin.at(-1)!, shifted, 30)).toBe(true);
    expect(remainingMarginMin(plan, 100, shifted)).toBe(Infinity);
  });
});
