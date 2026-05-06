import { ResourceType, RESOURCE_RATES } from "../simulation/types";
import type { ResourceCount } from "../simulation/types";

const DOZER_RATE = 75;
const CREW_RATE = 9;
const HELITACK_THRESHOLD = 50;
const TANKER_THRESHOLD = 200;

export interface RosterRateOverrides {
  dozerChainsHr?: number;
  crewChainsHr?: number;
  helitackThresholdChainsHr?: number;
  tankerThresholdChainsHr?: number;
}

export function cheapestRosterForCapacity(
  targetChainsHr: number,
  overrides?: RosterRateOverrides,
): ResourceCount[] {
  if (targetChainsHr <= 0) return [];

  const dozerRate = overrides?.dozerChainsHr ?? DOZER_RATE;
  const crewRate = overrides?.crewChainsHr ?? CREW_RATE;
  const helitackThreshold = overrides?.helitackThresholdChainsHr ?? HELITACK_THRESHOLD;
  const tankerThreshold = overrides?.tankerThresholdChainsHr ?? TANKER_THRESHOLD;

  const roster: ResourceCount[] = [];
  const dozerCount = dozerRate > 0 ? Math.floor(targetChainsHr / dozerRate) : 0;
  if (dozerCount > 0) roster.push({ type: ResourceType.Type1Dozer, count: dozerCount });

  const remaining = targetChainsHr - dozerCount * dozerRate;
  const crewCount = remaining > 0 && crewRate > 0 ? Math.ceil(remaining / crewRate) : 0;
  if (crewCount > 0) roster.push({ type: ResourceType.Type1Crew, count: crewCount });

  const totalGroundCapacity = dozerCount * dozerRate + crewCount * crewRate;
  if (totalGroundCapacity >= helitackThreshold) {
    roster.push({ type: ResourceType.Helitack, count: 1 });
  }
  if (totalGroundCapacity >= tankerThreshold) {
    roster.push({ type: ResourceType.AirTanker, count: 1 });
  }
  return roster;
}

export type RealismTier = "initialAttack" | "type23" | "type1" | "surge";

export interface RealismTierInfo {
  key: RealismTier;
  label: string;
  caveat: string | null;
}

/**
 * Classify a roster by its total fireline-construction capacity into a
 * realism tier so the UI can flag when a recommendation is operationally
 * extreme. Breakpoints calibrated against NWCG incident-tier definitions.
 */
export function classifyRoster(roster: ResourceCount[]): RealismTierInfo {
  const ch = roster.reduce(
    (sum, r) => sum + r.count * (RESOURCE_RATES[r.type]?.chainsPerHour ?? 0),
    0,
  );
  if (ch <= 100) {
    return { key: "initialAttack", label: "Initial Attack", caveat: null };
  }
  if (ch <= 400) {
    return { key: "type23", label: "Type 2 / Type 3", caveat: null };
  }
  if (ch <= 1000) {
    return {
      key: "type1",
      label: "Type 1 — single-incident maximum",
      caveat: null,
    };
  }
  return {
    key: "surge",
    label: "Multi-jurisdictional surge",
    caveat:
      "Beyond single-IC capacity — would require mutual aid from neighboring counties or federal pull-in.",
  };
}
