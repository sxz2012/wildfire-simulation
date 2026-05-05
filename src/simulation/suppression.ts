/**
 * Wildfire suppression model — pure functions, no side effects.
 * Uses NWCG production rates, Hirsch-Martell delay decay, and
 * Reed-McCool containment math. See:
 * docs/plans/2026-05-04-suppression-modeling-design.md
 */
import {
  CHAINS_TO_METERS,
  RESOURCE_RATES,
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
