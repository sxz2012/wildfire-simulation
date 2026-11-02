import { createGrid, igniteCell } from "../grid";
import { collectExamples, fitCorrection, type Example } from "../learnCorrection";
import { CORRECTION_SIZE } from "../spread";
import { simulateStep } from "../spread";
import { CellState, FuelType, FUEL_PROPERTIES, type SimulationConfig, type SimulationState } from "../types";
import { computeIgnitionMinutes, fireOf, groundSpeedFromFuel, passableFromFuel, withKeepAway } from "./hazard";
import { snapToSafeCell } from "./geo";
import { advanceMission, createMission, missionFitsForecast, missionPose, scoutSpot, type Mission } from "./mission";
import type { Plan, PlannerGrid, RobotConfig } from "./types";
import { conditionsWeather, forecastMatch, shouldReport, spliceForecast, trueConditions, trueFireThreat, type Conditions, type Report } from "./worlds";

/**
 * Safety evaluation of the robot-dog planner: many synthetic worlds where the
 * true fire differs from the forecast (hotter, drier, and an unannounced wind
 * shift). The dog plans on the forecast; we score it against the true fire.
 */

/** Small seeded PRNG (mulberry32) so every world and every fire run is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run `fn` with Math.random replaced by a seeded generator (the spread model draws from Math.random). */
export function withSeed<T>(seed: number, fn: () => T): T {
  const saved = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

export interface World {
  seed: number;
  config: SimulationConfig;
  centerLat: number;
  centerLng: number;
  elevation: Float32Array;
  fuel: FuelType[];
  archive: Conditions;
  igniteIdx: number;
}

/** Smooth value noise in [0, 1] on an n×n grid, `cells` cells per lattice square. */
function valueNoise(n: number, cells: number, rand: () => number): Float32Array {
  const m = Math.ceil(n / cells) + 2;
  const lattice = Array.from({ length: m * m }, rand);
  const out = new Float32Array(n * n);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const y = r / cells, x = c / cells;
      const y0 = Math.floor(y), x0 = Math.floor(x);
      const ty = smooth(y - y0), tx = smooth(x - x0);
      const v = (i: number, j: number) => lattice[(y0 + i) * m + (x0 + j)];
      const top = v(0, 0) + (v(0, 1) - v(0, 0)) * tx;
      const bot = v(1, 0) + (v(1, 1) - v(1, 0)) * tx;
      out[r * n + c] = top + (bot - top) * ty;
    }
  }
  return out;
}

/** A synthetic landscape: rolling hills, grass/shrub/forest patches, sometimes a river, random weather. */
export function makeWorld(seed: number, gridSize = 200): World {
  const rand = mulberry32(seed);
  const n = gridSize;
  const hills = valueNoise(n, 40, rand), ridges = valueNoise(n, 12, rand), patches = valueNoise(n, 15, rand);
  const relief = 150 + rand() * 350; // metres of relief across the map
  const base = 200 + rand() * 600;
  const elevation = new Float32Array(n * n);
  const fuel: FuelType[] = new Array(n * n);
  const river = rand() < 0.5 ? { a: rand() * n, slope: rand() * 1.2 - 0.6 } : null;
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n;
    elevation[i] = base + relief * (0.75 * hills[i] + 0.25 * ridges[i]);
    // Forest favours high ground, grass low ground.
    const p = 0.6 * patches[i] + 0.4 * hills[i];
    fuel[i] = p < 0.38 ? FuelType.Grass : p < 0.62 ? FuelType.Shrub : FuelType.Forest;
    if (river && Math.abs(c - (river.a + river.slope * (r - n / 2))) < 1.5) fuel[i] = FuelType.Water;
  }
  const igniteIdx = Math.floor(n / 2) * n + Math.floor(n / 2);
  fuel[igniteIdx] = FuelType.Shrub;
  const archive: Conditions = {
    windDirection: rand() * 360,
    windSpeed: 10 + rand() * 20,
    humidity: 15 + rand() * 25,
    tempC: 20 + rand() * 15,
  };
  const config: SimulationConfig = {
    gridSize: n,
    cellSizeMeters: 50,
    windSpeed: archive.windSpeed,
    windDirection: archive.windDirection,
    humidity: archive.humidity,
    defaultFuel: FuelType.Grass,
    timestepMinutes: 15,
    recentPrecip3Day: 0,
    landCoverCode: 126,
  };
  return { seed, config, centerLat: 36.27, centerLng: -121.8, elevation, fuel, archive, igniteIdx };
}

