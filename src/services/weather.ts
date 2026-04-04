export interface WeatherData {
  windSpeed: number; // km/h
  windDirection: number; // degrees
  humidity: number; // %
  temperature: number; // Celsius
  source: string; // "live" | "seasonal"
}

/**
 * Fetch current live weather for a location from Open-Meteo API.
 * Free, no API key needed.
 */
export async function fetchCurrentWeather(lat: number, lng: number): Promise<WeatherData> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);

  const data = await res.json();
  const current = data.current;

  return {
    windSpeed: Math.round(current.wind_speed_10m),
    windDirection: Math.round(current.wind_direction_10m),
    humidity: Math.round(current.relative_humidity_2m),
    temperature: Math.round(current.temperature_2m),
    source: "live",
  };
}

/**
 * Seasonal weather presets based on climate zones.
 * Derived from typical conditions that create fire risk.
 */
export type Season = "spring" | "summer" | "autumn" | "winter";

export function getSeasonalWeather(lat: number, season: Season): WeatherData {
  const isNorthern = lat >= 0;

  // Adjust season for southern hemisphere
  const effectiveSeason = isNorthern
    ? season
    : season === "summer" ? "winter"
    : season === "winter" ? "summer"
    : season === "spring" ? "autumn"
    : "spring";

  // Base conditions by season
  const seasonData: Record<string, WeatherData> = {
    spring: { windSpeed: 25, windDirection: 270, humidity: 35, temperature: 22, source: "seasonal" },
    summer: { windSpeed: 15, windDirection: 270, humidity: 15, temperature: 35, source: "seasonal" },
    autumn: { windSpeed: 40, windDirection: 45, humidity: 10, temperature: 28, source: "seasonal" },
    winter: { windSpeed: 20, windDirection: 180, humidity: 55, temperature: 10, source: "seasonal" },
  };

  const base = { ...seasonData[effectiveSeason] };

  // Tropical regions — higher humidity, less wind variation
  if (Math.abs(lat) < 23.5) {
    base.humidity = Math.max(base.humidity, 40);
    base.temperature += 8;
  }
  // Mediterranean (30-45°) — dry summers, strong autumn winds
  else if (Math.abs(lat) >= 30 && Math.abs(lat) <= 45) {
    if (effectiveSeason === "summer") base.humidity = Math.max(5, base.humidity - 10);
    if (effectiveSeason === "autumn") base.windSpeed = Math.min(55, base.windSpeed + 15);
  }
  // Continental (45-60°) — extreme seasons
  else if (Math.abs(lat) > 45) {
    if (effectiveSeason === "summer") base.temperature -= 5;
    if (effectiveSeason === "winter") base.humidity += 20;
  }

  return base;
}

export const SEASONS: { value: Season; label: string }[] = [
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer (Fire Season)" },
  { value: "autumn", label: "Autumn (Santa Ana / Foehn)" },
  { value: "winter", label: "Winter" },
];
