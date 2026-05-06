/**
 * Query OpenStreetMap for `amenity=fire_station` features near a
 * lat/lng. Used to suggest a sensible default suppression bundle
 * based on real local infrastructure density.
 *
 * No API key required. Public Overpass instance — please be polite
 * (1 req/sec is the soft rate limit). We only fetch on ignition pin
 * placement which is a sparse user action.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export interface NearbyFireResources {
  /** Count of OSM amenity=fire_station features within `radiusKm`. */
  stationCount: number;
  /** The radius searched, in km. */
  radiusKm: number;
  /** Suggested suppression bundle key, derived from stationCount. */
  suggestedBundle: "initialAttack" | "type3" | "type2" | "type1";
}

/**
 * Heuristic mapping from local station density to a suppression tier.
 * Numbers reflect rough US fire-resource scaling; tune per region as
 * needed. Floor is initialAttack so we never tell the user "no
 * response possible" — even sparse rural areas get something.
 */
export function suggestBundleFromStationCount(
  stationCount: number,
): NearbyFireResources["suggestedBundle"] {
  if (stationCount >= 20) return "type1";
  if (stationCount >= 10) return "type2";
  if (stationCount >= 5) return "type3";
  return "initialAttack";
}

/**
 * Fetch the count of fire stations within `radiusKm` (default 10) of
 * (lat, lng) via Overpass. Returns the count + a suggested bundle.
 *
 * On any network / API error, falls back to a conservative count of 3
 * (typical small-town density → initialAttack). The UI should treat
 * this as best-effort, not authoritative.
 */
export async function fetchNearbyFireStations(
  lat: number,
  lng: number,
  radiusKm = 10,
): Promise<NearbyFireResources> {
  const radiusMeters = Math.round(radiusKm * 1000);
  const query = `
[out:json][timeout:25];
(
  node[amenity=fire_station](around:${radiusMeters},${lat},${lng});
  way[amenity=fire_station](around:${radiusMeters},${lat},${lng});
);
out count;
`.trim();

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        // Overpass returns 406 to requests with no/generic User-Agent
        // (typical of bots). Browsers always send their own UA so this
        // header is mostly a no-op there, but it lets the function work
        // when called from Node-style environments (smoke tests, SSR).
        "User-Agent": "WildfireVisualization/1.0 (https://github.com/)",
      },
      body: query,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();
    // Overpass `out count;` returns elements: [{ tags: { nodes, ways, ... } }]
    // We sum nodes + ways (both can be fire stations).
    const counts = data?.elements?.[0]?.tags ?? {};
    const stationCount =
      Number(counts.nodes ?? 0) + Number(counts.ways ?? 0);
    return {
      stationCount,
      radiusKm,
      suggestedBundle: suggestBundleFromStationCount(stationCount),
    };
  } catch (err) {
    console.warn("Overpass query failed; using fallback count:", err);
    const fallback = 3;
    return {
      stationCount: fallback,
      radiusKm,
      suggestedBundle: suggestBundleFromStationCount(fallback),
    };
  }
}
