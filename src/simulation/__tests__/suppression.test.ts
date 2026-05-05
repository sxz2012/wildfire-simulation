import { describe, it, expect } from "vitest";
import {
  totalChainsPerHour,
  delayDecay,
  containmentProbability,
} from "../suppression";
import { ResourceType } from "../types";

describe("totalChainsPerHour", () => {
  it("returns 0 for an empty roster", () => {
    expect(totalChainsPerHour([])).toBe(0);
  });

  it("sums per-resource rates by count", () => {
    // 3 Type-2 crews @ 6 chains/hr each = 18
    // + 1 Type-1 dozer @ 75 = 93
    const total = totalChainsPerHour([
      { type: ResourceType.Type2Crew, count: 3 },
      { type: ResourceType.Type1Dozer, count: 1 },
    ]);
    expect(total).toBe(18 + 75);
  });

  it("ignores aerial-only resources for direct line", () => {
    // Helitack and AirTanker have chainsPerHour=0; their effect is
    // modeled separately as ROS reduction / retardant.
    const total = totalChainsPerHour([
      { type: ResourceType.Helitack, count: 2 },
      { type: ResourceType.AirTanker, count: 1 },
    ]);
    expect(total).toBe(0);
  });
});

describe("delayDecay (Hirsch-Martell)", () => {
  it("returns ~1.0 for zero delay", () => {
    expect(delayDecay(0)).toBeCloseTo(1.0, 5);
  });

  it("returns ~0.5 at the characteristic time of 90 min", () => {
    // exp(-90/90) = exp(-1) ≈ 0.368
    expect(delayDecay(90)).toBeCloseTo(Math.exp(-1), 5);
  });

  it("monotonically decreases with delay", () => {
    expect(delayDecay(0)).toBeGreaterThan(delayDecay(30));
    expect(delayDecay(30)).toBeGreaterThan(delayDecay(60));
    expect(delayDecay(60)).toBeGreaterThan(delayDecay(180));
  });

  it("never goes negative or above 1", () => {
    expect(delayDecay(1000)).toBeGreaterThan(0);
    expect(delayDecay(-10)).toBeLessThanOrEqual(1);
  });
});

describe("containmentProbability (Reed-McCool)", () => {
  it("returns 0 when no line has been laid", () => {
    expect(containmentProbability(0, 5000)).toBe(0);
  });

  it("returns 0 when perimeter is 0", () => {
    // Avoid divide-by-zero — no fire => no containment metric.
    expect(containmentProbability(100, 0)).toBe(0);
  });

  it("approaches 1 as line laid >> perimeter", () => {
    expect(containmentProbability(50_000, 1_000)).toBeGreaterThan(0.99);
  });

  it("monotonically increases with line laid", () => {
    expect(containmentProbability(100, 1000)).toBeLessThan(
      containmentProbability(500, 1000),
    );
  });

  it("equals 1 - 1/e when line equals perimeter", () => {
    // P = 1 - exp(-1) = 0.632
    expect(containmentProbability(1000, 1000)).toBeCloseTo(1 - Math.exp(-1), 5);
  });
});
