export interface FireHotspot {
  lat: number;
  lng: number;
  frp: number;
}

export interface FireFrame {
  date: string;
  hotspots: FireHotspot[];
}

export interface HistoricalFire {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  location: { lat: number; lng: number; altitude: number };
  frames: FireFrame[];
}

// Lazy-load fire data to avoid bundling all JSON upfront
const fireModules: Record<string, () => Promise<HistoricalFire>> = {
  "camp-fire-2018": () => import("./fires/camp-fire-2018.json").then((m) => m.default as HistoricalFire),
  "black-summer-2020": () => import("./fires/black-summer-2020.json").then((m) => m.default as HistoricalFire),
  "dixie-fire-2021": () => import("./fires/dixie-fire-2021.json").then((m) => m.default as HistoricalFire),
  "maui-fire-2023": () => import("./fires/maui-fire-2023.json").then((m) => m.default as HistoricalFire),
  "park-fire-2024": () => import("./fires/park-fire-2024.json").then((m) => m.default as HistoricalFire),
};

export const HISTORICAL_FIRE_LIST = [
  { id: "camp-fire-2018", name: "Camp Fire 2018", description: "The deadliest and most destructive wildfire in California history. Destroyed the town of Paradise in hours." },
  { id: "black-summer-2020", name: "Australian Black Summer 2020", description: "Catastrophic bushfire season in Australia. The Blue Mountains fires devastated communities west of Sydney." },
  { id: "dixie-fire-2021", name: "Dixie Fire 2021", description: "The largest single fire in California history, burning nearly 1 million acres over 3 months." },
  { id: "maui-fire-2023", name: "Maui Fire 2023", description: "Fast-moving wildfire that devastated the historic town of Lahaina, driven by hurricane-force winds." },
  { id: "park-fire-2024", name: "Park Fire 2024", description: "One of the largest fires in California history, rapidly spreading through Butte and Tehama counties." },
];

export async function loadHistoricalFire(id: string): Promise<HistoricalFire> {
  const loader = fireModules[id];
  if (!loader) throw new Error(`Unknown fire: ${id}`);
  return loader();
}
