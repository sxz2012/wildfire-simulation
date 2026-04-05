import { describe, it, expect } from "vitest";
import { computeFirePerimeter } from "../concaveHull";

describe("computeFirePerimeter", () => {
  it("returns empty array for < 3 points", () => {
    expect(computeFirePerimeter([])).toEqual([]);
    expect(computeFirePerimeter([[0, 0]])).toEqual([]);
    expect(computeFirePerimeter([[0, 0], [1, 1]])).toEqual([]);
  });

  it("returns a polygon for a simple point cloud", () => {
    const points: [number, number][] = [
      [0, 0], [1, 0], [2, 0],
      [0, 1], [1, 1], [2, 1],
      [0, 2], [1, 2], [2, 2],
    ];
    const hull = computeFirePerimeter(points);
    expect(hull.length).toBeGreaterThanOrEqual(4);
    for (const p of hull) {
      expect(points).toContainEqual(p);
    }
  });

  it("returns only outer points, not interior", () => {
    const points: [number, number][] = [];
    for (let a = 0; a < 360; a += 45) {
      const rad = (a * Math.PI) / 180;
      points.push([Math.cos(rad) * 10, Math.sin(rad) * 10]);
    }
    points.push([0, 0]); // interior point
    const hull = computeFirePerimeter(points);
    expect(hull).not.toContainEqual([0, 0]);
    expect(hull.length).toBe(8);
  });
});
