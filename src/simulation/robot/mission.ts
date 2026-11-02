import { planPath, planStillSafe, planToNearest, remainingMarginMin } from "./planner";
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

/**
 * When no way home keeps the entry margin: the way with the most time to
 * spare (half the margin, then none) rather than standing still while the fire
 * arrives. With a keep-away grid, each looser map in turn (half the distance,
 * then the fire itself). Null only when no path at all gets ahead of the forecast fire.
 */
function planLastResort(cell: number, m: Mission, nowMin: number, grid: PlannerGrid, robot: RobotConfig) {
  robot = { ...robot, marginPerLeadMin: 0 };
  for (const ignitionMin of grid.lastResortMin ?? [grid.ignitionMin]) {
    const g = { ...grid, ignitionMin };
    const plan =
      planPath(g, cell, m.stagingIdx, nowMin, robot.entryMarginMin / 2, robot) ??
      planPath(g, cell, m.stagingIdx, nowMin, 0, robot);
    if (plan) return plan;
  }
  return null;
}

const LAST_RESORT = "Last resort — leaving by the least dangerous way";

/**
 * Where to scout from: the spot closest to the target that the dog can reach under
 * the entry margin, hold for the scouting time, and still walk home from. Null when none.
 */
export function scoutSpot(
  grid: PlannerGrid,
  stagingIdx: number,
  targetIdx: number,
  startMin: number,
  robot: RobotConfig
): number | null {
  const plan = planToNearest(grid, stagingIdx, targetIdx, startMin, robot.entryMarginMin, robot, robot.scoutHoldMin, stagingIdx);
  return plan ? plan.cells.at(-1)! : null;
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

/**
 * True when the forecast (ending at `horizonMin`) lasts long enough for the
 * outbound route, the scouting hold and a walk home of about the same length.
 * Past the horizon the timeline stops, so a longer mission would freeze.
 */
export function missionFitsForecast(m: Mission, horizonMin: number, robot: RobotConfig): boolean {
  if (!m.route) return false;
  const start = m.route.arrivalMin[0];
  const outbound = m.route.arrivalMin.at(-1)! - start;
  return start + 2 * outbound + robot.scoutHoldMin <= horizonMin;
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
  const lead = (t: number) => (robot.marginPerLeadMin ?? 0) * (t - (grid.forecastMin ?? nowMin));
  const stillSafe = (plan: Plan) =>
    planStillSafe(plan, nowMin, ign, robot.entryMarginMin, robot.marginPerLeadMin ?? 0, grid.forecastMin ?? nowMin);

  // Holding is the last option: first any way out that still beats the forecast fire.
  const toHolding = (phase: "returning" | "retreating" = "retreating") => {
    const out = planLastResort(cur, m, nowMin, grid, robot);
    if (out) {
      next.phase = phase;
      next.route = out;
      next.event = LAST_RESORT;
      return;
    }
    next.phase = "holding";
    next.route = stay(cur, nowMin, grid);
    next.event = "No safe path — holding";
  };
  const homeOrHold = (phase: "returning" | "retreating") => {
    const home = planPath(grid, cur, m.stagingIdx, nowMin, robot.entryMarginMin, robot);
    if (home) {
      next.phase = phase;
      next.route = home;
    } else toHolding(phase);
  };

  switch (m.phase) {
    case "outbound": {
      const route = m.route!;
      if (nowMin >= route.arrivalMin.at(-1)!) {
        next.phase = "scouting";
        next.route = stay(m.targetIdx, nowMin, grid);
        next.holdUntilMin = nowMin + robot.scoutHoldMin;
        next.event = "Reached the scout spot — scouting";
      } else if (!stillSafe(route)) {
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
      const fireClose = !(nowMin + robot.entryMarginMin + lead(nowMin) < ign[m.targetIdx]);
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
      } else if (!stillSafe(route)) {
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
        toHolding();
        if (next.phase === "holding") next.event = m.event;
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
        !stillSafe(e)) {
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

/** A mission state stamped with the simulation minute it was computed for. */
export interface MissionEntry {
  min: number;
  mission: Mission;
  /** Forecast the state was computed against. */
  grid: PlannerGrid;
}

/**
 * Bring a mission log to `nowMin` so the dog depends only on sim time:
 * scrubbing back drops later entries (never the launch entry), and a forward
 * jump replays every timeline step in between, so events land at the step
 * they would have during playback. Each minute uses the forecast in force then
 * (`gridAt`); a new forecast at the same minute re-checks the current state. Returns `log` itself when nothing changes.
 */
export function syncMission(
  log: MissionEntry[],
  nowMin: number,
  stepMin: number,
  gridAt: (min: number) => PlannerGrid,
  robot: RobotConfig
): MissionEntry[] {
  const last = log[log.length - 1];
  if (nowMin === last.min) {
    const grid = gridAt(nowMin);
    if (last.grid === grid) return log;
    return [...log.slice(0, -1), { min: nowMin, mission: advanceMission(last.mission, nowMin, grid, robot), grid }];
  }
  let keep = log.length;
  while (keep > 1 && log[keep - 1].min > nowMin) keep--;
  const out = log.slice(0, keep);
  let { min, mission, grid: prev } = out[out.length - 1];
  while (min < nowMin) {
    min = Math.min(min + stepMin, nowMin);
    // Live, a new forecast reaches a minute after it was first played on the
    // previous one (then re-checked). Replay does the same so rewinds match.
    mission = advanceMission(mission, min, prev, robot);
    const grid = gridAt(min);
    if (grid !== prev) mission = advanceMission(mission, min, grid, robot);
    out.push({ min, mission, grid });
    prev = grid;
  }
  return out;
}
