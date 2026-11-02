import type { Plan, PlannerGrid, RobotConfig } from "./types";

const RAD = Math.PI / 180;

/** Slope in degrees between two neighbouring cells; 0 when terrain is unknown. */
export function cellSlopeDeg(
  a: number,
  b: number,
  elevation: Float32Array | undefined,
  gridSize: number,
  cellSizeMeters: number
): number {
  if (!elevation) return 0;
  const diagonal = a % gridSize !== b % gridSize && Math.floor(a / gridSize) !== Math.floor(b / gridSize);
  const dist = diagonal ? cellSizeMeters * Math.SQRT2 : cellSizeMeters;
  const dh = Math.abs(elevation[b] - elevation[a]);
  if (!Number.isFinite(dh)) return 0;
  return Math.atan(dh / dist) / RAD;
}

/** Min-heap over (key, value) pairs stored in parallel arrays. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.keys, v = this.vals;
    const topK = k[0], topV = v[0];
    const lastK = k.pop()!, lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && k[l + 1] < k[l] ? l + 1 : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return [topK, topV];
  }
}

const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];

interface Search {
  best: Float64Array;
  prev: Int32Array;
  /** Index into best/prev for a grid cell inside the search box, else -1. */
  local: (cell: number) => number;
  /** Cells settled, in order of arrival. */
  settled: number[];
}

/**
 * Dijkstra on arrival time from `startIdx` over an 8-connected grid, limited to a
 * padded box around start and `aimIdx`, entering only cells that clear the
 * forecast by the margin. Stops early once `stopAt` is settled. Null when the
 * start itself is unusable.
 */
function search(
  grid: PlannerGrid,
  startIdx: number,
  aimIdx: number,
  startMin: number,
  marginMin: number,
  robot: RobotConfig,
  stopAt: number | null
): Search | null {
  const { gridSize: n, cellSizeMeters, ignitionMin, elevation, passable, groundSpeed } = grid;
  if (passable && passable[startIdx] === 0) return null;
  // The margin applies to cells being entered; the dog may always leave a cell
  // that hasn't ignited yet (otherwise a threatened dog could never get out).
  if (!(startMin < ignitionMin[startIdx])) return null;

  const sr = Math.floor(startIdx / n), sc = startIdx % n;
  const gr = Math.floor(aimIdx / n), gc = aimIdx % n;
  const pad = robot.searchPadCells;
  const r0 = Math.max(0, Math.min(sr, gr) - pad), r1 = Math.min(n - 1, Math.max(sr, gr) + pad);
  const c0 = Math.max(0, Math.min(sc, gc) - pad), c1 = Math.min(n - 1, Math.max(sc, gc) + pad);
  const bw = c1 - c0 + 1;
  const localRC = (r: number, c: number) => (r - r0) * bw + (c - c0);
  const local = (cell: number) => {
    const r = Math.floor(cell / n), c = cell % n;
    return r < r0 || r > r1 || c < c0 || c > c1 ? -1 : localRC(r, c);
  };

  const size = (r1 - r0 + 1) * bw;
  const best = new Float64Array(size).fill(Infinity);
  const prev = new Int32Array(size).fill(-1);
  const done = new Uint8Array(size);
  const settled: number[] = [];

  const minPerMeter = 1 / robot.speedMps / 60;
  const upCost = robot.slopeCostK, downCost = robot.slopeCostDownK;
  const maxSlope = robot.maxSlopeDeg;
  const perLead = robot.marginPerLeadMin ?? 0;
  const lead0 = grid.forecastMin ?? startMin;

  const heap = new MinHeap();
  best[localRC(sr, sc)] = startMin;
  heap.push(startMin, startIdx);

  while (heap.size > 0) {
    const [t, cell] = heap.pop();
    const r = Math.floor(cell / n), c = cell % n;
    const li = localRC(r, c);
    if (done[li]) continue;
    done[li] = 1;
    settled.push(cell);
    if (cell === stopAt) break;
    for (let k = 0; k < 8; k++) {
      const nr = r + DR[k], nc = c + DC[k];
      if (nr < r0 || nr > r1 || nc < c0 || nc > c1) continue;
      const nb = nr * n + nc;
      const nl = localRC(nr, nc);
      if (done[nl]) continue;
      if (passable && passable[nb] === 0) continue;
      const slope = cellSlopeDeg(cell, nb, elevation, n, cellSizeMeters);
      if (slope > maxSlope) continue;
      const dist = DR[k] !== 0 && DC[k] !== 0 ? cellSizeMeters * Math.SQRT2 : cellSizeMeters;
      const uphill = !elevation || elevation[nb] >= elevation[cell];
      const slopeFactor = 1 + (uphill ? upCost : downCost) * Math.tan(slope * RAD);
      // Half the step is walked on each cell's ground.
      const ground = groundSpeed ? (groundSpeed[cell] + groundSpeed[nb]) / 2 : 1;
      if (!(ground > 0)) continue;
      const arrive = t + (dist * minPerMeter * slopeFactor) / ground;
      if (arrive + marginMin + perLead * (arrive - lead0) >= ignitionMin[nb]) continue;
      if (arrive < best[nl]) {
        best[nl] = arrive;
        prev[nl] = cell;
        heap.push(arrive, nb);
      }
    }
  }
  return { best, prev, local, settled };
}

