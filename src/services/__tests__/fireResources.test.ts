import { describe, it, expect } from "vitest";
import { suggestBundleFromStationCount } from "../fireResources";

describe("suggestBundleFromStationCount", () => {
  it("falls back to initialAttack for sparse areas", () => {
    expect(suggestBundleFromStationCount(0)).toBe("initialAttack");
    expect(suggestBundleFromStationCount(2)).toBe("initialAttack");
  });

  it("scales up by station count thresholds", () => {
    expect(suggestBundleFromStationCount(5)).toBe("type3");
    expect(suggestBundleFromStationCount(9)).toBe("type3");
    expect(suggestBundleFromStationCount(10)).toBe("type2");
    expect(suggestBundleFromStationCount(19)).toBe("type2");
    expect(suggestBundleFromStationCount(20)).toBe("type1");
    expect(suggestBundleFromStationCount(100)).toBe("type1");
  });
});
