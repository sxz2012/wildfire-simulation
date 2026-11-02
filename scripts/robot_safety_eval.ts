/**
 * Robot-dog safety evaluation: many synthetic worlds, four dog setups, scored against the true fire.
 *
 *   npx tsx scripts/robot_safety_eval.ts [--worlds 200] [--jobs 24]
 *
 * Writes docs/poster/data/robot-safety.json (one row per world × scenario × setup) and prints a summary.
 * `--only "Grows,Calibrated"` runs just the setups whose names contain one of those words, `--skip "learned"` leaves
 * out those whose names do; `--out` writes elsewhere.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel } from "../src/simulation/mlModel.ts";
import { makeTrial, makeWorld, runTrial, type TrialResult, type Variant } from "../src/simulation/robot/safetyEval.ts";
import { ROBOT_DEFAULTS } from "../src/simulation/robot/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = path.join(ROOT, "docs/poster/data/robot-safety.json");

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};

// Margins are pinned here, not taken from ROBOT_DEFAULTS, so results stay comparable when the defaults change.
const NO_MARGIN = { ...ROBOT_DEFAULTS, entryMarginMin: 0, escapeMarginMin: 0 };
const MARGINS_30 = { ...ROBOT_DEFAULTS, entryMarginMin: 30, escapeMarginMin: 60 };
const MARGINS_60 = { ...ROBOT_DEFAULTS, entryMarginMin: 60, escapeMarginMin: 90 };
const MARGINS_45 = { ...ROBOT_DEFAULTS, entryMarginMin: 45, escapeMarginMin: 75 };
// Margin that grows with look-ahead: 15 or 30 min + 25% of how far ahead the forecast looks (escape: +30 min).
const GROWS_15 = { ...ROBOT_DEFAULTS, entryMarginMin: 15, escapeMarginMin: 45, marginPerLeadMin: 0.25 };
const GROWS_30 = { ...ROBOT_DEFAULTS, entryMarginMin: 30, escapeMarginMin: 60, marginPerLeadMin: 0.25 };
const ALL_VARIANTS: Variant[] = [
  // No forecast: sees the true flames every step (15 min) and keeps 200 m / 500 m (4 / 10 cells) away.
  { name: "Reacts to fire, keeps 200 m", robot: NO_MARGIN, sensing: false, reactBufferCells: 4 },
  { name: "Reacts to fire, keeps 500 m", robot: NO_MARGIN, sensing: false, reactBufferCells: 10 },
  { name: "No safety margin", robot: NO_MARGIN, sensing: false },
  { name: "Sensing only", robot: NO_MARGIN, sensing: true },
  { name: "Margins 30 only", robot: MARGINS_30, sensing: false },
  { name: "Margins 30 + sensing", robot: MARGINS_30, sensing: true },
  { name: "Margins 60 + sensing", robot: MARGINS_60, sensing: true },
  { name: "Margins 30 + sensing + 5-run forecast", robot: MARGINS_30, sensing: true, ensemble: 5 },
  // The whole fire observed every 15 min: forecast restarts from it; optionally its spread speed is re-fitted.
  { name: "Margins 60 + sensing + observed", robot: MARGINS_60, sensing: true, observe: true },
  { name: "Margins 60 + sensing + observed + tuned", robot: MARGINS_60, sensing: true, observe: true, tuneSpread: true },
  { name: "Margins 30 + sensing + observed + tuned", robot: MARGINS_30, sensing: true, observe: true, tuneSpread: true },
  // Learning: every 15 min, a correction to the spread model is learned from the last 2 h of observed spread.
  { name: "Margins 45 + sensing + observed", robot: MARGINS_45, sensing: true, observe: true },
  { name: "Margins 30 + sensing + observed", robot: MARGINS_30, sensing: true, observe: true },
  { name: "Margins 60 + sensing + observed + learned", robot: MARGINS_60, sensing: true, observe: true, learn: true },
  { name: "Margins 45 + sensing + observed + learned", robot: MARGINS_45, sensing: true, observe: true, learn: true },
  { name: "Margins 30 + sensing + observed + learned", robot: MARGINS_30, sensing: true, observe: true, learn: true },
  // Growing margin; sensing reports when the true fire is within 30 min, as for Margins 60.
  { name: "Grows 15 + 25% + sensing", robot: GROWS_15, sensing: true, sensingWithinMin: 30 },
  { name: "Grows 30 + 25% + sensing", robot: GROWS_30, sensing: true, sensingWithinMin: 30 },
  { name: "Grows 30 + 25% + sensing + observed", robot: GROWS_30, sensing: true, sensingWithinMin: 30, observe: true },
  // Growth set every 15 min from this fire's own surprises over the last 2 h (25% until there is enough data),
  // so the margin would have covered this share of the spots that caught.
  { name: "Calibrated 30, 50% + sensing + observed", robot: GROWS_30, sensing: true, sensingWithinMin: 30, observe: true, calibrateMargin: 0.5 },
  { name: "Calibrated 30, 75% + sensing + observed", robot: GROWS_30, sensing: true, sensingWithinMin: 30, observe: true, calibrateMargin: 0.75 },
  // Distance instead of time: stay this far from the predicted fire at every moment, and scout from the closest
  // spot to the target that keeps it (the poster dog typically comes ~70 m from the real flames). Sensing as for Margins 60.
  ...[100, 150, 200, 300, 500].map((m): Variant => ({ name: `Scouts from ${m} m + sensing`, robot: NO_MARGIN, sensing: true, sensingWithinMin: 30, keepAwayM: m })),
  ...[100, 200].map((m): Variant => ({ name: `Scouts from ${m} m + 30 min + sensing`, robot: MARGINS_30, sensing: true, sensingWithinMin: 30, keepAwayM: m })),
  ...[100, 200].map((m): Variant => ({ name: `Scouts from ${m} m + 30 min, no sensing`, robot: MARGINS_30, sensing: false, keepAwayM: m })),
];
const argStr = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = argStr("only")?.split(",");
const skip = argStr("skip")?.split(",");
const VARIANTS = ALL_VARIANTS.filter((v) => (!only || only.some((w) => v.name.includes(w))) && !skip?.some((w) => v.name.includes(w)));
const SCENARIOS = [
  { name: "Hotter and drier", windShift: false },
  { name: "Hotter, drier + wind shift", windShift: true },
];

type Row = TrialResult & { seed: number; scenario: string };

function runShard(seeds: number[]): Row[] {
  loadModel(JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/xgboost_model.json"), "utf-8")));
  const rows: Row[] = [];
  for (const seed of seeds) {
    const world = makeWorld(seed);
    for (const sc of SCENARIOS) {
      const setup = makeTrial(world, MARGINS_30, { windShift: sc.windShift });
      if (!setup) continue;
      for (const v of VARIANTS) rows.push({ seed, scenario: sc.name, ...runTrial(setup, v) });
    }
  }
  return rows;
}

const medianOf = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);

function summarise(rows: Row[]) {
  for (const sc of SCENARIOS) {
    const worlds = new Set(rows.filter((r) => r.scenario === sc.name).map((r) => r.seed)).size;
    console.log(`\n${sc.name} — ${worlds} worlds`);
    console.log("setup".padEnd(42), "caught".padStart(8), "close <10 min".padStart(14), "scouted".padStart(8), "home".padStart(6), "reports".padStart(8), "<100 m".padStart(7), "closest (median)".padStart(17), "spot short of target".padStart(21));
    for (const v of VARIANTS) {
      const rs = rows.filter((r) => r.scenario === sc.name && r.variant === v.name);
      const pct = (f: (r: Row) => boolean) => `${((100 * rs.filter(f).length) / rs.length).toFixed(1)}%`;
      const meanReports = (rs.reduce((s, r) => s + r.reports, 0) / rs.length).toFixed(1);
      const dist = rs.map((r) => r.minTrueDistanceM ?? Infinity).sort((a, b) => a - b);
      const median = dist.length ? dist[Math.floor(dist.length / 2)] : NaN;
      console.log(v.name.padEnd(42), pct((r) => r.caught).padStart(8), pct((r) => (r.minTrueMarginMin ?? Infinity) < 10).padStart(14),
        pct((r) => r.scouted).padStart(8), pct((r) => r.home).padStart(6), meanReports.padStart(8),
        pct((r) => (r.minTrueDistanceM ?? Infinity) < 100).padStart(7), `${Math.round(median)} m`.padStart(17),
        `${Math.round(medianOf(rs.filter((r) => r.scouted).map((r) => r.scoutSpotToTargetM ?? 0)))} m`.padStart(21));
    }
  }
}

const shard = process.argv.indexOf("--shard");
if (shard >= 0) {
  const seeds = process.argv[shard + 1].split(",").map(Number);
  process.stdout.write(JSON.stringify(runShard(seeds)));
} else {
  const worlds = arg("worlds", 200), jobs = arg("jobs", 24), first = arg("first", 1);
  const seeds = Array.from({ length: worlds }, (_, i) => first + i);
  const shards = Array.from({ length: jobs }, (_, j) => seeds.filter((_, i) => i % jobs === j)).filter((s) => s.length);
  const t0 = Date.now();
  const parts = await Promise.all(shards.map((s) => new Promise<Row[]>((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--shard", s.join(","), ...(only ? ["--only", only.join(",")] : []), ...(skip ? ["--skip", skip.join(",")] : [])], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`shard exited ${code}`))));
  })));
  const OUT = argStr("out") ? path.resolve(argStr("out")!) : DEFAULT_OUT;
  const rows = parts.flat().sort((a, b) => a.seed - b.seed);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ worlds, variants: VARIANTS.map((v) => v.name), scenarios: SCENARIOS.map((s) => s.name), rows }, null, 1));
  summarise(rows);
  console.log(`\n${rows.length} trials in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${path.relative(ROOT, OUT)}`);
}
