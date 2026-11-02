import { describe, it, expect } from "vitest";
import { ensembleGrid, fitFire, perLeadFromSurprises, surpriseRatios, fitSpreadScale, reactiveGrid, runFire, makeWorld, mulberry32, runTrial, trueMarginOverWindow, withSeed, type TrialSetup, type Variant } from "../robot/safetyEval";
import { ROBOT_DEFAULTS } from "../robot/types";
import { CellState, type SimulationState } from "../types";

const N = 30;
const TS = 15;
const idx = (r: number, c: number) => r * N + c;

/** States for steps 0..end where a cell burns from its ignition minute on. */
function statesFromIgnition(ign: Float32Array, end: number): SimulationState[] {
  return Array.from({ length: end + 1 }, (_, s) => ({
    timestep: s,
    grid: Uint8Array.from(ign, (m) => (m <= s * TS ? CellState.Burning : CellState.Unburned)),
  }));
}

function setup(forecastIgn: Float32Array, trueIgn: Float32Array): TrialSetup {
  const world = makeWorld(7, N);
  world.elevation.fill(100);
  world.fuel.fill("grass");
  const end = 60;
  return {
    world, launchStep: 0, endStep: end,
    stagingIdx: idx(15, 2), targetIdx: idx(15, 27),
    forecast: statesFromIgnition(forecastIgn, end),
    truth: statesFromIgnition(trueIgn, end),
    truthConditions: [{ fromMin: 0, c: world.archive }],
  };
}

const noMargin: Variant = { name: "none", robot: { ...ROBOT_DEFAULTS, entryMarginMin: 0, escapeMarginMin: 0 }, sensing: false };
const margins: Variant = { name: "margins", robot: ROBOT_DEFAULTS, sensing: false };

describe("trueMarginOverWindow", () => {
  const plan = { cells: [idx(0, 0), idx(0, 1), idx(0, 2)], arrivalMin: [0, 10, 20], minMarginMin: 0 };

  it("is the true time to spare after the dog leaves each cell it stood on", () => {
    const ign = new Float32Array(N * N).fill(Infinity);
    ign[idx(0, 1)] = 25; // dog is on this cell 10–20
    expect(trueMarginOverWindow(plan, 0, 15, ign)).toBe(10); // still there at the window's end
    expect(trueMarginOverWindow(plan, 15, 30, ign)).toBe(5); // left at 20
  });

  it("is ≤ 0 when the true fire reaches a cell while the dog is on it", () => {
    const ign = new Float32Array(N * N).fill(Infinity);
    ign[idx(0, 1)] = 12;
    expect(trueMarginOverWindow(plan, 0, 15, ign)).toBeLessThanOrEqual(0);
  });

  it("only scores the cells occupied within the window", () => {
    const ign = new Float32Array(N * N).fill(Infinity);
    ign[idx(0, 2)] = 5; // burns early, but the dog only gets there at 20
    expect(trueMarginOverWindow(plan, 0, 15, ign)).toBe(Infinity);
    expect(trueMarginOverWindow(plan, 15, 30, ign)).toBeLessThanOrEqual(0);
  });
});

describe("withSeed", () => {
  it("makes Math.random reproducible and restores it afterwards", () => {
    const saved = Math.random;
    const a = withSeed(3, () => [Math.random(), Math.random()]);
    const b = withSeed(3, () => [Math.random(), Math.random()]);
    expect(a).toEqual(b);
    expect(a[0]).toBe(mulberry32(3)());
    expect(Math.random).toBe(saved);
  });
});

describe("runTrial", () => {
  it("completes safely when the true fire stays away", () => {
    const far = new Float32Array(N * N).fill(Infinity);
    const r = runTrial(setup(far, far), margins);
    expect(r).toMatchObject({ caught: false, scouted: true, home: true });
  });

  it("stops scoring once the dog is home: fire reaching staging hours later is not a catch", () => {
    const far = new Float32Array(N * N).fill(Infinity);
    const truth = far.slice();
    truth[idx(15, 2)] = 800; // staging burns long after the mission ends
    const r = runTrial(setup(far, truth), margins);
    expect(r.home).toBe(true);
    expect(r.caught).toBe(false);
  });

  it("catches a dog with no margin when the true fire crosses its route sooner than forecast", () => {
    const forecast = new Float32Array(N * N).fill(Infinity);
    const truth = new Float32Array(N * N).fill(Infinity);
    // The true fire burns a full column across the route at minute 15; the dog walks into it.
    for (let r = 0; r < N; r++) truth[idx(r, 12)] = 15;
    const r = runTrial(setup(forecast, truth), noMargin);
    expect(r.caught).toBe(true);
    expect(r.minTrueMarginMin).toBeLessThanOrEqual(0);
  });

  it("a margin keeps the dog out of cells the forecast says burn soon", () => {
    const ign = new Float32Array(N * N).fill(Infinity);
    for (let r = 0; r < N; r++) ign[idx(r, 12)] = 150; // forecast and truth agree
    const r = runTrial(setup(ign, ign), margins);
    expect(r.caught).toBe(false);
    expect(r.minTrueMarginMin).toBeGreaterThan(0);
  });
});

