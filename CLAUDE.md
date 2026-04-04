# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A 3D wildfire spread visualization web app that simulates how wildfires propagate across real terrain. Uses CesiumJS with Google Photorealistic 3D Tiles for the globe, and a simplified Rothermel-inspired fire spread model running in a Web Worker.

## Commands

- `npm run dev` — Start Vite dev server
- `npm run build` — TypeScript check + production build (`tsc -b && vite build`)
- `npm test` — Run all tests once (`vitest run`)
- `npm run test:watch` — Run tests in watch mode
- `npx vitest run src/simulation/__tests__/grid.test.ts` — Run a single test file

## Architecture

### Simulation Engine (`src/simulation/`)

Pure TypeScript, no React dependencies. Runs entirely in a Web Worker to keep the UI responsive.

- **types.ts** — Core types: `CellState` (enum: Unburned/Burning/Burned), `FuelType`, `GridCell`, `SimulationConfig`, `SimulationState`. Also `FUEL_PROPERTIES` lookup and `DEFAULT_CONFIG`.
- **grid.ts** — `createGrid()` builds a flat `GridCell[]` array mapped to lat/lng coordinates. `igniteCell()` sets a cell to burning. `getCell()` accessor.
- **spread.ts** — `simulateStep()` runs one timestep: burning cells spread to 8 neighbors based on `computeSpreadRate()` which combines slope, wind alignment, humidity, and fuel factors (simplified Rothermel: `R = R0 * (1 + phi_wind + phi_slope) * humidity_factor`). Returns a new grid (immutable).
- **runner.ts** — `runSimulation()` orchestrates the full loop: create grid, ignite cell, run steps, capture `Uint8Array` snapshots per timestep. Stops when no cells are burning or maxSteps reached.
- **worker.ts** — Web Worker entry point. Receives config via `postMessage`, runs simulation, sends back serialized history.
- **useSimulation.ts** — React hook wrapping the worker lifecycle. Returns `{ history, isRunning, startSimulation, reset }`.

### Components (`src/components/`)

- **GlobeView** — CesiumJS `<Viewer>` with Google 3D Tiles, world terrain, click-to-ignite handler, flyTo support, and children slot for FireParticles.
- **FireOverlay** — Canvas-based imagery layer approach: draws cell states as pixels on an offscreen canvas, projects as a `SingleTileImageryProvider` on the globe. Accepts `viewer` prop directly (imperative, not resium JSX).
- **FireParticles** — Billboard entities at fire-front cells (burning cells adjacent to unburned). Uses canvas-generated radial gradient as texture. Caps at 100 positions for performance.
- **ControlPanel** — Collapsible left sidebar. Two modes: "Click to Ignite" (parameter sliders) and "Scenarios" (dropdown + description). Props: `onStart`, `onStartScenario`, `onReset`.
- **TimelineBar** — Bottom bar with play/pause, range scrubber, speed selector (0.5x–5x), time display. Auto-hides when `totalSteps === 0`.
- **InfoTooltip** — Positioned tooltip showing cell state/elevation/fuel on hover.

### Data Flow

1. User picks mode (ignite/scenario) in ControlPanel
2. Ignite mode: adjust sliders, click globe -> `handleIgnite` starts simulation at clicked lat/lng
3. Scenario mode: pick preset -> `handleStartScenario` flies camera + starts simulation
4. Web Worker runs simulation, returns `history[]` of `SimulationState` snapshots
5. TimelineBar scrubs `currentStep` -> indexes into `history` -> FireOverlay/FireParticles render current state

### Key Design Decisions

- Grid state snapshots are `Uint8Array` (1 byte/cell) for compact memory (~20MB for 200x200 x 500 steps)
- FireOverlay uses canvas imagery layer instead of per-cell Entity (Entity approach doesn't scale past ~50x50)
- Simulation is immutable: `simulateStep()` returns a new grid, never mutates input
- Scenarios include `igniteOffset` (grid row/col) to place ignition at meaningful terrain positions

## Environment Setup

Copy `.env.example` to `.env` and fill in:
- `VITE_CESIUM_ION_TOKEN` — Cesium Ion access token (for terrain)
- `VITE_GOOGLE_MAPS_API_KEY` — Google Maps API key (for 3D Tiles, optional — falls back to Ion-based tiles)