/** The simulator config for `world` under conditions `c`, with an optional spread speed and learned correction. */
export function fireConfig(world: World, c: Conditions, spreadScale = 1, spreadCorrection?: number[]): SimulationConfig {
  return {
    ...world.config,
    windDirection: c.windDirection,
    windSpeed: c.windSpeed,
    humidity: c.humidity,
    spreadScale,
    spreadCorrection,
    ...conditionsWeather(c),
  } as SimulationConfig;
}

/** The world's cells with the fire states of `state` (for learning from an observed snapshot). */
export function worldGrid(world: World, state: Uint8Array) {
  const grid = createGrid(world.config, world.centerLat, world.centerLng, () => 0, world.fuel, world.elevation);
  grid.forEach((cell, i) => { cell.state = state[i] as CellState; });
  return grid;
}

/** Run the fire from `startGrid` at `startStep` to `endStep` under conditions `c`; states from `startStep` on. */
export function runFire(
  world: World, startGrid: Uint8Array | null, startStep: number, endStep: number, c: Conditions, seed: number, spreadScale = 1,
  spreadCorrection?: number[]
): SimulationState[] {
  const config = fireConfig(world, c, spreadScale, spreadCorrection);
  return withSeed(seed, () => {
    let grid = createGrid(config, world.centerLat, world.centerLng, () => 0, world.fuel, world.elevation);
    if (startGrid) {
      grid.forEach((cell, i) => {
        cell.state = startGrid[i] as CellState;
        if (cell.state === CellState.Burning) cell.burnTimer = FUEL_PROPERTIES[cell.fuel].burnDuration;
      });
    } else {
      const n = config.gridSize;
      igniteCell(grid, Math.floor(world.igniteIdx / n), world.igniteIdx % n, n);
    }
    const snap = () => Uint8Array.from(grid, (cell) => cell.state);
    const out: SimulationState[] = [{ grid: snap(), timestep: startStep }];
    for (let step = startStep + 1; step <= endStep; step++) {
      grid = simulateStep(grid, config, step);
      out.push({ grid: snap(), timestep: step });
    }
    return out;
  });
}

export function plannerGridFor(world: World, states: SimulationState[], robot: RobotConfig): PlannerGrid {
  const n = world.config.gridSize;
  return {
    gridSize: n,
    cellSizeMeters: world.config.cellSizeMeters,
    ignitionMin: computeIgnitionMinutes(states, world.config.timestepMinutes),
    elevation: world.elevation,
    passable: passableFromFuel(world.fuel, n),
    groundSpeed: groundSpeedFromFuel(world.fuel, n, robot.groundSpeed),
  };
}

/**
 * Closest call while the dog walks `plan` over (fromMin, toMin]: the smallest
 * (true ignition − time the dog leaves the cell). ≤ 0 means the true fire
 * reached a cell while the dog was on it.
 */
export function trueMarginOverWindow(plan: Plan, fromMin: number, toMin: number, trueIgn: Float32Array): number {
  let worst = Infinity;
  const { cells, arrivalMin } = plan;
  for (let i = 0; i < cells.length; i++) {
    const enter = Math.max(arrivalMin[i], fromMin);
    const leave = Math.min(i + 1 < cells.length ? arrivalMin[i + 1] : Infinity, toMin);
    if (leave <= fromMin || enter > toMin || leave < enter) continue;
    worst = Math.min(worst, trueIgn[cells[i]] - leave);
  }
  return worst;
}

export interface TrialSetup {
  world: World;
  launchStep: number;
  endStep: number;
  stagingIdx: number;
  targetIdx: number;
  /** Forecast the dog starts with (archive weather), from step 0. */
  forecast: SimulationState[];
  /** The true fire, from step 0 (identical to the forecast before launch). */
  truth: SimulationState[];
  /** True weather after each change, in time order. */
  truthConditions: Array<{ fromMin: number; c: Conditions }>;
}

