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
  "thomas-fire-2017": () => import("./fires/thomas-fire-2017.json").then((m) => m.default as HistoricalFire),
  "woolsey-fire-2018": () => import("./fires/woolsey-fire-2018.json").then((m) => m.default as HistoricalFire),
  "caldor-fire-2021": () => import("./fires/caldor-fire-2021.json").then((m) => m.default as HistoricalFire),
  "marshall-fire-2021": () => import("./fires/marshall-fire-2021.json").then((m) => m.default as HistoricalFire),
  "hermits-peak-2022": () => import("./fires/hermits-peak-2022.json").then((m) => m.default as HistoricalFire),
  "amazon-2019": () => import("./fires/amazon-2019.json").then((m) => m.default as HistoricalFire),
  "siberia-2021": () => import("./fires/siberia-2021.json").then((m) => m.default as HistoricalFire),
  "canada-2023": () => import("./fires/canada-2023.json").then((m) => m.default as HistoricalFire),
  "greece-2023": () => import("./fires/greece-2023.json").then((m) => m.default as HistoricalFire),
  "chile-2024": () => import("./fires/chile-2024.json").then((m) => m.default as HistoricalFire),
};

export const HISTORICAL_FIRE_LIST = [
  // US fires
  { id: "thomas-fire-2017", name: "Thomas Fire 2017 (CA)", description: "At the time, the largest wildfire in modern California history. Burned through Ventura and Santa Barbara counties." },
  { id: "camp-fire-2018", name: "Camp Fire 2018 (CA)", description: "The deadliest and most destructive wildfire in California history. Destroyed the town of Paradise in hours." },
  { id: "woolsey-fire-2018", name: "Woolsey Fire 2018 (CA)", description: "Burned through the Santa Monica Mountains to the Pacific Ocean, destroying over 1,600 structures in Malibu." },
  { id: "caldor-fire-2021", name: "Caldor Fire 2021 (CA)", description: "Burned from the Sierra Nevada foothills to Lake Tahoe, forcing evacuations of South Lake Tahoe." },
  { id: "dixie-fire-2021", name: "Dixie Fire 2021 (CA)", description: "The largest single fire in California history, burning nearly 1 million acres over 3 months." },
  { id: "marshall-fire-2021", name: "Marshall Fire 2021 (CO)", description: "The most destructive fire in Colorado history. A rare winter grassfire destroyed over 1,000 homes in suburban Boulder County." },
  { id: "hermits-peak-2022", name: "Hermits Peak Fire 2022 (NM)", description: "The largest fire in New Mexico history, started by the US Forest Service during a prescribed burn gone wrong." },
  { id: "maui-fire-2023", name: "Maui Fire 2023 (HI)", description: "Fast-moving wildfire that devastated the historic town of Lahaina, driven by hurricane-force winds." },
  { id: "park-fire-2024", name: "Park Fire 2024 (CA)", description: "One of the largest fires in California history, rapidly spreading through Butte and Tehama counties." },
  // Global fires
  { id: "amazon-2019", name: "Amazon Fires 2019 (Brazil)", description: "Devastating fires in the Amazon basin drew worldwide attention to deforestation-driven burning." },
  { id: "black-summer-2020", name: "Black Summer 2020 (Australia)", description: "Catastrophic bushfire season in Australia. The Blue Mountains fires devastated communities west of Sydney." },
  { id: "siberia-2021", name: "Siberia Wildfires 2021 (Russia)", description: "Record-breaking fires across Siberia burned an area larger than all other global fires combined that year." },
  { id: "canada-2023", name: "Canada Wildfires 2023", description: "Canada's worst-ever wildfire season. Smoke blanketed much of North America for weeks." },
  { id: "greece-2023", name: "Greece Wildfires 2023", description: "The largest wildfire ever recorded in the EU. Devastated the Evros region near the Turkish border." },
  { id: "chile-2024", name: "Chile Wildfires 2024", description: "Deadly fires in the Valparaiso region killed over 130 people, Chile's deadliest fire disaster." },
];

export async function loadHistoricalFire(id: string): Promise<HistoricalFire> {
  const loader = fireModules[id];
  if (!loader) throw new Error(`Unknown fire: ${id}`);
  const fire = await loader();

  // Add a "before fire" empty frame so playback starts with a clean map
  if (fire.frames.length > 0 && fire.frames[0].hotspots.length > 0) {
    const firstDate = new Date(fire.frames[0].date + "T00:00:00Z");
    const dayBefore = new Date(firstDate.getTime() - 86400000);
    const beforeDate = dayBefore.toISOString().split("T")[0];
    fire.frames.unshift({ date: beforeDate, hotspots: [] });
  }

  return fire;
}
