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
  {
    id: "thomas-fire-2017", name: "Thomas Fire 2017 (CA)",
    description: "At the time, the largest wildfire in modern California history. Burned through Ventura and Santa Barbara counties.",
    details: "281,893 acres burned. 1,063 structures destroyed. $2.2 billion in damages. Caused deadly mudslides in Montecito weeks later. Driven by intense Santa Ana winds exceeding 60 mph.",
  },
  {
    id: "camp-fire-2018", name: "Camp Fire 2018 (CA)",
    description: "The deadliest and most destructive wildfire in California history. Destroyed the town of Paradise in hours.",
    details: "85 fatalities. 153,336 acres burned. 18,804 structures destroyed including nearly all of Paradise (pop. 26,000). Fire spread at 80 football fields per minute. Caused $16.5 billion in damages.",
  },
  {
    id: "woolsey-fire-2018", name: "Woolsey Fire 2018 (CA)",
    description: "Burned through the Santa Monica Mountains to the Pacific Ocean, destroying over 1,600 structures in Malibu.",
    details: "96,949 acres burned. 3 fatalities. 1,643 structures destroyed. 295,000 people evacuated — the largest evacuation in LA County history. Burned through celebrity homes in Malibu.",
  },
  {
    id: "caldor-fire-2021", name: "Caldor Fire 2021 (CA)",
    description: "Burned from the Sierra Nevada foothills to Lake Tahoe, forcing evacuations of South Lake Tahoe.",
    details: "221,835 acres burned. 1,003 structures destroyed. First fire to cross the Sierra Nevada crest in recorded history. 53,000 people evacuated from South Lake Tahoe.",
  },
  {
    id: "dixie-fire-2021", name: "Dixie Fire 2021 (CA)",
    description: "The largest single fire in California history, burning nearly 1 million acres over 3 months.",
    details: "963,309 acres burned. 1,329 structures destroyed. Burned for 104 days. Destroyed the historic town of Greenville entirely. Created its own weather systems (pyrocumulonimbus clouds).",
  },
  {
    id: "marshall-fire-2021", name: "Marshall Fire 2021 (CO)",
    description: "The most destructive fire in Colorado history. A rare winter grassfire destroyed over 1,000 homes in suburban Boulder County.",
    details: "6,026 acres burned. 1,084 homes destroyed. 2 fatalities. Unprecedented winter grass fire driven by 100+ mph winds. Spread through suburban neighborhoods in hours. $2 billion in damages.",
  },
  {
    id: "hermits-peak-2022", name: "Hermits Peak Fire 2022 (NM)",
    description: "The largest fire in New Mexico history, started by the US Forest Service during a prescribed burn gone wrong.",
    details: "341,471 acres burned. 903 structures destroyed. US government accepted liability — the FEMA Hermits Peak/Calf Canyon Claims Office has paid over $2 billion in damages.",
  },
  {
    id: "maui-fire-2023", name: "Maui Fire 2023 (HI)",
    description: "Fast-moving wildfire that devastated the historic town of Lahaina, driven by hurricane-force winds.",
    details: "101 fatalities — deadliest US wildfire in over a century. 2,170 acres burned. 2,207 structures destroyed. Wind gusts over 80 mph from Hurricane Dora. Historic Lahaina town largely destroyed. $5.5 billion in damages.",
  },
  {
    id: "park-fire-2024", name: "Park Fire 2024 (CA)",
    description: "One of the largest fires in California history, rapidly spreading through Butte and Tehama counties.",
    details: "429,603 acres burned. 716 structures destroyed. 4th largest fire in California history. Arson suspected — a man was arrested for allegedly pushing a burning car into a gully.",
  },
  // Global fires
  {
    id: "amazon-2019", name: "Amazon Fires 2019 (Brazil)",
    description: "Devastating fires in the Amazon basin drew worldwide attention to deforestation-driven burning.",
    details: "Over 80,000 fires detected across the Amazon in 2019 — an 84% increase over the previous year. Most fires were set intentionally to clear land for cattle ranching and agriculture. Triggered an international crisis.",
  },
  {
    id: "black-summer-2020", name: "Black Summer 2020 (Australia)",
    description: "Catastrophic bushfire season in Australia. The Blue Mountains fires devastated communities west of Sydney.",
    details: "46 million acres burned across Australia. 33 fatalities. 3,500+ homes destroyed. An estimated 3 billion animals killed or displaced. Smoke reached South America. Total damages exceeded $100 billion AUD.",
  },
  {
    id: "siberia-2021", name: "Siberia Wildfires 2021 (Russia)",
    description: "Record-breaking fires across Siberia burned an area larger than all other global fires combined that year.",
    details: "Over 45 million acres burned — larger than Greece. Smoke reached the North Pole for the first time in recorded history. Fires burned through permafrost, releasing stored carbon. CO2 emissions exceeded the annual output of many nations.",
  },
  {
    id: "canada-2023", name: "Canada Wildfires 2023",
    description: "Canada's worst-ever wildfire season. Smoke blanketed much of North America for weeks.",
    details: "Over 45 million acres burned — 6x the 10-year average. 8 fatalities. 200,000+ people evacuated. Smoke caused hazardous air quality across the US East Coast, turning New York City skies orange. Over 6,500 individual fires.",
  },
  {
    id: "greece-2023", name: "Greece Wildfires 2023",
    description: "The largest wildfire ever recorded in the EU. Devastated the Evros region near the Turkish border.",
    details: "Over 230,000 acres burned in the Evros fire alone. 20+ fatalities. Bodies of 18 migrants found in the Dadia forest. Combined Greek fires in 2023 burned more than the previous 5 years combined.",
  },
  {
    id: "chile-2024", name: "Chile Wildfires 2024",
    description: "Deadly fires in the Valparaiso region killed over 130 people, Chile's deadliest fire disaster.",
    details: "131 fatalities — Chile's deadliest wildfire disaster. Over 43,000 acres burned. 14,000+ homes destroyed. Fires swept through hillside communities in the Valparaiso and Vina del Mar regions. State of emergency declared.",
  },
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