export interface Variant {
  name: string;
  robot: RobotConfig;
  sensing: boolean;
  /** Forecast runs per forecast (default 1); the dog plans on each cell's earliest ignition across them. */
  ensemble?: number;
  /** No forecast: each step the dog sees the true flames and keeps this many cells away from them. */
  reactBufferCells?: number;
  /** Every step (15 min) the fire is observed and the forecast restarts from it. */
  observe?: boolean;
  /** With `observe`: also re-fit the spread speed to the last hour of observed spread. */
  tuneSpread?: boolean;
  /** With `observe`: every hour, fit wind direction and spread speed to the last 2 hours (steady fitter). */
  steadyFit?: boolean;
  /** With `observe`: every step, learn a correction to the spread model from the last 2 hours of observed spread. */
  learn?: boolean;
  /**
   * With `observe`: every step, set the margin's growth per minute of look-ahead so it would have
   * covered this share of the last 2 hours' surprises (cells catching earlier than forecast).
   */
  calibrateMargin?: number;
  /**
   * Plan to stay this far (metres) from the predicted fire at every moment, on top of any time margin,
   * and scout from the closest spot to the target that keeps that distance.
   */
  keepAwayM?: number;
  /** Sensing: the dog reports when the true fire gets this close in time (default half the entry margin). */
  sensingWithinMin?: number;
}

/** A forecast as the dog planned on it: when it was made and when it says each cell ignites. */
export interface IssuedForecast {
  fromMin: number;
  ignitionMin: Float32Array;
}

/** Ratios r are capped here: a cell the forecast never burned counts as a big surprise, not an infinite one. */
const SURPRISE_CAP = 2;

/**
 * For each cell that caught between `prev` and `now` (observed at `nowMin`): how much earlier than
 * `forecast` said, beyond `baseMin`, per minute the forecast looked ahead. A margin of
 * baseMin + r·(look-ahead) would just have covered that cell. Empty for a forecast made at or after `nowMin`.
 */
export function surpriseRatios(forecast: IssuedForecast, prev: Uint8Array, now: Uint8Array, nowMin: number, baseMin: number): number[] {
  const lead = nowMin - forecast.fromMin;
  if (!(lead > 0)) return [];
  const out: number[] = [];
  for (let i = 0; i < now.length; i++) {
    if (now[i] === CellState.Unburned || prev[i] !== CellState.Unburned) continue;
    const early = forecast.ignitionMin[i] - nowMin;
    out.push(Math.min((early - baseMin) / lead, SURPRISE_CAP));
  }
  return out;
}

/** Margin growth per minute ahead that covers share `q` of `samples` (≥ 0); `fallback` until there are `minSamples`. */
export function perLeadFromSurprises(samples: number[], q: number, fallback: number, minSamples: number): number {
  if (samples.length < minSamples) return fallback;
  const sorted = [...samples].sort((a, b) => a - b);
  const k = Math.min(sorted.length - 1, Math.ceil(q * (sorted.length + 1)) - 1);
  return Math.max(0, sorted[k]);
}

/** Distance in cells (8-neighbour chamfer, ≈ Euclidean) from each cell to the nearest burning cell. */
function distanceToFlames(state: Uint8Array, n: number): Float32Array {
  const d = new Float32Array(n * n);
  for (let i = 0; i < d.length; i++) d[i] = state[i] === CellState.Burning ? 0 : Infinity;
  const relax = (i: number, j: number, w: number) => { if (d[j] + w < d[i]) d[i] = d[j] + w; };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c;
    if (r > 0) { relax(i, i - n, 1); if (c > 0) relax(i, i - n - 1, Math.SQRT2); if (c < n - 1) relax(i, i - n + 1, Math.SQRT2); }
    if (c > 0) relax(i, i - 1, 1);
  }
  for (let r = n - 1; r >= 0; r--) for (let c = n - 1; c >= 0; c--) {
    const i = r * n + c;
    if (r < n - 1) { relax(i, i + n, 1); if (c > 0) relax(i, i + n - 1, Math.SQRT2); if (c < n - 1) relax(i, i + n + 1, Math.SQRT2); }
    if (c < n - 1) relax(i, i + 1, 1);
  }
  return d;
}

/**
 * The dog with no forecast: spots within `bufferCells` of the flames it sees now
 * are off limits from now on (ignition = now); everything else is open. When the
 * fire has already come closer than that, the dog may move to any spot no closer
 * to the flames than where it stands, so it can always back away.
 */
export function reactiveGrid(
  world: World, state: Uint8Array, dogCell: number, bufferCells: number, nowMin: number, robot: RobotConfig
): PlannerGrid {
  const grid = plannerGridFor(world, [], robot);
  const d = distanceToFlames(state, world.config.gridSize);
  const limit = Math.min(bufferCells, d[dogCell]) - 1e-6;
  grid.ignitionMin = Float32Array.from(d, (x) => (x < limit ? nowMin : Infinity));
  return grid;
}

