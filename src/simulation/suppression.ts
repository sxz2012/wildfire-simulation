/**
 * Wildfire suppression model — pure functions, no side effects.
 * Uses NWCG production rates, Hirsch-Martell delay decay, and
 * Reed-McCool containment math. See:
 * docs/plans/2026-05-04-suppression-modeling-design.md
 */
import {
  CellState,
  CHAINS_TO_METERS,
  RESOURCE_RATES,
  type GridCell,
  type ResourceCount,
} from "./types";

/**
 * Total ground-line construction rate from a resource roster, in
 * chains/hr. Aerial resources (Helitack, AirTanker) contribute 0 here —
 * their effect is modeled separately as ROS reduction / retardant.
 */
export function totalChainsPerHour(resources: ResourceCount[]): number {
  let sum = 0;
  for (const { type, count } of resources) {
    sum += (RESOURCE_RATES[type]?.chainsPerHour ?? 0) * count;
  }
  return sum;
}

/**
 * Hirsch & Martell (1996) delay-decay multiplier. Effectiveness ~ exp
 * (-delay / characteristicTime). characteristicTime = 90 min is the
 * empirical "halving time" of initial-attack effectiveness.
 *
 * Returns a multiplier in (0, 1] (clamped at 1 for negative delays).
 */
export function delayDecay(delayMinutes: number): number {
  const t = Math.max(0, delayMinutes);
  return Math.exp(-t / 90);
}

/**
 * Reed & McCool (2000) simplified containment probability:
 *   P = 1 - exp(-cumulativeLine / activePerimeter)
 *
 * Both inputs in METERS. Returns 0 when the perimeter is 0 (no fire to
 * contain) to avoid divide-by-zero.
 */
export function containmentProbability(
  cumulativeLineMeters: number,
  activePerimeterMeters: number,
): number {
  if (activePerimeterMeters <= 0) return 0;
  if (cumulativeLineMeters <= 0) return 0;
  return 1 - Math.exp(-cumulativeLineMeters / activePerimeterMeters);
}

/**
 * Convenience: chains -> meters for line-length math.
 */
export function chainsToMeters(chains: number): number {
  return chains * CHAINS_TO_METERS;
}

const NEIGHBOR_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/**
 * Compute the active fire perimeter — the set of currently-Burning cells
 * that have at least one Unburned neighbor (8-connectivity). Returns
 * cell count and approximate length in meters (each perimeter cell
 * contributes ~edges_facing_unburned × cellSize).
 *
 * Used as the denominator in the Reed-McCool containment formula.
 */
export function activeFirePerimeter(
  grid: GridCell[],
  gridSize: number,
  cellSizeMeters: number,
): { cellCount: number; meters: number } {
  let cellCount = 0;
  let totalEdges = 0;
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const cell = grid[row * gridSize + col];
      if (cell.state !== CellState.Burning) continue;
      let edgesFacingUnburned = 0;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        // Only count the 4 cardinal edges for length, not diagonals.
        if (dr !== 0 && dc !== 0) continue;
        const nr = row + dr,
          nc = col + dc;
        if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) {
          edgesFacingUnburned++; // edge of grid acts as unburned
          continue;
        }
        if (grid[nr * gridSize + nc].state === CellState.Unburned) {
          edgesFacingUnburned++;
        }
      }
      // 8-connectivity for "is perimeter" but length sums only cardinals.
      let hasAnyUnburnedNeighbor = false;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const nr = row + dr,
          nc = col + dc;
        if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) {
          hasAnyUnburnedNeighbor = true;
          break;
        }
        if (grid[nr * gridSize + nc].state === CellState.Unburned) {
          hasAnyUnburnedNeighbor = true;
          break;
        }
      }
      if (hasAnyUnburnedNeighbor) {
        cellCount++;
        totalEdges += edgesFacingUnburned;
      }
    }
  }
  return { cellCount, meters: totalEdges * cellSizeMeters };
}

/**
 * Pick up to maxCells perimeter cells that should become fireline this
 * step. Currently picks the burning perimeter cells with the LARGEST
 * downwind alignment (head of the fire) — that's where the operational
 * priority is. windDirectionDeg is the direction wind is FROM
 * (0° = north).
 *
 * Returns indices into the grid. Caller flips them to Suppressed.
 */
