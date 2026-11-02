import { CellState, type GridCell, type SimulationConfig } from "./types";
import { CORRECTION_SIZE, correctionInputs, forEachSpreadAttempt, type SpreadCorrection } from "./spread";

/**
 * Learning a per-fire correction to the pre-trained spread model from observed
 * fire, step by step: every unburned cell touching the fire is one example
 * (did it catch in the next step?), explained by the model's chances from each
 * burning neighbour. The correction is fitted on top of the model (see
 * correctedRate in spread.ts), pulled toward "no change" when data is thin.
 */

export interface Example {
  y: 0 | 1;
  /** One entry per burning neighbour: the model's logit and the correction inputs. */
  attempts: { logit0: number; x: number[] }[];
}

const clampP = (p: number) => Math.min(Math.max(p, 1e-6), 1 - 1e-6);

/** Examples from observed states `from`→`to` (each step t → t+1), using the uncorrected model under `config`. */
export function collectExamples(
  states: Uint8Array[],
  from: number,
  to: number,
  config: SimulationConfig,
  gridFor: (state: Uint8Array) => GridCell[],
  useML = true
): Example[] {
  const plain: SimulationConfig = { ...config, spreadCorrection: undefined };
  const scale = config.spreadScale ?? 1;
  const out: Example[] = [];
  for (let t = from; t < to; t++) {
    const byCell = new Map<number, Example>();
    forEachSpreadAttempt(gridFor(states[t]), plain, t + 1, useML, (a) => {
      let ex = byCell.get(a.cell);
      if (!ex) {
        ex = { y: states[t + 1][a.cell] !== CellState.Unburned ? 1 : 0, attempts: [] };
        byCell.set(a.cell, ex);
      }
      const p = clampP(a.rate * scale);
      ex.attempts.push({ logit0: Math.log(p / (1 - p)), x: correctionInputs(a) });
    });
    out.push(...byCell.values());
  }
  return out;
}

/**
 * Fit correction weights by maximum likelihood (a cell catches if any burning
 * neighbour ignites it) with an L2 pull toward zero worth `prior` examples.
 * Adam, warm-started from `init`.
 */
export function fitCorrection(
  examples: Example[],
  init: SpreadCorrection,
  { prior = 20, iters = 300, lr = 0.05 } = {}
): SpreadCorrection {
  const w = init.slice(0, CORRECTION_SIZE);
  while (w.length < CORRECTION_SIZE) w.push(0);
  if (examples.length === 0) return w;
  const m = new Array(CORRECTION_SIZE).fill(0), v = new Array(CORRECTION_SIZE).fill(0);
  const reg = prior / examples.length;
  for (let it = 1; it <= iters; it++) {
    const g = w.map((wi) => 2 * reg * wi);
    for (const ex of examples) {
      const ps = ex.attempts.map((a) => {
        let z = (1 + w[7]) * a.logit0;
        for (let k = 0; k < a.x.length; k++) z += w[k] * a.x[k];
        return 1 / (1 + Math.exp(-z));
      });
      let none = 1;
      for (const p of ps) none *= 1 - p;
      const caught = Math.max(1 - none, 1e-9);
      ex.attempts.forEach((a, j) => {
        // d(−log-likelihood)/dz for this attempt.
        const dz = (ex.y === 1 ? -(none / caught) * ps[j] : ps[j]) / examples.length;
        for (let k = 0; k < a.x.length; k++) g[k] += dz * a.x[k];
        g[7] += dz * a.logit0;
      });
    }
    for (let k = 0; k < CORRECTION_SIZE; k++) {
      m[k] = 0.9 * m[k] + 0.1 * g[k];
      v[k] = 0.999 * v[k] + 0.001 * g[k] * g[k];
      const mh = m[k] / (1 - 0.9 ** it), vh = v[k] / (1 - 0.999 ** it);
      w[k] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
  }
  return w;
}
