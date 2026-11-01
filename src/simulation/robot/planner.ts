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

/**
 * Earliest-arrival path from start to goal that enters every cell at least
 * `marginMin` minutes before the forecast says it ignites. Dijkstra on arrival
 * time over an 8-connected grid, limited to a padded box around start/goal.
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
  const { gridSize: n, cellSizeMeters, ignitionMin, elevation, passable } = grid;
  if (passable && (passable[startIdx] === 0 || passable[goalIdx] === 0)) return null;
  // The margin applies to cells being entered; the dog may always leave a cell
  // that hasn't ignited yet (otherwise a threatened dog could never get out).
  if (!(startMin < ignitionMin[startIdx])) return null;

  const sr = Math.floor(startIdx / n), sc = startIdx % n;
  const gr = Math.floor(goalIdx / n), gc = goalIdx % n;
  const pad = robot.searchPadCells;
  const r0 = Math.max(0, Math.min(sr, gr) - pad), r1 = Math.min(n - 1, Math.max(sr, gr) + pad);
  const c0 = Math.max(0, Math.min(sc, gc) - pad), c1 = Math.min(n - 1, Math.max(sc, gc) + pad);
  const bw = c1 - c0 + 1;
  const local = (r: number, c: number) => (r - r0) * bw + (c - c0);

  const size = (r1 - r0 + 1) * bw;
  const best = new Float64Array(size).fill(Infinity);
  const prev = new Int32Array(size).fill(-1);
  const done = new Uint8Array(size);

  const minPerMeter = 1 / robot.speedMps / 60;
  const tanCost = robot.slopeCostK;
  const maxSlope = robot.maxSlopeDeg;

  const heap = new MinHeap();
  best[local(sr, sc)] = startMin;
  heap.push(startMin, startIdx);

  let found = false;
  while (heap.size > 0) {
    const [t, cell] = heap.pop();
    const r = Math.floor(cell / n), c = cell % n;
    const li = local(r, c);
    if (done[li]) continue;
    done[li] = 1;
    if (cell === goalIdx) {
      found = true;
      break;
    }
    for (let k = 0; k < 8; k++) {
      const nr = r + DR[k], nc = c + DC[k];
      if (nr < r0 || nr > r1 || nc < c0 || nc > c1) continue;
      const nb = nr * n + nc;
      const nl = local(nr, nc);
      if (done[nl]) continue;
      if (passable && passable[nb] === 0) continue;
      const slope = cellSlopeDeg(cell, nb, elevation, n, cellSizeMeters);
      if (slope > maxSlope) continue;
      const dist = DR[k] !== 0 && DC[k] !== 0 ? cellSizeMeters * Math.SQRT2 : cellSizeMeters;
      const arrive = t + dist * minPerMeter * (1 + tanCost * Math.tan(slope * RAD));
      if (arrive + marginMin >= ignitionMin[nb]) continue;
      if (arrive < best[nl]) {
        best[nl] = arrive;
        prev[nl] = cell;
        heap.push(arrive, nb);
      }
    }
  }
  if (!found) return null;

  const cells: number[] = [];
  for (let cell = goalIdx; cell !== -1; ) {
    cells.push(cell);
    cell = prev[local(Math.floor(cell / n), cell % n)];
  }
  cells.reverse();
  const arrivalMin = cells.map((cell) => best[local(Math.floor(cell / n), cell % n)]);
  let minMarginMin = Infinity;
  cells.forEach((cell, i) => {
    minMarginMin = Math.min(minMarginMin, ignitionMin[cell] - arrivalMin[i]);
  });
  return { cells, arrivalMin, minMarginMin };
}

/** True when every cell not yet reached still clears the fire by `marginMin`. */
export function planStillSafe(
  plan: Plan,
  fromMin: number,
  ignitionMin: Float32Array,
  marginMin: number
): boolean {
  for (let i = 0; i < plan.cells.length; i++) {
    if (plan.arrivalMin[i] < fromMin) continue;
    if (!(plan.arrivalMin[i] + marginMin < ignitionMin[plan.cells[i]])) return false;
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
