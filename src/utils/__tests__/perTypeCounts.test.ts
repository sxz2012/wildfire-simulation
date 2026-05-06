import { describe, it, expect } from "vitest";
import { perTypeCounts } from "../perTypeCounts";
import { SUPPRESSION_BUNDLES } from "../../simulation/types";

describe("perTypeCounts", () => {
  it("returns zeros before deployment", () => {
    expect(
      perTypeCounts({
        bundle: SUPPRESSION_BUNDLES.type2,
        step: 5,
        deployStep: 10,
        endStep: 100,
      }),
    ).toEqual({ crews: 0, engines: 0, dozers: 0, helitack: 0, tankers: 0 });
  });

  it("returns zeros after end step", () => {
    expect(
      perTypeCounts({
        bundle: SUPPRESSION_BUNDLES.type2,
        step: 150,
        deployStep: 10,
        endStep: 100,
      }),
    ).toEqual({ crews: 0, engines: 0, dozers: 0, helitack: 0, tankers: 0 });
  });

  it("returns full type2 counts at deployment step", () => {
    expect(
      perTypeCounts({
        bundle: SUPPRESSION_BUNDLES.type2,
        step: 10,
        deployStep: 10,
        endStep: 100,
      }),
    ).toEqual({ crews: 5, engines: 0, dozers: 3, helitack: 2, tankers: 1 });
  });

  it("returns full type1 counts mid-run", () => {
    expect(
      perTypeCounts({
        bundle: SUPPRESSION_BUNDLES.type1,
        step: 50,
        deployStep: 10,
        endStep: 100,
      }),
    ).toEqual({ crews: 10, engines: 0, dozers: 5, helitack: 3, tankers: 2 });
  });

  it("returns full initialAttack counts mid-run", () => {
    expect(
      perTypeCounts({
        bundle: SUPPRESSION_BUNDLES.initialAttack,
        step: 50,
        deployStep: 10,
        endStep: 100,
      }),
    ).toEqual({ crews: 1, engines: 1, dozers: 0, helitack: 1, tankers: 0 });
  });
});