export function pickFirelineCells(
  grid: GridCell[],
  gridSize: number,
  maxCells: number,
  windDirectionDeg: number,
): number[] {
  if (maxCells <= 0) return [];

  // Wind blows FROM windDirectionDeg TOWARD windDirectionDeg+180.
  // The "head" of the fire is the side facing windward — the cells the
  // fire is racing toward. We score each perimeter cell by how aligned
  // its position is with the head direction relative to the centroid.
  let centroidR = 0,
    centroidC = 0,
    burningCount = 0;
  const candidates: number[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      const cell = grid[idx];
      if (cell.state !== CellState.Burning) continue;
      centroidR += row;
      centroidC += col;
      burningCount++;
      let isPerimeter = false;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const nr = row + dr,
          nc = col + dc;
        if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) {
          isPerimeter = true;
          break;
        }
        if (grid[nr * gridSize + nc].state === CellState.Unburned) {
          isPerimeter = true;
          break;
        }
      }
      if (isPerimeter) candidates.push(idx);
    }
  }
  if (candidates.length === 0 || burningCount === 0) return [];
  centroidR /= burningCount;
  centroidC /= burningCount;

  // Head direction unit vector — wind blows toward (windDir+180).
  const headRad = ((windDirectionDeg + 180) * Math.PI) / 180;
  const headDr = -Math.cos(headRad); // rows increase southward in our grid
  const headDc = Math.sin(headRad);

  const scored = candidates.map((idx) => {
    const row = Math.floor(idx / gridSize);
    const col = idx % gridSize;
    const dr = row - centroidR;
    const dc = col - centroidC;
    const len = Math.sqrt(dr * dr + dc * dc) || 1;
    const alignment = (dr * headDr + dc * headDc) / len;
    return { idx, alignment };
  });
  scored.sort((a, b) => b.alignment - a.alignment);
  return scored.slice(0, maxCells).map((s) => s.idx);
}

/**
 * One-pass combined fireline picker + perimeter measurement. Replaces
 * pickFirelineCells + activeFirePerimeter in the hot loop — does the same
 * math but with a single grid scan instead of three.
 *
 * Returns:
 *  - picked: indices of cells (capped at maxCells) at the head of the fire,
 *    sorted by alignment with the wind, ready to be flipped to Suppressed.
 *  - perimeterCellCount, perimeterMeters: same definition as
 *    activeFirePerimeter — perimeter cells are Burning cells with at least
 *    one Unburned (8-conn) neighbor; meters sums the cardinal-facing
 *    unburned edges × cellSizeMeters.
 */
export function suppressionStep(
  grid: GridCell[],
  gridSize: number,
  cellSizeMeters: number,
  maxCells: number,
  windDirectionDeg: number,
): {
  picked: number[];
  perimeterCellCount: number;
  perimeterMeters: number;
} {
  let centroidR = 0;
  let centroidC = 0;
  let burningCount = 0;
  let perimeterCellCount = 0;
  let totalEdges = 0;

  // Single pass: find burning cells, compute centroid, count perimeter.
  // Track candidate perimeter cells with their (row, col) so we can score
  // them by alignment after the centroid is known.
  type Candidate = { idx: number; row: number; col: number };
  const candidates: Candidate[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      if (grid[idx].state !== CellState.Burning) continue;

      centroidR += row;
      centroidC += col;
      burningCount++;

      let isPerimeter = false;
      let edgesFacingUnburned = 0;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const nr = row + dr;
        const nc = col + dc;
        const outOfBounds = nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize;
        const isCardinal = dr === 0 || dc === 0;

        if (outOfBounds) {
          // Grid edge counts as "unburned" for perimeter purposes.
          isPerimeter = true;
          if (isCardinal) edgesFacingUnburned++;
          continue;
        }
        if (grid[nr * gridSize + nc].state === CellState.Unburned) {
          isPerimeter = true;
          if (isCardinal) edgesFacingUnburned++;
        }
      }

      if (isPerimeter) {
        perimeterCellCount++;
        totalEdges += edgesFacingUnburned;
        if (maxCells > 0) candidates.push({ idx, row, col });
      }
    }
  }

  const perimeterMeters = totalEdges * cellSizeMeters;

  if (maxCells <= 0 || burningCount === 0 || candidates.length === 0) {
    return { picked: [], perimeterCellCount, perimeterMeters };
  }

  centroidR /= burningCount;
  centroidC /= burningCount;

  // Wind blows TOWARD (windDir + 180). Score by alignment with that vector.
  const headRad = ((windDirectionDeg + 180) * Math.PI) / 180;
  const headDr = -Math.cos(headRad);
  const headDc = Math.sin(headRad);

  const scored = candidates.map((c) => {
    const dr = c.row - centroidR;
    const dc = c.col - centroidC;
    const len = Math.sqrt(dr * dr + dc * dc) || 1;
    return { idx: c.idx, score: (dr * headDr + dc * headDc) / len };
  });
  scored.sort((a, b) => b.score - a.score);
  return {
    picked: scored.slice(0, maxCells).map((s) => s.idx),
    perimeterCellCount,
    perimeterMeters,
  };
}
