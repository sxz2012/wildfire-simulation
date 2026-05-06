import { describe, it, expect, vi, afterEach } from "vitest";
import { findMinRosterForBoundary } from "../inverseSearch";
import { CellState, FuelType, ResourceType, type SimulationConfig } from "../types";
import type { LatLng } from "../../utils/containmentCheck";

// Mulberry32: tiny deterministic RNG, used for tests that need stable
// stochastic outcomes regardless of test order.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const config: SimulationConfig = {
  gridSize: 10,
  cellSizeMeters: 50,
  windSpeed: 0,
  windDirection: 0,
  humidity: 50,
  defaultFuel: FuelType.Grass,
  timestepMinutes: 3,
};

const fuelMap = new Array(100).fill(FuelType.Grass);
const centerLat = 37;
const centerLng = -122;

function makeBurningGrid(burningIndices: number[]): Uint8Array {
  const g = new Uint8Array(100);
  for (const i of burningIndices) g[i] = CellState.Burning;
  return g;
}

describe("findMinRosterForBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polygon enclosing entire grid → recommendedRoster = []", async () => {
    const polygon: LatLng[] = [
      { lat: centerLat - 0.5, lng: centerLng - 0.5 },
      { lat: centerLat - 0.5, lng: centerLng + 0.5 },
      { lat: centerLat + 0.5, lng: centerLng + 0.5 },
      { lat: centerLat + 0.5, lng: centerLng - 0.5 },
    ];
    const initialGrid = makeBurningGrid([55]);

    const result = await findMinRosterForBoundary({
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 30,
    });

    expect(result.recommendedRoster).not.toBeNull();
    expect(result.recommendedRoster!.length).toBe(0);
    expect(result.passingRun).not.toBeNull();
    expect(result.bisectionTrace.length).toBe(1);
    expect(result.breachStep).toBeNull();
    expect(result.breachPercent).toBe(0);
  });

  it("mid-range scenario → recommendedRoster.length > 0", async () => {
    // Polygon just barely covers the grid extent — fire CAN escape if not contained.
    // Grid is 10*50 = 500m wide. 1 deg lat ~= 111320m; 500m ~= 0.0045 deg.
    // Use ~half the grid extent (very tight) so unsuppressed fire breaches it.
    const halfDeg = 0.0015;
    const polygon: LatLng[] = [
      { lat: centerLat - halfDeg, lng: centerLng - halfDeg },
      { lat: centerLat - halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng - halfDeg },
    ];
    const initialGrid = makeBurningGrid([55]);

    const result = await findMinRosterForBoundary({
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 30,
    });

    expect(result.recommendedRoster).not.toBeNull();
    expect(result.recommendedRoster!.length).toBeGreaterThan(0);
    expect(result.passingRun).not.toBeNull();
    expect(result.failingRun).not.toBeNull();
    expect(result.bisectionTrace.length).toBeGreaterThanOrEqual(2);
    expect(result.bisectionTrace.length).toBeLessThanOrEqual(8);
  });

  it("uncontainable scenario → recommendedRoster = null", async () => {
    // Tiny polygon far from the grid. ALL grid cells start burning OUTSIDE
    // the polygon. Even max suppression cannot fully extinguish 100 cells
    // within maxSteps, so containment never holds.
    const polygon: LatLng[] = [
      { lat: centerLat + 0.4, lng: centerLng + 0.4 },
      { lat: centerLat + 0.4, lng: centerLng + 0.4001 },
      { lat: centerLat + 0.4001, lng: centerLng + 0.4001 },
      { lat: centerLat + 0.4001, lng: centerLng + 0.4 },
    ];
    const allBurning = Array.from({ length: 100 }, (_, i) => i);
    const initialGrid = makeBurningGrid(allBurning);

    const result = await findMinRosterForBoundary({
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 5,
    });

    expect(result.recommendedRoster).toBeNull();
    expect(result.bestEffortRoster.length).toBeGreaterThan(0);
    expect(result.failingRun).not.toBeNull();
    expect(result.passingRun).toBeNull();
  });

  it("bisection budget bounded", async () => {
    const halfDeg = 0.0015;
    const polygon: LatLng[] = [
      { lat: centerLat - halfDeg, lng: centerLng - halfDeg },
      { lat: centerLat - halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng - halfDeg },
    ];
    const initialGrid = makeBurningGrid([55]);

    const result = await findMinRosterForBoundary({
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 30,
    });

    expect(result.bisectionTrace.length).toBeLessThanOrEqual(8);
  });

  it("breachTolerancePct=50 accepts looser containment that default rejects", async () => {
    // "Ring" scenario: a perimeter ring of burning cells inside a polygon
    // that almost — but not quite — encloses them. Under strict 2% tolerance
    // the bisection cannot find a passing roster (returns null). With 50%
    // tolerance most candidates "pass" and the cheapest one is recommended.
    const halfDeg = 0.0024;
    const polygon: LatLng[] = [
      { lat: centerLat - halfDeg, lng: centerLng - halfDeg },
      { lat: centerLat - halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng - halfDeg },
    ];
    const ringIdx: number[] = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (r === 0 || r === 9 || c === 0 || c === 9) ringIdx.push(r * 10 + c);
      }
    }
    const initialGrid = makeBurningGrid(ringIdx);

    // Constrain the search ceiling so the strict default truly fails
    // (full 2500 ch/hr ceiling with 23 dozers would otherwise pass).
    const baseInput = {
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 5,
    };

    const strict = await findMinRosterForBoundary({
      ...baseInput,
      modelConfig: { searchCeilingChainsHr: 200 },
    });
    expect(strict.recommendedRoster).toBeNull();

    const loose = await findMinRosterForBoundary({
      ...baseInput,
      modelConfig: { searchCeilingChainsHr: 200, breachTolerancePct: 50 },
    });
    expect(loose.recommendedRoster).not.toBeNull();
    expect(loose.recommendedRoster!.length).toBeGreaterThan(0);
  });

  it("searchCeilingChainsHr=200 caps the bisection and reports a small bestEffort", async () => {
    // Demanding scenario (3x3 ignite, very tight polygon) that ordinarily
    // needs ~525 ch/hr to contain. With ceiling=200 the bisection cannot
    // find a passing roster, and bestEffortRoster reflects the 200-ch/hr
    // cheapest mix.
    const halfDeg = 0.0008;
    const polygon: LatLng[] = [
      { lat: centerLat - halfDeg, lng: centerLng - halfDeg },
      { lat: centerLat - halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng - halfDeg },
    ];
    const initialGrid = makeBurningGrid([
      44, 45, 46, 54, 55, 56, 64, 65, 66,
    ]);

    const result = await findMinRosterForBoundary({
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 10,
      modelConfig: { searchCeilingChainsHr: 200 },
    });

    expect(result.recommendedRoster).toBeNull();
    expect(result.bestEffortRoster.length).toBeGreaterThan(0);
    // No bisection candidate should ever exceed the explicit ceiling.
    for (const entry of result.bisectionTrace) {
      expect(entry.capacityChainsHr).toBeLessThanOrEqual(200);
    }
    // 200 ch/hr cheapest mix = 2 dozers (150) + ceil(50/9)=6 crews +
    // helitack + tanker. We assert the dozer count specifically.
    const dozers = result.bestEffortRoster.find(
      (r) => r.type === ResourceType.Type1Dozer,
    );
    expect(dozers?.count).toBe(2);
  });

  it("rosterOverrides.dozerChainsHr=150 produces a recommendation with fewer dozers", async () => {
    // Mid-range demanding scenario: 3x3 ignite + tight polygon. Default
    // packing (75 ch/hr per dozer) recommends 3 dozers. Doubling the dozer
    // rate to 150 ch/hr lets the packer cover the same capacity with fewer
    // dozers (compensating with crews where needed).
    //
    // simulateStep() uses Math.random(), so we seed it deterministically
    // for both runs to keep this test order-independent.
    const halfDeg = 0.0015;
    const polygon: LatLng[] = [
      { lat: centerLat - halfDeg, lng: centerLng - halfDeg },
      { lat: centerLat - halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng + halfDeg },
      { lat: centerLat + halfDeg, lng: centerLng - halfDeg },
    ];
    const initialGrid = makeBurningGrid([
      44, 45, 46, 54, 55, 56, 64, 65, 66,
    ]);

    const baseInput = {
      config,
      fuelMap,
      centerLat,
      centerLng,
      initialGrid,
      initialStep: 0,
      polygon,
      maxSteps: 10,
    };

    const dozerCount = (roster: { type: ResourceType; count: number }[]) =>
      roster.find((r) => r.type === ResourceType.Type1Dozer)?.count ?? 0;

    let rng = mulberry32(100);
    const spy = vi.spyOn(Math, "random").mockImplementation(() => rng());

    rng = mulberry32(100);
    const def = await findMinRosterForBoundary(baseInput);
    rng = mulberry32(100);
    const over = await findMinRosterForBoundary({
      ...baseInput,
      modelConfig: { rosterOverrides: { dozerChainsHr: 150 } },
    });
    spy.mockRestore();

    expect(def.recommendedRoster).not.toBeNull();
    expect(over.recommendedRoster).not.toBeNull();
    const defaultDozers = dozerCount(def.recommendedRoster!);
    const overrideDozers = dozerCount(over.recommendedRoster!);
    expect(defaultDozers).toBeGreaterThan(0);
    expect(overrideDozers).toBeLessThan(defaultDozers);
  });
});
