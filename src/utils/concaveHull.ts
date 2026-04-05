/**
 * Compute a fire perimeter polygon from a cloud of hotspot points.
 * Uses angular-sector farthest-point selection from centroid.
 * Works well for fire shapes that spread roughly outward.
 *
 * @param points Array of [lng, lat] coordinate pairs
 * @param sectors Number of angular sectors (more = finer boundary, default 90)
 * @returns Ordered boundary points as [lng, lat][] forming a closed polygon
 */
export function computeFirePerimeter(
  points: [number, number][],
  sectors = 90
): [number, number][] {
  if (points.length < 3) return [];

  let cx = 0, cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;

  const sectorSize = (2 * Math.PI) / sectors;
  const boundary: ([number, number] | null)[] = new Array(sectors).fill(null);
  const maxDist: number[] = new Array(sectors).fill(0);

  for (const p of points) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += 2 * Math.PI;
    const sectorIdx = Math.min(Math.floor(angle / sectorSize), sectors - 1);
    const dist = dx * dx + dy * dy;
    if (dist > maxDist[sectorIdx]) {
      maxDist[sectorIdx] = dist;
      boundary[sectorIdx] = p;
    }
  }

  const raw = boundary.filter((p): p is [number, number] => p !== null);

  // Filter out interior points that ended up as the only point in their sector.
  // Compute median squared distance and reject points far below it.
  if (raw.length === 0) return [];
  const dists = raw.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy;
  });
  const sorted = [...dists].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = median * 0.1; // points closer than ~31% of median distance are interior
  return raw.filter((_, i) => dists[i] >= threshold);
}

export function computeCentroid(points: [number, number][]): [number, number] {
  let cx = 0, cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  return [cx / points.length, cy / points.length];
}

export function estimateAreaHectares(hotspotCount: number): number {
  return hotspotCount * 14;
}

export function formatArea(hectares: number): string {
  if (hectares >= 10000) {
    return (hectares / 100).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " km²";
  }
  return hectares.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " ha";
}

export function formatAcres(hectares: number): string {
  const acres = hectares * 2.471;
  return acres.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " acres";
}
