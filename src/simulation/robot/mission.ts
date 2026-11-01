import { planPath, planStillSafe, remainingMarginMin } from "./planner";
import type { Plan, PlannerGrid, RobotConfig } from "./types";

export type MissionPhase = "outbound" | "scouting" | "returning" | "retreating" | "holding" | "done";

export interface Mission {
  stagingIdx: number;
  targetIdx: number;
  phase: MissionPhase;
  /** The path the dog is following. A single-cell plan while it stands still. */
  route: Plan | null;
  /** Way back to staging: escape margin if possible, else entry margin; null when neither exists. */
  escape: Plan | null;
  holdUntilMin: number | null;
  /** Short HUD message for something that just changed, else null. */
  event: string | null;
  replanCount: number;
}

const stay = (cell: number, nowMin: number, grid: PlannerGrid): Plan => ({
  cells: [cell],
  arrivalMin: [nowMin],
  minMarginMin: grid.ignitionMin[cell] - nowMin,
});

/** Index of the last route cell reached by `nowMin` (0 before the route starts). */
function reachedIndex(plan: Plan, nowMin: number): number {
  const a = plan.arrivalMin;
  let lo = 0, hi = a.length - 1;
  if (nowMin <= a[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a[mid] <= nowMin) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function currentCell(m: Mission, nowMin: number): number {
  if (!m.route) return m.stagingIdx;
  return m.route.cells[reachedIndex(m.route, nowMin)];
}

/** Way home under the escape margin, falling back to the entry margin so a path shows whenever one exists. */
function planEscape(cell: number, m: Mission, nowMin: number, grid: PlannerGrid, robot: RobotConfig) {
  return (
    planPath(grid, cell, m.stagingIdx, nowMin, robot.escapeMarginMin, robot) ??
    planPath(grid, cell, m.stagingIdx, nowMin, robot.entryMarginMin, robot)
  );
}

export function createMission(
  stagingIdx: number,
  targetIdx: number,
  startMin: number,
  grid: PlannerGrid,
  robot: RobotConfig
): Mission {
  const route = planPath(grid, stagingIdx, targetIdx, startMin, robot.entryMarginMin, robot);
  const base: Mission = {
    stagingIdx,
    targetIdx,
    phase: route ? "outbound" : "holding",
    route,
    escape: null,
    holdUntilMin: null,
    event: route ? null : "No safe route to target",
    replanCount: 0,
  };
  base.escape = planEscape(stagingIdx, base, startMin, grid, robot);
  return base;
}

/** Pure step of the mission at simulation minute `nowMin`. */
export function advanceMission(
  m: Mission,
  nowMin: number,
  grid: PlannerGrid,
  robot: RobotConfig
): Mission {
  if (m.phase === "done") return m;
  const ign = grid.ignitionMin;
  const next: Mission = { ...m, event: null };
  const cur = currentCell(m, nowMin);

  const toHolding = () => {
    next.phase = "holding";
    next.route = stay(cur, nowMin, grid);
    next.event = "No safe path — holding";
  };
  const homeOrHold = (phase: "returning" | "retreating") => {
    const home = planPath(grid, cur, m.stagingIdx, nowMin, robot.entryMarginMin, robot);
    if (home) {
      next.phase = phase;
      next.route = home;
    } else toHolding();
  };

  switch (m.phase) {
    case "outbound": {
      const route = m.route!;
      if (nowMin >= route.arrivalMin.at(-1)!) {
        next.phase = "scouting";
        next.route = stay(m.targetIdx, nowMin, grid);
        next.holdUntilMin = nowMin + robot.scoutHoldMin;
        next.event = "Reached the fire edge — scouting";
      } else if (!planStillSafe(route, nowMin, ign, robot.entryMarginMin)) {
        const replanned = planPath(grid, cur, m.targetIdx, nowMin, robot.entryMarginMin, robot);
        if (replanned) {
          next.route = replanned;
          next.replanCount = m.replanCount + 1;
          next.event = "Re-planned: fire forecast changed";
        } else {
          const escape = planEscape(cur, m, nowMin, grid, robot);
          if (escape) {
            next.phase = "retreating";
            next.route = escape;
            next.escape = escape;
            next.event = "No safe route forward — retreating";
          } else toHolding();
        }
      }
      break;
    }
    case "scouting": {
      const fireClose = !(nowMin + robot.entryMarginMin < ign[m.targetIdx]);
      if (fireClose || nowMin >= (m.holdUntilMin ?? nowMin)) {
        homeOrHold("returning");
        if (next.phase === "returning" && fireClose) next.event = "Fire approaching — heading back";
      }
      break;
    }
    case "returning":
    case "retreating": {
      const route = m.route!;
      if (nowMin >= route.arrivalMin.at(-1)! && route.cells.at(-1) === m.stagingIdx) {
        next.phase = "done";
        next.route = stay(m.stagingIdx, nowMin, grid);
        next.event = "Safe at staging";
      } else if (!planStillSafe(route, nowMin, ign, robot.entryMarginMin)) {
        homeOrHold(m.phase);
      }
      break;
    }
    case "holding": {
      const escape = planEscape(cur, m, nowMin, grid, robot);
      if (escape) {
        next.phase = "retreating";
        next.route = escape;
        next.event = "Path opened — retreating";
      } else {
        next.route = stay(cur, nowMin, grid);
        next.event = m.event;
      }
      break;
    }
  }

  // Keep the escape path anchored at the dog and still clear.
  if (next.phase === "done") {
    next.escape = null;
  } else {
    const here = currentCell(next, nowMin);
    const e = next.escape;
    // Re-plan when the dog moved, time moved (a stale plan's past arrivals would
    // skip every safety check), or the fire now crosses it.
    if (!e || e.cells[0] !== here || e.arrivalMin[0] !== nowMin ||
        !planStillSafe(e, nowMin, ign, robot.entryMarginMin)) {
      next.escape = planEscape(here, next, nowMin, grid, robot);
    }
  }
  return next;
}

/** Fractional grid position along the route at `nowMin`; heading 0 = north, 90 = east. */
export function missionPose(
  m: Mission,
  nowMin: number,
  gridSize: number
): { row: number; col: number; headingDeg: number } {
  const plan = m.route ?? { cells: [m.stagingIdx], arrivalMin: [nowMin], minMarginMin: Infinity };
  const rc = (cell: number) => [Math.floor(cell / gridSize), cell % gridSize];
  const i = reachedIndex(plan, nowMin);
  const last = plan.cells.length - 1;
  const [r0, c0] = rc(plan.cells[i]);
  const j = Math.min(i + 1, last);
  const [r1, c1] = rc(plan.cells[j]);

  let frac = 0;
  if (j > i && nowMin > plan.arrivalMin[i]) {
    frac = Math.min(1, (nowMin - plan.arrivalMin[i]) / (plan.arrivalMin[j] - plan.arrivalMin[i]));
  }
  // Heading from the current segment, or the final one once the route ends.
  const [hr0, hc0] = j > i ? [r0, c0] : rc(plan.cells[Math.max(0, last - 1)]);
  const [hr1, hc1] = j > i ? [r1, c1] : rc(plan.cells[last]);
  const headingDeg =
    hr1 === hr0 && hc1 === hc0 ? 0 : ((Math.atan2(hc1 - hc0, hr1 - hr0) * 180) / Math.PI + 360) % 360;

  return { row: r0 + (r1 - r0) * frac, col: c0 + (c1 - c0) * frac, headingDeg };
}

/** Time-to-fire margin: closest call along the remaining route, including where the dog stands. */
export function missionMarginMin(m: Mission, nowMin: number, grid: PlannerGrid): number {
  const here = grid.ignitionMin[currentCell(m, nowMin)] - nowMin;
  const ahead = m.route ? remainingMarginMin(m.route, nowMin, grid.ignitionMin) : Infinity;
  return Math.min(here, ahead);
}
