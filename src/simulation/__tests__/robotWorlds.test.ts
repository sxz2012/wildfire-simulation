import { describe, it, expect } from "vitest";
import {
  trueConditions,
  conditionsWeather,
  forecastAt,
  shouldReport,
  activeReport,
} from "../robot/worlds";
import type { ForecastVersion, Report } from "../robot/worlds";

describe("conditions", () => {
  it("trueConditions: hotter and drier, wind unchanged, humidity floored", () => {
    expect(trueConditions({ windDirection: 270, windSpeed: 15, humidity: 30, tempC: 31 }))
      .toEqual({ windDirection: 270, windSpeed: 15, humidity: 20, tempC: 36 });
    expect(trueConditions({ windDirection: 0, windSpeed: 5, humidity: 8, tempC: 20 }).humidity).toBe(5);
  });

  it("conditionsWeather maps like handleStartWildfire", () => {
    expect(conditionsWeather({ windDirection: 0, windSpeed: 0, humidity: 0, tempC: 30 }))
      .toEqual({ tempMean: 30, tempMax: 35, precipitation: 0, cumulativePrecip: 0 });
  });
});

describe("forecastAt", () => {
  it("picks the latest version starting at or before the minute", () => {
    const v = [{ fromMin: 100 }, { fromMin: 400 }] as ForecastVersion[];
    expect(forecastAt(v, 0)).toBe(v[0]);
    expect(forecastAt(v, 399)).toBe(v[0]);
    expect(forecastAt(v, 400)).toBe(v[1]);
  });
});

describe("shouldReport", () => {
  const base = { phase: "outbound" as const, trueFireNear: false, nowMin: 500, reports: [] as Report[], shiftMin: null };
  it("reports on reaching the edge", () => expect(shouldReport({ ...base, phase: "scouting" })).toBe(true));
  it("reports early when the true fire comes near", () => expect(shouldReport({ ...base, trueFireNear: true })).toBe(true));
  it("does not report while just walking", () => expect(shouldReport(base)).toBe(false));
  it("once per new information: no repeat while still scouting", () =>
    expect(shouldReport({ ...base, phase: "scouting", reports: [{ min: 450 } as Report] })).toBe(false));
  it("reports again after a shift newer than the last report", () =>
    expect(shouldReport({ ...base, phase: "scouting", reports: [{ min: 450 } as Report], shiftMin: 480 })).toBe(true));
  it("a shift while walking home alone does not report", () =>
    expect(shouldReport({ ...base, phase: "returning", reports: [{ min: 450 } as Report], shiftMin: 480 })).toBe(false));
  it("after a rewind (a future report exists) no new report is made", () =>
    expect(shouldReport({ ...base, phase: "scouting", reports: [{ min: 600 } as Report] })).toBe(false));
});

describe("activeReport", () => {
  it("card for 3 steps after the report, then collapsed; none before", () => {
    const r = [{ min: 450 } as Report];
    expect(activeReport(r, 440, 15)).toEqual({ report: null, cardVisible: false });
    expect(activeReport(r, 450, 15)).toEqual({ report: r[0], cardVisible: true });
    expect(activeReport(r, 494, 15).cardVisible).toBe(true);
    expect(activeReport(r, 495, 15)).toEqual({ report: r[0], cardVisible: false });
  });
});
