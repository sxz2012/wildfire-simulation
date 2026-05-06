import { ResourceType } from "../simulation/types";
import type { ResourceCount } from "../simulation/types";

const DOZER_RATE = 75;
const CREW_RATE = 9;
const HELITACK_THRESHOLD = 50;
const TANKER_THRESHOLD = 200;

export function cheapestRosterForCapacity(targetChainsHr: number): ResourceCount[] {
  if (targetChainsHr <= 0) return [];

  const roster: ResourceCount[] = [];
  const dozerCount = Math.floor(targetChainsHr / DOZER_RATE);
  if (dozerCount > 0) roster.push({ type: ResourceType.Type1Dozer, count: dozerCount });

  const remaining = targetChainsHr - dozerCount * DOZER_RATE;
  const crewCount = remaining > 0 ? Math.ceil(remaining / CREW_RATE) : 0;
  if (crewCount > 0) roster.push({ type: ResourceType.Type1Crew, count: crewCount });

  const totalGroundCapacity = dozerCount * DOZER_RATE + crewCount * CREW_RATE;
  if (totalGroundCapacity >= HELITACK_THRESHOLD) {
    roster.push({ type: ResourceType.Helitack, count: 1 });
  }
  if (totalGroundCapacity >= TANKER_THRESHOLD) {
    roster.push({ type: ResourceType.AirTanker, count: 1 });
  }
  return roster;
}
