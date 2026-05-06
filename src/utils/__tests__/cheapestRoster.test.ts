import { describe, it, expect } from "vitest";
import { cheapestRosterForCapacity } from "../cheapestRoster";
import { ResourceType } from "../../simulation/types";
import type { ResourceCount } from "../../simulation/types";

function expectRoster(roster: ResourceCount[], expected: ResourceCount[]) {
  const sortByType = (a: ResourceCount, b: ResourceCount) =>
    a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
  expect([...roster].sort(sortByType)).toEqual([...expected].sort(sortByType));
}

describe("cheapestRosterForCapacity", () => {
  it("returns empty roster for zero target", () => {
    expect(cheapestRosterForCapacity(0)).toEqual([]);
  });

  it("returns empty roster for negative target", () => {
    expect(cheapestRosterForCapacity(-10)).toEqual([]);
  });

  it("returns one dozer plus helitack at target = 75", () => {
    const roster = cheapestRosterForCapacity(75);
    expectRoster(roster, [
      { type: ResourceType.Type1Dozer, count: 1 },
      { type: ResourceType.Helitack, count: 1 },
    ]);
  });

  it("fills remaining capacity with crews at target = 100", () => {
    const roster = cheapestRosterForCapacity(100);
    expectRoster(roster, [
      { type: ResourceType.Type1Dozer, count: 1 },
      { type: ResourceType.Type1Crew, count: 3 },
      { type: ResourceType.Helitack, count: 1 },
    ]);
  });

  it("adds an air tanker once ground capacity reaches 200 at target = 250", () => {
    const roster = cheapestRosterForCapacity(250);
    expectRoster(roster, [
      { type: ResourceType.Type1Dozer, count: 3 },
      { type: ResourceType.Type1Crew, count: 3 },
      { type: ResourceType.Helitack, count: 1 },
      { type: ResourceType.AirTanker, count: 1 },
    ]);
  });

  it("scales dozers and includes both aerial assets at target = 1000", () => {
    const roster = cheapestRosterForCapacity(1000);
    const dozer = roster.find((r) => r.type === ResourceType.Type1Dozer);
    const tanker = roster.find((r) => r.type === ResourceType.AirTanker);
    const helitack = roster.find((r) => r.type === ResourceType.Helitack);
    expect(dozer).toBeDefined();
    expect(dozer!.count).toBeGreaterThanOrEqual(13);
    expect(tanker).toEqual({ type: ResourceType.AirTanker, count: 1 });
    expect(helitack).toEqual({ type: ResourceType.Helitack, count: 1 });
  });
});
