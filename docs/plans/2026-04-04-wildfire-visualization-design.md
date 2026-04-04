# Wildfire Spread 3D Visualization — Design

## Purpose

A web application that visualizes how wildfires spread over time on a photorealistic 3D globe. Serves two purposes:

1. **Educational simulator** — Users tweak parameters (wind, terrain, vegetation) and watch fire evolve
2. **Predictive tool** — Simulate fire spread from an ignition point on real terrain

## Stack

- **Frontend framework:** React + TypeScript (Vite)
- **3D globe:** CesiumJS with `resium` (React bindings)
- **3D tiles:** Google Photorealistic 3D Tiles via Cesium
- **Fire simulation:** Client-side TypeScript engine in a Web Worker
- **Styling:** Tailwind CSS

## Architecture

### Components

- **Globe View** — CesiumJS viewer rendering Google 3D Tiles with fire overlay entities
- **Simulation Engine** — Web Worker running grid-based fire spread model, emits state snapshots per timestep
- **Control Panel** — Left sidebar with parameter sliders, ignition mode, scenario picker
- **Timeline Bar** — Bottom scrubber with play/pause/speed and jump-to-timestep
- **Particle Renderer** — Cesium particle system for flames/embers at active fire front

## Simulation Engine

### Grid Model

- 2D grid (200x200 cells) centered on ignition point
- Each cell maps to real-world lat/lng, samples terrain elevation from Cesium terrain provider
- Cell size configurable (default ~50m per cell, ~10km x 10km area)

### Cell States

- `unburned` — fuel available, not yet ignited
- `burning` — actively on fire (burns for N timesteps based on fuel type)
- `burned` — fuel exhausted

### Spread Calculation (per timestep)

Each `burning` cell attempts to spread to 8 neighbors. Spread probability influenced by:

- **Slope** — fire spreads faster uphill (elevation difference between cells)
- **Wind** — increases spread in wind direction, decreases against it
- **Fuel type** — grass catches fast/burns out quickly; forest catches slower/burns longer

Weighted spread rate loosely follows Rothermel: `R = R0 * (1 + phi_wind + phi_slope)`

### State History

- Grid snapshot saved after each timestep to an array
- Timeline scrubber indexes into this array
- Estimated memory: 200x200 x 500 timesteps x 1 byte/cell ~ 20MB

## UI Layout

### Full-screen Layout

- Full-screen CesiumJS globe (main view)
- Collapsible left sidebar (control panel)
- Bottom bar (timeline scrubber)
- Floating info tooltip on hover (cell state, elevation, fuel type)

### Control Panel (left sidebar)

- **Mode toggle:** "Click to Ignite" vs "Pick a Scenario"
- **Scenario dropdown:** 5 pre-built scenarios
- **Parameter sliders:**
  - Wind speed (0-60 km/h)
  - Wind direction (compass dial or 0-360 slider)
  - Humidity (0-100%)
  - Vegetation type (grass / shrub / forest)
- **Start / Reset buttons**

### Timeline Bar (bottom)

- Horizontal scrubber spanning full width
- Current timestep label (e.g., "T+2h 30m")
- Play / Pause button
- Speed selector (0.5x, 1x, 2x, 5x)
- Click or drag to jump to any timestep

### Fire Visuals

- **Burning cells:** Red-orange semi-transparent polygons on terrain + particle embers
- **Burned cells:** Dark grey/black overlay, fading opacity
- **Unburned cells:** No overlay (Google 3D tile imagery shows through)

## Pre-built Scenarios

| Scenario | Location | Terrain | Fuel | Wind | Key Lesson |
|---|---|---|---|---|---|
| California Grassland | Central Valley, CA | Flat | Grass | Moderate westerly | Fast uniform spread in open terrain |
| Rocky Mountain Forest | Colorado Rockies | Steep slopes | Forest | Light variable | Uphill spread acceleration |
| Australian Bushland | Blue Mountains, NSW | Rolling hills | Shrub/eucalyptus | Strong NW | Wind-driven spread through dry fuel |
| Mediterranean Hillside | Southern France | Coastal hills | Mixed shrub/forest | Strong mistral | Canyon channeling effect |
| Canyon Fire | Angeles National Forest, CA | Narrow canyon | Chaparral | Moderate upcanyon | Terrain funneling fire through canyons |

Each scenario includes a description panel explaining what to watch for.
