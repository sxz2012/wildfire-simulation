import { FuelType, type SimulationConfig, DEFAULT_CONFIG } from "./simulation/types";

export interface Scenario {
  name: string;
  description: string;
  location: { lat: number; lng: number; altitude: number };
  config: SimulationConfig;
  igniteOffset: { row: number; col: number };
}

export const SCENARIOS: Scenario[] = [
  {
    name: "California Grassland",
    description:
      "Watch how fire spreads rapidly and uniformly across flat grassland with moderate westerly winds.",
    location: { lat: 36.7, lng: -119.5, altitude: 50000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Grass,
      windSpeed: 25,
      windDirection: 270,
      humidity: 20,
    },
    igniteOffset: { row: 100, col: 100 },
  },
  {
    name: "Rocky Mountain Forest",
    description:
      "Notice how fire accelerates dramatically as it moves uphill through dense forest.",
    location: { lat: 39.7, lng: -105.5, altitude: 50000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Forest,
      windSpeed: 10,
      windDirection: 180,
      humidity: 35,
    },
    igniteOffset: { row: 150, col: 100 },
  },
  {
    name: "Australian Bushland",
    description:
      "Strong northwesterly winds drive fire through dry shrubland at alarming speed.",
    location: { lat: -33.7, lng: 150.3, altitude: 50000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Shrub,
      windSpeed: 45,
      windDirection: 315,
      humidity: 15,
    },
    igniteOffset: { row: 120, col: 120 },
  },
  {
    name: "Mediterranean Hillside",
    description:
      "The strong mistral wind channels fire through coastal hills with mixed vegetation.",
    location: { lat: 43.3, lng: 5.4, altitude: 50000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Shrub,
      windSpeed: 40,
      windDirection: 340,
      humidity: 25,
    },
    igniteOffset: { row: 100, col: 80 },
  },
  {
    name: "Canyon Fire",
    description:
      "See how narrow canyon terrain funnels and accelerates fire spread.",
    location: { lat: 34.2, lng: -118.2, altitude: 30000 },
    config: {
      ...DEFAULT_CONFIG,
      defaultFuel: FuelType.Shrub,
      windSpeed: 20,
      windDirection: 180,
      humidity: 20,
    },
    igniteOffset: { row: 160, col: 100 },
  },
];
