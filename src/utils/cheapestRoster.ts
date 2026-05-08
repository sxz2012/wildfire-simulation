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

/**
 * Order in which the solver picks a "remainder filler" — the ground resource
 * used to make up whatever Dozer floor() leaves on the table. Lower index
 * preferred. Type 1 Crew is cheapest-per-chain AND fastest, so it leads.
 * Type 2 Crew matches Type 1 on $/chain but is slower (graceful fallback if
 * Type 1 hand crews aren't on call). Engine costs more per chain and is the
 * last resort when no hand crews are available.
 */
const FILLER_PREFERENCE: ResourceType[] = [
  ResourceType.Type1Crew,
  ResourceType.Type2Crew,
  ResourceType.Engine,
];

export function cheapestRosterForCapacity(
  targetChainsHr: number,
  overrides?: RosterRateOverrides,
  availableTypes?: ResourceType[],
): ResourceCount[] {
  if (targetChainsHr <= 0) return [];

  // When availableTypes is omitted, every solver-supported type is eligible
  // (back-compat). When provided, only listed types are eligible.
  const isAllowed = (t: ResourceType): boolean =>
    !availableTypes || availableTypes.includes(t);
  const dozerAllowed = isAllowed(ResourceType.Type1Dozer);
  const helitackAllowed = isAllowed(ResourceType.Helitack);
  const tankerAllowed = isAllowed(ResourceType.AirTanker);

  const dozerRate = dozerAllowed ? overrides?.dozerChainsHr ?? DOZER_RATE : 0;
  const helitackThreshold = overrides?.helitackThresholdChainsHr ?? HELITACK_THRESHOLD;
  const tankerThreshold = overrides?.tankerThresholdChainsHr ?? TANKER_THRESHOLD;

  // Pick the first allowed remainder-filler from the preference list. Type 1
  // Crew honors crewChainsHr override; the fallbacks use NWCG defaults.
  let fillerType: ResourceType | null = null;
  let fillerRate = 0;
  for (const candidate of FILLER_PREFERENCE) {
    if (!isAllowed(candidate)) continue;
    fillerType = candidate;
    fillerRate =
      candidate === ResourceType.Type1Crew
        ? overrides?.crewChainsHr ?? CREW_RATE
        : RESOURCE_RATES[candidate].chainsPerHour;
    break;
  }

  const roster: ResourceCount[] = [];
  const dozerCount = dozerRate > 0 ? Math.floor(targetChainsHr / dozerRate) : 0;
  if (dozerCount > 0) {
    roster.push({ type: ResourceType.Type1Dozer, count: dozerCount });
  }

  const remaining = targetChainsHr - dozerCount * dozerRate;
  const fillerCount =
    remaining > 0 && fillerType !== null && fillerRate > 0
      ? Math.ceil(remaining / fillerRate)
      : 0;
  if (fillerCount > 0 && fillerType !== null) {
    roster.push({ type: fillerType, count: fillerCount });
  }

  const totalGroundCapacity =
    dozerCount * dozerRate + fillerCount * fillerRate;
  if (helitackAllowed && totalGroundCapacity >= helitackThreshold) {
    roster.push({ type: ResourceType.Helitack, count: 1 });
  }
  if (tankerAllowed && totalGroundCapacity >= tankerThreshold) {
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
