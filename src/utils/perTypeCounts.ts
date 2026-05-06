import { ResourceType } from "../simulation/types";
import type { ResourceCount } from "../simulation/types";

export interface PerTypeCounts {
  crews: number;
  engines: number;
  dozers: number;
  helitack: number;
  tankers: number;
}

export interface PerTypeCountsInput {
  bundle: ResourceCount[];
  step: number;
  deployStep: number;
  endStep: number;
}

export function perTypeCounts(input: PerTypeCountsInput): PerTypeCounts {
  const { bundle, step, deployStep, endStep } = input;
  if (step < deployStep || step > endStep) {
    return { crews: 0, engines: 0, dozers: 0, helitack: 0, tankers: 0 };
  }
  const result: PerTypeCounts = {
    crews: 0,
    engines: 0,
    dozers: 0,
    helitack: 0,
    tankers: 0,
  };
  for (const { type, count } of bundle) {
    switch (type) {
      case ResourceType.Type1Crew:
      case ResourceType.Type2Crew:
        result.crews += count;
        break;
      case ResourceType.Engine:
        result.engines += count;
        break;
      case ResourceType.Type1Dozer:
        result.dozers += count;
        break;
      case ResourceType.Helitack:
        result.helitack += count;
        break;
      case ResourceType.AirTanker:
        result.tankers += count;
        break;
    }
  }
  return result;
}