/** Planner grid from several forecast runs: each cell ignites at the earliest minute any run says. */
export function ensembleGrid(world: World, runs: SimulationState[][], robot: RobotConfig): PlannerGrid {
  const grid = plannerGridFor(world, runs[0], robot);
  for (const run of runs.slice(1)) {
    const ign = computeIgnitionMinutes(run, world.config.timestepMinutes);
    for (let i = 0; i < ign.length; i++) if (ign[i] < grid.ignitionMin[i]) grid.ignitionMin[i] = ign[i];
  }
  return grid;
}

/** Spread speeds tried when fitting the forecast to the observed fire. */
export const SPREAD_SCALES = [0.5, 0.7, 0.85, 1, 1.2, 1.45, 1.75, 2.1];

/**
 * The spread speed that best explains the last `lookback` steps of observed
 * fire: rerun from the fire as observed then and score the overlap of new
 * spread with the fire as observed now.
 */
export function fitSpreadScale(world: World, observed: SimulationState[], step: number, lookback: number, c: Conditions, seed: number): number {
  const from = step - lookback;
  let best = 1, bestScore = -1;
  for (const scale of SPREAD_SCALES) {
    const run = runFire(world, observed[from].grid, from, step, c, seed, scale);
    const score = forecastMatch(run[run.length - 1].grid, observed[step].grid, world.config.gridSize, observed[from].grid);
    if (score > bestScore) [best, bestScore] = [scale, score];
  }
  return best;
}

export interface FireFit {
  spread: number;
  /** Degrees added to the assumed wind direction. */
  windOffset: number;
}

const WIND_OFFSETS = [-60, -30, 0, 30, 60];
const FIT_SPREADS = [0.7, 0.85, 1, 1.2, 1.45, 1.75];

/**
 * Steadier fit to the observed fire: each candidate is scored by the overlap
 * of new spread over `lookback` steps, averaged across `runs` forecast runs;
 * the wind direction is fitted first, then the spread speed. A candidate
 * replaces the current fit only if it wins by more than the run-to-run noise
 * (two standard errors) and by at least `minGain` points.
 */
export function fitFire(
  world: World, observed: SimulationState[], step: number, lookback: number, c: Conditions, current: FireFit, seed: number,
  runs = 4, minGain = 2
): FireFit {
  const from = step - lookback, n = world.config.gridSize;
  const score = (f: FireFit) => {
    const wind = { ...c, windDirection: (c.windDirection + f.windOffset + 360) % 360 };
    const xs = Array.from({ length: runs }, (_, r) => {
      const run = runFire(world, observed[from].grid, from, step, wind, seed + 31 * r, f.spread);
      return forecastMatch(run[run.length - 1].grid, observed[step].grid, n, observed[from].grid);
    });
    const mean = xs.reduce((a, b) => a + b, 0) / runs;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, runs - 1);
    return { mean, se2: variance / runs };
  };
  const pick = (cands: FireFit[], base: FireFit) => {
    let best = base, bestScore = score(base);
    for (const f of cands) {
      if (f.spread === base.spread && f.windOffset === base.windOffset) continue;
      const sc = score(f);
      if (sc.mean - bestScore.mean >= Math.max(minGain, 2 * Math.sqrt(sc.se2 + bestScore.se2))) [best, bestScore] = [f, sc];
    }
    return best;
  };
  const wind = pick(WIND_OFFSETS.map((o) => ({ spread: current.spread, windOffset: o })), current);
  return pick(FIT_SPREADS.map((k) => ({ spread: k, windOffset: wind.windOffset })), wind);
}

export interface TrialResult {
  variant: string;
  caught: boolean;
  /** Smallest true time-to-fire at a spot the dog stood on (minutes); Infinity if never near. */
  minTrueMarginMin: number;
  /** Closest the dog came to the real flames (metres, centre to centre); Infinity if no flames. */
  minTrueDistanceM: number;
  /** How far short of the target the dog's scouting spot is (metres; 0 = the target itself). */
  scoutSpotToTargetM: number;
  scouted: boolean;
  home: boolean;
  reports: number;
  replans: number;
}

const conditionsAt = (setup: TrialSetup, min: number) => {
  let c = setup.truthConditions[0].c;
  for (const x of setup.truthConditions) if (x.fromMin <= min) c = x.c;
  return c;
};