describe("ensembleGrid", () => {
  it("plans on each cell's earliest ignition across the forecast runs", () => {
    const world = makeWorld(7, N);
    const a = new Float32Array(N * N).fill(Infinity), b = a.slice();
    a[idx(3, 3)] = 30; b[idx(3, 3)] = 60;
    a[idx(4, 4)] = 90; b[idx(4, 4)] = 45;
    const g = ensembleGrid(world, [statesFromIgnition(a, 10), statesFromIgnition(b, 10)], ROBOT_DEFAULTS);
    expect(g.ignitionMin[idx(3, 3)]).toBe(30);
    expect(g.ignitionMin[idx(4, 4)]).toBe(45);
    expect(g.ignitionMin[idx(5, 5)]).toBe(Infinity);
  });
});

describe("reactiveGrid", () => {
  const world = makeWorld(7, N);
  world.fuel.fill("grass");
  const state = new Uint8Array(N * N);
  state[idx(15, 15)] = CellState.Burning;

  it("blocks every spot within the keep-away distance of the flames it can see, now", () => {
    const g = reactiveGrid(world, state, idx(15, 2), 4, 100, ROBOT_DEFAULTS);
    expect(g.ignitionMin[idx(15, 12)]).toBe(100); // 3 cells from the flames
    expect(g.ignitionMin[idx(15, 20)]).toBe(Infinity); // 5 cells away
    expect(g.ignitionMin[idx(15, 2)]).toBe(Infinity);
  });

  it("lets a dog the fire has come close to move to spots no closer than it stands", () => {
    const dog = idx(15, 13); // 2 cells from the flames
    const g = reactiveGrid(world, state, dog, 4, 100, ROBOT_DEFAULTS);
    expect(g.ignitionMin[dog]).toBe(Infinity);
    expect(g.ignitionMin[idx(15, 12)]).toBe(Infinity); // farther: allowed
    expect(g.ignitionMin[idx(15, 14)]).toBe(100); // closer: blocked
  });

  it("ignores burned-out ground: only burning cells count as the fire", () => {
    const burned = new Uint8Array(N * N);
    burned[idx(15, 15)] = CellState.Burned;
    const g = reactiveGrid(world, burned, idx(15, 2), 4, 100, ROBOT_DEFAULTS);
    expect(g.ignitionMin[idx(15, 14)]).toBe(Infinity);
  });
});

describe("runTrial: reacting vs planning on a prediction", () => {
  // A fast run: in one 15-min step the fire sweeps over the east of the map, where the target is.
  const ign = new Float32Array(N * N).fill(Infinity);
  for (let r = 0; r < N; r++) for (let c = 10; c < N; c++) ign[idx(r, c)] = 15;

  it("a dog that only reacts to the flames it sees walks into a run it could not see coming", () => {
    const r = runTrial(setup(ign, ign), { name: "react", robot: { ...ROBOT_DEFAULTS, entryMarginMin: 0, escapeMarginMin: 0 }, sensing: false, reactBufferCells: 4 });
    expect(r.caught).toBe(true);
  });

  it("a dog planning on a correct prediction never steps toward it", () => {
    const r = runTrial(setup(ign, ign), margins);
    expect(r.caught).toBe(false);
  });
});

describe("fitSpreadScale", () => {
  it("recovers that the observed fire spreads faster than the model expects", () => {
    const world = makeWorld(11, 60);
    world.fuel.fill("grass");
    const observed = runFire(world, null, 0, 12, world.archive, 5, 1.75);
    expect(fitSpreadScale(world, observed, 12, 4, world.archive, 9)).toBeGreaterThanOrEqual(1.45);
  });

  it("and slower", () => {
    const world = makeWorld(11, 60);
    world.fuel.fill("grass");
    const observed = runFire(world, null, 0, 12, world.archive, 5, 0.6);
    expect(fitSpreadScale(world, observed, 12, 4, world.archive, 9)).toBeLessThanOrEqual(0.85);
  });
});

