/**
 * Wildfire suppression model — pure functions, no side effects.
 * Uses NWCG production rates, Hirsch-Martell delay decay, and
 * Reed-McCool containment math. See:
 * docs/plans/2026-05-04-suppression-modeling-design.md
 */
import { CHAINS_TO_METERS, type ResourceCount } from "./types";

export function totalChainsPerHour(resources: ResourceCount[]): number {
  // implemented in A3
  void resources;
  return 0;
}

export function delayDecay(delayMinutes: number): number {
  // implemented in A3
  void delayMinutes;
  return 1;
}

export function containmentProbability(
  cumulativeLineMeters: number,
  activePerimeterMeters: number,
): number {
  // implemented in A3
  void cumulativeLineMeters;
  void activePerimeterMeters;
  return 0;
}

void CHAINS_TO_METERS;