/** Cells the dog stands on at some point in (fromMin, toMin] while walking `plan`. */
function cellsOccupied(plan: Plan, fromMin: number, toMin: number): number[] {
  const out: number[] = [];
  const { cells, arrivalMin } = plan;
  for (let i = 0; i < cells.length; i++) {
    const leave = i + 1 < cells.length ? arrivalMin[i + 1] : Infinity;
    if (leave > fromMin && arrivalMin[i] <= toMin) out.push(cells[i]);
  }
  return out;
}

/** Walk one mission against the true fire, step by step as the app's timeline does. */
export function runTrial(setup: TrialSetup, variant: Variant, trace?: (line: string) => void): TrialResult {
  const { world, launchStep, endStep } = setup;
  const ts = world.config.timestepMinutes;
  const n = world.config.gridSize;
  let robot = variant.robot;
  const trueIgn = computeIgnitionMinutes(setup.truth, ts);
  const k = variant.ensemble ?? 1;
  // Extra archive forecasts for an ensemble (the first run is the shared setup.forecast).
  let runs = [setup.forecast, ...Array.from({ length: k - 1 }, (_, j) =>
    runFire(world, null, 0, endStep, world.archive, world.seed * 1000 + 500 + j))];
  const launchMin = launchStep * ts;
  const react = variant.reactBufferCells;
  // The keep-away distance comes from the variant, not robot.keepAwayM, so pinned setups stay comparable.
  const keepAway = (g: PlannerGrid): PlannerGrid => withKeepAway(g, variant.keepAwayM);
  let grid = react === undefined
    ? keepAway(ensembleGrid(world, runs, robot))
    : reactiveGrid(world, setup.truth[launchStep].grid, setup.stagingIdx, react, launchMin, robot);
  grid.forecastMin = launchMin;
  // Forecasts made so far, and per step the surprises they held (for `calibrateMargin`).
  const issued: IssuedForecast[] = [{ fromMin: launchMin, ignitionMin: fireOf(grid) }];
  const surprises = new Map<number, number[]>();
  // Keeping a distance, the dog scouts from the closest spot to the target it can reach, hold, and still walk home from.
  const spot = (variant.keepAwayM === undefined ? null : scoutSpot(grid, setup.stagingIdx, setup.targetIdx, launchMin, robot)) ?? setup.targetIdx;
  let mission: Mission = createMission(setup.stagingIdx, spot, launchMin, grid, robot);
  const reports: Report[] = [];
  // Weather the forecast assumes (archive until the dog measures it) and its fitted spread speed.
  let assumed = world.archive, spread = 1;
  let fit: FireFit = { spread: 1, windOffset: 0 };
  // Learned correction to the spread model, and the per-step examples it is learned from (under `assumed`).
  let correction: number[] | undefined;
  let examples = new Map<number, Example[]>();
  const observed = setup.truth.map((st) => st.grid);
  const reforecast = (step: number) => {
    const c = { ...assumed, windDirection: (assumed.windDirection + fit.windOffset + 360) % 360 };
    runs = runs.map((run, j) =>
      spliceForecast(run, step, runFire(world, setup.truth[step].grid, step, endStep, c, world.seed * 1000 + step + 100 * j, spread * fit.spread, correction)));
    grid = { ...keepAway(ensembleGrid(world, runs, robot)), forecastMin: step * ts };
    issued.push({ fromMin: step * ts, ignitionMin: fireOf(grid) });
  };
  let worst = Infinity, scouted = false, closestM = Infinity;
  const flames = new Map<number, Float32Array>();
  const flamesAt = (step: number) => {
    if (!flames.has(step)) flames.set(step, distanceToFlames(setup.truth[step].grid, n));
    return flames.get(step)!;
  };

  for (let step = launchStep + 1; step <= endStep; step++) {
    // Home at staging: the mission is over and the dog is collected, so stop scoring.
    if (mission.phase === "done") break;
    const prevMin = (step - 1) * ts, min = step * ts;
    // Score the stretch just walked on the plan in force during it.
    const walked = mission.route ?? { cells: [mission.stagingIdx], arrivalMin: [prevMin], minMarginMin: Infinity };
    const windowMargin = trueMarginOverWindow(walked, prevMin, min, trueIgn);
    worst = Math.min(worst, windowMargin);
    for (const cell of cellsOccupied(walked, prevMin, min)) {
      const d = Math.min(flamesAt(step - 1)[cell], flamesAt(step)[cell]) * world.config.cellSizeMeters;
      if (d < closestM) closestM = d;
    }
    if (react !== undefined) {
      // Look again at the flames, from where the dog stands now.
      const pose = missionPose(mission, min, n);
      grid = reactiveGrid(world, setup.truth[step].grid, Math.round(pose.row) * n + Math.round(pose.col), react, min, robot);
    } else if (variant.observe) {
      // A fresh look at the whole fire: refit the spread speed to the last hour, restart the forecast from what is seen.
      if (variant.tuneSpread && step - 4 >= 0) spread = fitSpreadScale(world, setup.truth, step, 4, assumed, world.seed * 1000 + 700 + step);
      if (variant.steadyFit && (step - launchStep) % 4 === 0 && step >= 8) {
        fit = fitFire(world, setup.truth, step, 8, assumed, fit, world.seed * 1000 + 800 + step);
      }
      if (variant.learn && step >= 8) {
        const cfg = fireConfig(world, assumed);
        for (let t = step - 8; t < step; t++) {
          if (!examples.has(t)) examples.set(t, collectExamples(observed, t, t + 1, cfg, (st) => worldGrid(world, st)));
        }
        const window = Array.from({ length: 8 }, (_, i) => examples.get(step - 8 + i)!).flat();
        correction = fitCorrection(window, correction ?? new Array(CORRECTION_SIZE).fill(0), { iters: 150 });
      }
      if (variant.calibrateMargin !== undefined) {
        // How the forecasts of the last 2 hours did on the cells that caught in the last 15 min.
        surprises.set(step, issued.filter((f) => f.fromMin >= min - 120).flatMap((f) =>
          surpriseRatios(f, observed[step - 1], observed[step], min, variant.robot.entryMarginMin)));
        const window = Array.from({ length: 8 }, (_, i) => surprises.get(step - i) ?? []).flat();
        robot = { ...variant.robot, marginPerLeadMin: perLeadFromSurprises(window, variant.calibrateMargin, variant.robot.marginPerLeadMin ?? 0, 50) };
      }
      reforecast(step);
    }
    mission = advanceMission(mission, min, grid, robot);
    if (trace) {
      const at = missionPose(mission, min, n);
      trace(`${min} ${mission.phase} cell=${Math.round(at.row) * n + Math.round(at.col)} true margin ${windowMargin} ${mission.event ?? ""}`);
    }
    if (mission.phase === "scouting") scouted = true;
    if (!variant.sensing || mission.phase === "done") continue;

    const pose = missionPose(mission, min, n);
    const dogCell = Math.round(pose.row) * n + Math.round(pose.col);
    const near = trueFireThreat(mission.route, dogCell, min, ts, trueIgn, variant.sensingWithinMin ?? robot.entryMarginMin / 2);
    const shiftMin = setup.truthConditions.length > 1 ? setup.truthConditions[1].fromMin : null;
    if (shouldReport({ phase: mission.phase, trueFireNear: near, nowMin: min, reports, shiftMin, safetyGapMin: 2 * ts })) {
      // The dog measures the true weather; the forecast re-runs from the true fire now.
      const measured = conditionsAt(setup, min);
      assumed = measured;
      fit = { spread: 1, windOffset: 0 }; // measured weather replaces the fitted corrections
      correction = undefined;
      examples = new Map(); // examples were scored under the old weather
      reforecast(step);
      reports.push({ min, measured, assumed: measured, edgeOffsetM: 0, matchBefore: 0, matchAfter: 0 });
      mission = advanceMission(mission, min, grid, robot);
      trace?.(`${min} report → ${mission.phase} ${mission.event ?? ""}`);
    }
  }
  return {
    variant: variant.name,
    caught: worst <= 0,
    minTrueMarginMin: worst,
    minTrueDistanceM: closestM,
    scoutSpotToTargetM: Math.hypot(Math.floor(spot / n) - Math.floor(setup.targetIdx / n), (spot % n) - (setup.targetIdx % n)) * world.config.cellSizeMeters,
    scouted,
    home: mission.phase === "done",
    reports: reports.length,
    replans: mission.replanCount,
  };
}

