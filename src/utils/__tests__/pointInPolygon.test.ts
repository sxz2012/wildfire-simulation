import { describe, it, expect } from "vitest";
import { pointInPolygon } from "../pointInPolygon";

describe("pointInPolygon", () => {
  it("classifies points against an axis-aligned square", () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(5, -1, square)).toBe(false);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
    expect(pointInPolygon(5, 15, square)).toBe(false);
  });

  it("handles concave (L-shaped) polygons with a cutout", () => {
    const lShape = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 5, lng: 10 },
      { lat: 5, lng: 5 },
      { lat: 10, lng: 5 },
      { lat: 10, lng: 0 },
    ];
    expect(pointInPolygon(3, 3, lShape)).toBe(true);
    expect(pointInPolygon(8, 8, lShape)).toBe(false);
  });

  it("classifies points against a triangle", () => {
    const triangle = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 0 },
      { lat: 5, lng: 10 },
    ];
    expect(pointInPolygon(5, 3, triangle)).toBe(true);
    expect(pointInPolygon(5, -1, triangle)).toBe(false);
  });

  it("returns the same result regardless of vertex winding order", () => {
    const ccw = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];
    const cw = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 0 },
      { lat: 10, lng: 10 },
      { lat: 0, lng: 10 },
    ];
    expect(pointInPolygon(5, 5, ccw)).toBe(true);
    expect(pointInPolygon(5, 5, cw)).toBe(true);
  });

  it("returns false for an empty polygon", () => {
    expect(pointInPolygon(0, 0, [])).toBe(false);
  });

  it("returns false for a single-vertex polygon", () => {
    expect(pointInPolygon(0, 0, [{ lat: 0, lng: 0 }])).toBe(false);
  });

  it("returns false for a two-vertex polygon", () => {
    expect(
      pointInPolygon(0, 0, [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ]),
    ).toBe(false);
  });
});