describe("fitFire (steady fitter)", () => {
  // A fire of a few hundred cells, like the test missions after launch; tiny fires are mostly noise.
  const world = makeWorld(11, 100);
  world.fuel.fill("grass");
  const c = { ...world.archive, windSpeed: 30 };

  it("finds that the real wind blows 60° away from what the forecast assumed", () => {
    const observed = runFire(world, null, 0, 24, { ...c, windDirection: (c.windDirection + 60) % 360 }, 5);
    const fit = fitFire(world, observed, 24, 8, c, { spread: 1, windOffset: 0 }, 9);
    expect(fit.windOffset).toBeGreaterThanOrEqual(30);
  });

  it("finds the faster spread", () => {
    const observed = runFire(world, null, 0, 24, c, 5, 1.75);
    const fit = fitFire(world, observed, 24, 8, c, { spread: 1, windOffset: 0 }, 9);
    expect(fit.spread).toBeGreaterThanOrEqual(1.45);
  });

  it("keeps the current settings when the fire behaves as forecast", () => {
    const observed = runFire(world, null, 0, 24, c, 5);
    expect(fitFire(world, observed, 24, 8, c, { spread: 1, windOffset: 0 }, 9)).toEqual({ spread: 1, windOffset: 0 });
  });
});

describe("calibrating the margin to this fire's surprises", () => {
  const states = (burning: number[]) => {
    const g = new Uint8Array(N * N);
    for (const c of burning) g[c] = CellState.Burning;
    return g;
  };

  it("scores each cell that just caught by how much earlier than forecast, beyond the base margin, per minute ahead", () => {
    const ign = new Float32Array(N * N).fill(100);
    ign[idx(0, 1)] = 60; // caught on time
    // Forecast made at minute 0; at minute 60 two cells have caught.
    const r = surpriseRatios({ fromMin: 0, ignitionMin: ign }, states([]), states([idx(0, 0), idx(0, 1)]), 60, 15);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo((100 - 60 - 15) / 60, 6); // 40 min early: 25 beyond the base, over 60 min ahead
    expect(r[1]).toBeCloseTo(-15 / 60, 6);
  });

  it("caps a cell the forecast never burned", () => {
    const ign = new Float32Array(N * N).fill(Infinity);
    const r = surpriseRatios({ fromMin: 0, ignitionMin: ign }, states([]), states([idx(3, 3)]), 60, 15);
    expect(r[0]).toBe(2);
  });

  it("ignores cells already burning, and forecasts made after", () => {
    const ign = new Float32Array(N * N).fill(100);
    expect(surpriseRatios({ fromMin: 0, ignitionMin: ign }, states([idx(0, 0)]), states([idx(0, 0)]), 60, 15)).toEqual([]);
    expect(surpriseRatios({ fromMin: 60, ignitionMin: ign }, states([]), states([idx(0, 0)]), 60, 15)).toEqual([]);
  });

  it("covers the chosen share of surprises, never below 0, and uses the fallback until there is enough data", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i / 100); // 0.00 … 0.99
    expect(perLeadFromSurprises(samples, 0.9, 0.25, 50)).toBeCloseTo(0.9, 2);
    expect(perLeadFromSurprises(samples.slice(0, 10), 0.9, 0.25, 50)).toBe(0.25);
    expect(perLeadFromSurprises(Array(80).fill(-0.3), 0.9, 0.25, 50)).toBe(0);
  });
});

describe("runTrial: keeping a distance from the predicted fire", () => {
  // A line of fire burning from the start, 250 m north of the straight route (row 10 vs row 15).
  const fire = new Float32Array(N * N).fill(Infinity);
  for (let c = 8; c <= 20; c++) fire[idx(10, c)] = 0;

  it("reports how close the dog came to the real flames", () => {
    expect(runTrial(setup(fire, fire), margins).minTrueDistanceM).toBe(250);
  });

  it("a dog keeping 300 m from the predicted fire detours and stays further than that", () => {
    const keep300: Variant = { name: "keep 300 m", robot: noMargin.robot, sensing: false, keepAwayM: 300 };
    const r = runTrial(setup(fire, fire), keep300);
    expect(r.scouted).toBe(true);
    expect(r.minTrueDistanceM).toBeGreaterThan(300);
  });
});

describe("runTrial: scouting from a distance", () => {
  // Flames 100 m east of the target from the start: the target itself is too close.
  const fire = new Float32Array(N * N).fill(Infinity);
  for (let r = 10; r <= 20; r++) fire[idx(r, 29)] = 0;

  it("scouts from the closest spot that keeps the distance, and says how far short of the target that is", () => {
    const keep300: Variant = { name: "keep 300 m", robot: noMargin.robot, sensing: false, keepAwayM: 300 };
    const r = runTrial(setup(fire, fire), keep300);
    expect(r.scouted).toBe(true);
    expect(r.home).toBe(true);
    expect(r.minTrueDistanceM).toBeGreaterThan(300);
    expect(r.scoutSpotToTargetM).toBe(250); // column 22, the first 350 m from the flames
  });

  it("a dog without a keep-away distance aims for the target itself", () => {
    expect(runTrial(setup(fire, fire), margins).scoutSpotToTargetM).toBe(0);
  });
});
