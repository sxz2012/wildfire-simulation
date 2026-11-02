import { describe, it, expect } from "vitest";
import { collectExamples, fitCorrection } from "../learnCorrection";
import { createGrid, igniteCell } from "../grid";
import { simulateStep, correctedRate, CORRECTION_SIZE } from "../spread";
import { CellState, DEFAULT_CONFIG, FuelType, type GridCell, type SimulationConfig } from "../types";

const N = 80;
const base: SimulationConfig = { ...DEFAULT_CONFIG, gridSize: N, windSpeed: 5 };

/** Observed fire: the base model plus a hidden correction, 40 steps from a single ignition (large enough to learn from). */
function observedFire(hidden: number[] | undefined, seed: number): Uint8Array[] {
  const config = { ...base, spreadCorrection: hidden };
  let grid = createGrid(config, 36.27, -121.8, () => 100);
  igniteCell(grid, N / 2, N / 2, N);
  let a = seed >>> 0;
  const saved = Math.random;
  Math.random = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  const states = [Uint8Array.from(grid, (c) => c.state)];
  try {
    for (let s = 1; s <= 40; s++) {
      grid = simulateStep(grid, config, s, false);
      states.push(Uint8Array.from(grid, (c) => c.state));
    }
  } finally {
    Math.random = saved;
  }
  return states;
}

const gridFor = (state: Uint8Array): GridCell[] => {
  const g = createGrid(base, 36.27, -121.8, () => 100);
  g.forEach((c, i) => { c.state = state[i] as CellState; });
  return g;
};

const learn = (states: Uint8Array[]) =>
  fitCorrection(collectExamples(states, 32, 40, base, gridFor, false), new Array(CORRECTION_SIZE).fill(0));

describe("learnCorrection", () => {
  it("collects one example per unburned cell next to the fire, labelled by whether it caught", () => {
    const states = observedFire(undefined, 1);
    const ex = collectExamples(states, 32, 33, base, gridFor, false);
    expect(ex.length).toBeGreaterThan(10);
    const caught = ex.filter((e) => e.y === 1).length;
    const newlyBurning = states[33].filter((s, i) => s !== CellState.Unburned && states[32][i] === CellState.Unburned).length;
    expect(caught).toBe(newlyBurning);
  });

  // A typical attempt: 5% chance per step, flat, in grass. The test wind blows from the west (270°),
  // so spreading east is also spreading downwind: align equals east.
  const typical = (east: number) => ({ cell: 0, rate: 0.05, align: east, slope: 0, fuel: FuelType.Grass, north: 0, east });

  it("learns that the observed fire spreads faster than the model", () => {
    const hidden = new Array(CORRECTION_SIZE).fill(0);
    hidden[0] = 1;
    const w = learn(observedFire(hidden, 3));
    expect(correctedRate(0.05, typical(0), w)).toBeGreaterThan(0.08);
  });

  it("learns that the observed fire runs east", () => {
    const hidden = new Array(CORRECTION_SIZE).fill(0);
    hidden[6] = 1.5;
    const w = learn(observedFire(hidden, 4));
    expect(correctedRate(0.05, typical(1), w)).toBeGreaterThan(2 * correctedRate(0.05, typical(-1), w));
  });

  it("stays close to no correction when the fire behaves as modelled", () => {
    const w = learn(observedFire(undefined, 5));
    for (const east of [-1, 0, 1]) {
      expect(correctedRate(0.05, typical(east), w)).toBeGreaterThan(0.035);
      expect(correctedRate(0.05, typical(east), w)).toBeLessThan(0.07);
    }
  });
});
