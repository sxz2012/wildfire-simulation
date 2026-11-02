import { describe, it, expect } from "vitest";
import {
  planPath,
  planToNearest,
  planStillSafe,
  remainingMarginMin,
  cellSlopeDeg,
 samePath } from "../robot/planner";
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

  it("brush slows the dog: half speed doubles the walk", () => {
    const g = openGrid();
    g.groundSpeed = new Float32Array(N * N).fill(0.5);
    const plan = planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)!;
    expect(plan.arrivalMin.at(-1)!).toBeCloseTo((2 * 15 * 50) / 1.5 / 60, 2);
  });

  it("goes around slow brush when the detour is faster", () => {
    const g = openGrid();
    g.groundSpeed = new Float32Array(N * N).fill(1);
    const brush: number[] = [];
    for (let r = 0; r <= 15; r++) for (let c = 6; c <= 13; c++) brush.push(idx(r, c));
    brush.forEach((i) => (g.groundSpeed![i] = 0.5));
    const plan = planPath(g, idx(10, 2), idx(10, 17), 0, 30, ROBOT_DEFAULTS)!;
    expect(plan.cells.filter((c) => brush.includes(c))).toEqual([]);
  });

  it("uphill is slower than downhill, and downhill slower than flat", () => {
    const flat = openGrid();
    const ramp = openGrid();
    ramp.elevation = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) ramp.elevation[i] = (i % N) * 10; // 10 m per cell ≈ 11.3°
    const t = (g: PlannerGrid, a: number, b: number) => planPath(g, a, b, 0, 30, ROBOT_DEFAULTS)!.arrivalMin.at(-1)!;
    const up = t(ramp, idx(10, 2), idx(10, 17));
    const down = t(ramp, idx(10, 17), idx(10, 2));
    const level = t(flat, idx(10, 2), idx(10, 17));
    expect(up).toBeGreaterThan(down);
    expect(down).toBeGreaterThan(level);
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

describe("margin that grows with look-ahead", () => {
  // Everything ignites at minute 50; the walk takes about 8 minutes.
  const late = () => {
    const g = openGrid();
    g.ignitionMin.fill(50);
    return g;
  };
  const growing = { ...ROBOT_DEFAULTS, marginPerLeadMin: 0.25 };

  it("a fresh forecast needs little more than the base margin", () => {
    expect(planPath(late(), idx(10, 2), idx(10, 17), 0, 15, growing)).not.toBeNull();
  });

  it("an old forecast needs a bigger margin: 15 + 25% of 200+ min ahead is more than the 50 min to spare", () => {
    const g = { ...late(), forecastMin: -200 };
    expect(planPath(g, idx(10, 2), idx(10, 17), 0, 15, growing)).toBeNull();
    expect(planPath(g, idx(10, 2), idx(10, 17), 0, 15, ROBOT_DEFAULTS)).not.toBeNull();
  });

  it("planStillSafe applies the same growing margin", () => {
    const g = late();
    const plan = planPath(g, idx(10, 2), idx(10, 17), 0, 15, growing)!;
    expect(planStillSafe(plan, 0, g.ignitionMin, 15, 0.25, 0)).toBe(true);
    expect(planStillSafe(plan, 0, g.ignitionMin, 15, 0.25, -200)).toBe(false);
  });
});

describe("samePath", () => {
  const plan = (cells: number[], t0 = 0) => ({ cells, arrivalMin: cells.map((_, i) => t0 + i), minMarginMin: 10 });
  it("same cells are the same path even if re-timed", () => expect(samePath(plan([1, 2, 3]), plan([1, 2, 3], 15))).toBe(true));
  it("different cells differ", () => expect(samePath(plan([1, 2, 3]), plan([1, 2, 4]))).toBe(false));
  it("null handling", () => {
    expect(samePath(null, null)).toBe(true);
    expect(samePath(plan([1]), null)).toBe(false);
  });
});

describe("planToNearest", () => {
  // The fire holds every column from 14 east; the target sits inside it.
  const fireEast = () => {
    const g = openGrid();
    for (let r = 0; r < N; r++) for (let c = 14; c < N; c++) g.ignitionMin[idx(r, c)] = 0;
    return g;
  };

  it("walks to the reachable spot closest to an unreachable target", () => {
    const plan = planToNearest(fireEast(), idx(10, 2), idx(10, 17), 0, 0, ROBOT_DEFAULTS, 30)!;
    expect(plan.cells[0]).toBe(idx(10, 2));
    expect(plan.cells.at(-1)).toBe(idx(10, 13));
  });

  it("the spot must stay clear for the whole hold, not just on arrival", () => {
    const g = fireEast();
    for (let r = 0; r < N; r++) g.ignitionMin[idx(r, 13)] = 30; // reached at ~6 min, burns before 9 + 30
    expect(planToNearest(g, idx(10, 2), idx(10, 17), 0, 0, ROBOT_DEFAULTS, 30)!.cells.at(-1)).toBe(idx(10, 12));
  });

  it("goes to the target itself when it can", () => {
    const plan = planToNearest(openGrid(), idx(10, 2), idx(10, 16), 0, 0, ROBOT_DEFAULTS, 30)!;
    expect(plan.cells.at(-1)).toBe(idx(10, 16));
  });

  it("with a home, only a spot it can still walk home from after the hold", () => {
    const g = openGrid();
    for (let r = 0; r < N; r++) g.ignitionMin[idx(r, 8)] = 12; // passable on the way out (~3 min), shut by the way back
    expect(planToNearest(g, idx(10, 2), idx(10, 16), 0, 0, ROBOT_DEFAULTS, 30)!.cells.at(-1)).toBe(idx(10, 16));
    expect(planToNearest(g, idx(10, 2), idx(10, 16), 0, 0, ROBOT_DEFAULTS, 30, idx(10, 2))!.cells.at(-1)).toBe(idx(10, 7));
  });

  it("null when the dog cannot even stay where it is", () => {
    const g = openGrid();
    g.ignitionMin.fill(0);
    expect(planToNearest(g, idx(10, 2), idx(10, 17), 5, 0, ROBOT_DEFAULTS, 30)).toBeNull();
  });
});