/** Bearing (0 = north) from cell a to cell b, in degrees. */
function bearingDeg(a: number, b: number, n: number): number {
  const north = Math.floor(a / n) - Math.floor(b / n);
  const east = (b % n) - (a % n);
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

function cellAt(fromIdx: number, bearing: number, cells: number, n: number): number | null {
  const r = Math.round(Math.floor(fromIdx / n) - Math.cos((bearing * Math.PI) / 180) * cells);
  const c = Math.round((fromIdx % n) + Math.sin((bearing * Math.PI) / 180) * cells);
  return r < 1 || r >= n - 1 || c < 1 || c >= n - 1 ? null : r * n + c;
}

/**
 * Build one trial: forecast fire, staging upwind, a scouting target near the
 * forecast fire edge, and a true fire that is hotter and drier and, `shiftMin`
 * minutes after launch, turns its wind toward the target and strengthens.
 * Returns null when the world has no workable mission (e.g. no safe route).
 */
export function makeTrial(
  world: World,
  robot: RobotConfig,
  opts: { launchStep?: number; windowSteps?: number; windShift?: boolean } = {}
): TrialSetup | null {
  const rand = mulberry32(world.seed ^ 0x9e3779b9);
  const ts = world.config.timestepMinutes, n = world.config.gridSize;
  const launchStep = opts.launchStep ?? 16;
  const endStep = launchStep + (opts.windowSteps ?? 96);
  const forecast = runFire(world, null, 0, endStep, world.archive, world.seed * 1000 + 1);
  const grid = plannerGridFor(world, forecast, robot);
  const launchMin = launchStep * ts;

  // Staging: 3–4 km upwind (the wind blows from `windDirection`), clear of the forecast fire.
  const stagingBearing = world.archive.windDirection + (rand() - 0.5) * 90;
  const rawStaging = cellAt(world.igniteIdx, stagingBearing, 60 + rand() * 20, n);
  if (rawStaging === null) return null;
  const stagingIdx = snapToSafeCell(rawStaging, grid, launchMin, (endStep - launchStep) * ts, 15);
  if (stagingIdx === null) return null;

  // Target: along a random bearing, the first cell the forecast fire reaches an hour or more after the dog could.
  const minPerCell = (world.config.cellSizeMeters / robot.speedMps / 60) * 1.6;
  const targetBearing = rand() * 360;
  let targetIdx: number | null = null;
  for (let d = 4; d < n / 2; d++) {
    const cell = cellAt(world.igniteIdx, targetBearing, d, n);
    if (cell === null) break;
    const walk = Math.hypot(Math.floor(cell / n) - Math.floor(stagingIdx / n), (cell % n) - (stagingIdx % n)) * minPerCell;
    if (grid.ignitionMin[cell] > launchMin + walk + robot.entryMarginMin + 60) {
      targetIdx = snapToSafeCell(cell, grid, launchMin, robot.entryMarginMin, 10);
      break;
    }
  }
  if (targetIdx === null || targetIdx === stagingIdx) return null;
  const mission = createMission(stagingIdx, targetIdx, launchMin, grid, robot);
  if (!mission.route || !missionFitsForecast(mission, endStep * ts, robot)) return null;

  // The true fire: hotter and drier from launch; later an unannounced wind shift toward the target.
  const truthConditions = [{ fromMin: launchMin, c: trueConditions(world.archive) }];
  const truthHead = forecast.slice(0, launchStep);
  let truthTail: SimulationState[];
  if (opts.windShift ?? true) {
    const shiftStep = launchStep + 2 + Math.floor(rand() * 10);
    const shifted: Conditions = {
      ...truthConditions[0].c,
      windDirection: bearingDeg(targetIdx, world.igniteIdx, n), // blows from the fire toward the target
      windSpeed: Math.min(60, world.archive.windSpeed + 5 + rand() * 15),
    };
    truthConditions.push({ fromMin: shiftStep * ts, c: shifted });
    const before = runFire(world, forecast[launchStep].grid, launchStep, shiftStep, truthConditions[0].c, world.seed * 1000 + 2);
    const after = runFire(world, before[before.length - 1].grid, shiftStep, endStep, shifted, world.seed * 1000 + 3);
    truthTail = [...before.slice(0, -1), ...after];
  } else {
    truthTail = runFire(world, forecast[launchStep].grid, launchStep, endStep, truthConditions[0].c, world.seed * 1000 + 2);
  }
  return { world, launchStep, endStep, stagingIdx, targetIdx, forecast, truth: [...truthHead, ...truthTail], truthConditions };
}