function pathTo(s: Search, goalIdx: number, ignitionMin: Float32Array): Plan {
  const cells: number[] = [];
  for (let cell = goalIdx; cell !== -1; ) {
    cells.push(cell);
    cell = s.prev[s.local(cell)];
  }
  cells.reverse();
  const arrivalMin = cells.map((cell) => s.best[s.local(cell)]);
  let minMarginMin = Infinity;
  cells.forEach((cell, i) => {
    minMarginMin = Math.min(minMarginMin, ignitionMin[cell] - arrivalMin[i]);
  });
  return { cells, arrivalMin, minMarginMin };
}

/**
 * Earliest-arrival path from start to goal that enters every cell at least
 * `marginMin` minutes (plus `robot.marginPerLeadMin` per minute of look-ahead
 * from `grid.forecastMin`) before the forecast says it ignites.
 * Walking time grows with slope (uphill more than downhill) and on slow ground (brush, forest).
 * Returns null when no safe path exists.
 */
export function planPath(
  grid: PlannerGrid,
  startIdx: number,
  goalIdx: number,
  startMin: number,
  marginMin: number,
  robot: RobotConfig
): Plan | null {
  if (grid.passable && grid.passable[goalIdx] === 0) return null;
  const s = search(grid, startIdx, goalIdx, startMin, marginMin, robot, goalIdx);
  if (!s || s.settled.at(-1) !== goalIdx) return null;
  return pathTo(s, goalIdx, grid.ignitionMin);
}

/**
 * Path to the spot closest to `targetIdx` (straight-line) that the dog can
 * reach under the same rules and that stays clear for `holdMin` after it
 * arrives: where to scout from when the target itself is too close to the fire.
 * With `homeIdx`, the spot must also have a way home under the same rules once
 * the hold is over. Ties go to the earlier arrival. Null when there is no such spot.
 */
export function planToNearest(
  grid: PlannerGrid,
  startIdx: number,
  targetIdx: number,
  startMin: number,
  marginMin: number,
  robot: RobotConfig,
  holdMin: number,
  homeIdx?: number
): Plan | null {
  const s = search(grid, startIdx, targetIdx, startMin, marginMin, robot, targetIdx);
  if (!s) return null;
  const n = grid.gridSize;
  const tr = Math.floor(targetIdx / n), tc = targetIdx % n;
  const d2 = (cell: number) => (Math.floor(cell / n) - tr) ** 2 + ((cell % n) - tc) ** 2;
  // Settled order is arrival order, so a stable sort keeps the earlier arrival first among equals.
  const spots = s.settled
    .filter((cell) => s.best[s.local(cell)] + holdMin < grid.ignitionMin[cell])
    .sort((a, b) => d2(a) - d2(b));
  for (const spot of spots) {
    if (homeIdx !== undefined && !planPath(grid, spot, homeIdx, s.best[s.local(spot)] + holdMin, marginMin, robot)) continue;
    return pathTo(s, spot, grid.ignitionMin);
  }
  return null;
}

/** True when every cell not yet reached still clears the fire by `marginMin` (+ `perLead` per minute after `leadFromMin`). */
export function planStillSafe(
  plan: Plan,
  fromMin: number,
  ignitionMin: Float32Array,
  marginMin: number,
  perLead = 0,
  leadFromMin = fromMin
): boolean {
  for (let i = 0; i < plan.cells.length; i++) {
    const t = plan.arrivalMin[i];
    if (t < fromMin) continue;
    if (!(t + marginMin + perLead * (t - leadFromMin) < ignitionMin[plan.cells[i]])) return false;
  }
  return true;
}

/** Smallest (ignition − arrival) over the cells still ahead; Infinity if none. */
export function remainingMarginMin(
  plan: Plan,
  nowMin: number,
  ignitionMin: Float32Array
): number {
  let m = Infinity;
  for (let i = 0; i < plan.cells.length; i++) {
    if (plan.arrivalMin[i] < nowMin) continue;
    m = Math.min(m, ignitionMin[plan.cells[i]] - plan.arrivalMin[i]);
  }
  return m;
}

/** True when two plans walk the same cells (timing aside), so a drawn line can stay as it is. */
export function samePath(a: Plan | null, b: Plan | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.cells.length !== b.cells.length) return false;
  return a.cells.every((c, i) => c === b.cells[i]);
}
