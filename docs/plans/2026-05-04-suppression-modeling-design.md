# Wildfire Suppression Modeling — Design

**Date:** 2026-05-04
**Branch:** version3
**Status:** Draft (post-brainstorm)

## Goal

Add a fire-department / suppression-effort dimension to the simulation so the user can ask **"what if?"**:

- *How does response time change the outcome?*
- *What resource mix would have contained this fire?*
- *How many hectares — and dollars — could have been saved?*

The user picks a **response delay** and a **resource bundle**; the simulation runs the spread twice (with and without suppression) and shows the difference both spatially on the map and quantitatively in the panel.

## Why this is worth building

The current sim answers *"how does the fire spread?"*. It can't answer *"how do we stop it?"* — which is the question every emergency manager actually asks. Adding suppression turns the tool from a passive visualization into a real decision-support sandbox: it lets a user feel the cost of a 30-minute response delay or compare an Initial Attack against a Type-1 mobilization on a specific terrain.

## Existing science we're standing on

| Source | What we use |
|---|---|
| **NWCG Fireline Production Rates** handbook | Per-resource line-construction rates (chains/hr) for handcrews, engines, dozers, helitack, air tankers |
| **Reed–McCool (2000)** | Containment probability formula `P(contained) = f(perimeter, ROS, total production rate)` |
| **Hirsch–Martell (1996)** | Initial-attack effectiveness vs response-delay decay curve |
| **Plucinski (2019)** review | Empirical containment rates by fire size class |
| **Cell2Fire** (open source) | Cell-based "fireline as firebreak" implementation pattern |

We are *not* building a new fire-suppression model. We're translating these established equations into our cell grid.

## User interaction

Add a **Suppression Response** section to the simulate-mode panel, between Weather Source and Start:

```
┌─ SUPPRESSION RESPONSE ──────────────────┐
│                                         │
│ Response delay:  [▸━━━━━━━━━━━] 30 min  │
│                                         │
│ Resource bundle:                        │
│  ▼ Initial Attack                       │
│     None                                │
│     Initial Attack (1 crew, 1 engine,   │
│         1 helitack)                     │
│     Type 3 (3 crews + 2 engines +       │
│         2 helitack)                     │
│     Type 2 (5 crews + 3 dozers +        │
│         2 helitack + 1 air tanker)      │
│     Type 1 (10 crews + 5 dozers +       │
│         3 helitack + 2 air tankers)     │
│     Custom...                           │
│                                         │
│ Estimated production: 12 chains/hr      │
│                       (240 m/hr)        │
│                                         │
└─────────────────────────────────────────┘
```

Choosing the bundle updates the live "Estimated production" readout so the user sees that adding a dozer is order-of-magnitude bigger than adding another crew. **Custom** opens a small modal with one row per resource type and a count.

`Start the Wildfire` then runs **both passes**: the unsuppressed baseline and the suppressed run.

## The suppression model

### Inputs per resource type (constants)

```typescript
const RESOURCE_RATES = {
  Type1Crew:    { chainsPerHour: 9,   costPerHour: 4_500 },  // hotshots
  Type2Crew:    { chainsPerHour: 6,   costPerHour: 3_000 },
  Engine:       { chainsPerHour: 4,   costPerHour: 2_500 },
  Type1Dozer:   { chainsPerHour: 75,  costPerHour: 5_000 },
  Helitack:     { chainsPerHour: 0,   rosReductionFactor: 0.4, swathChains: 8, costPerHour: 15_000 },
  AirTanker:    { chainsPerHour: 0,   retardantLineChains: 50, dropsPerHour: 2, costPerHour: 35_000 },
};
```

### Per-step computation

Every simulation step (15 min wall-clock = 0.25 hr), if `currentTime >= responseDelay`:

1. Sum total line production = `Σ (count × chainsPerHour × 0.25)` chains across active resources.
2. Convert to **cells**: `lineCells = lineLength_m / cellSizeMeters`.
3. Pick those cells from the **active fire perimeter**, prioritizing the *head* of the fire (cells with the largest spread velocity / most downwind alignment). Mark them as `Suppressed` (a new `CellState`).
4. **Aerial drops** apply `rosReductionFactor` to a randomly placed swath at the head of the fire — emulates a tactical drop.
5. **Containment probability** at time `t`:

   ```
   P(contained) = 1 - exp(-cumulativeLineLaid / activePerimeter)
   ```

   where `activePerimeter` is the total length of the active fire edge in meters. This is the simplified Reed–McCool form.

### Cell state additions

Today: `Unburned | Burning | Burned`.
Add: `Suppressed` — fire can never ignite this cell, and if it was burning, it transitions to `Burned` (extinguished). For visualization purposes we keep a separate flag so we can render firelines distinctly from naturally burned cells.

### Hirsch–Martell delay curve

```
suppressionEffectiveness = exp(-responseDelayMinutes / characteristicTime)
```

Where `characteristicTime = 90 min` (the empirical "halving time" for IA effectiveness). Multiplied into the production rate so a 90-minute delay roughly halves how productive the resources are when they finally get on scene — accounts for the fire being larger and harder to attack by then.

## Architecture / data flow

The simulation worker already takes a config + fuel/elevation maps and returns history. Two changes:

1. **Worker accepts a suppression config** — `{ responseDelayMin, resources: { type, count }[] }`.
2. **Worker returns two histories** — `{ baseline, suppressed }` — same shape as today's `history`, with the suppressed one also carrying per-step suppression diagnostics (`linelaidChains`, `containmentProb`, `activeResources`).

The two passes share the same fuel/elevation/weather/grid, only the spread loop differs. Memory cost: 2× the existing `~180 MB peak` worst case → ~360 MB. Acceptable.

In the existing module structure:

```
src/simulation/
  spread.ts            // unchanged spread logic; gains a check for cell.suppressed
  suppression.ts       // NEW — state machine for resources, line placement, containment math
  runner.ts            // run two histories: with and without suppression config
  worker.ts            // post both histories back
  types.ts             // CellState gains 'Suppressed'; SuppressionConfig added
  useSimulation.ts     // history becomes { baseline, suppressed }
```

`spread.ts` change is small: at the top of the per-cell loop, skip cells where `cell.suppressed === true`.

## Visualization plan in the existing app

### Map (Cesium) — three new layers added to `App.tsx`

1. **`FirelineOverlay`** — like `WaterOverlay`, a per-step canvas drawn as a `SingleTileImageryProvider`. Cells with `Suppressed = true` painted as a thick dark-amber stripe (#7c2d12). Updates each frame as the suppressed run progresses.
2. **`GhostFireOverlay`** — translucent red tint (~25% alpha) over cells that *would have burned* in the baseline run but didn't in the suppressed run. Lets the user *see* the area saved without needing two side-by-side maps.
3. **`SuppressionUnitMarkers`** — small chevron / helicopter / dozer / engine billboards at active resources' staging positions, animated by step. Resources stage near the click and march along the perimeter as line-laying progresses. Visual feedback for "the cavalry has arrived".

### `Legend` component additions

| Icon | Meaning |
|---|---|
| 🔥 (existing) | Burning cells |
| 🟥 (existing) | Recently burned |
| ⬛ NEW | Suppressed cell (fireline) |
| 🟥 25% NEW | Would have burned (ghost / counterfactual) |
| 🚒 / 🚁 / 🪓 NEW | Active resources |

### `ImpactSection` (left panel) additions

Within the existing `Environmental Impact` block, add a new sub-section above Emissions:

```
─── CONTAINMENT ────────────────────────────────
P(contained):           73%
Cumulative line laid:   2.4 km
Active resources:       1 crew, 1 engine, 1 helitack
Saved vs baseline:      7,200 ha (-86%)
Suppression cost:       $2.4M (12 hr operation)
```

The "Saved vs baseline" row is the headline what-if number. Tappable, opens a new `SuppressionDetailModal` with the same dual-pass deltas plus a small chart of cumulative area-over-time (two lines: with vs without).

### `TimelineBar` extension

Add a thin secondary track above the main timeline showing **cumulative area burned** as two color-coded mini-areas: amber for baseline, red-orange for suppressed. The visual gap between them at any timestep equals "saved so far".

### `TimeInfoPanel` (top-right) addition

A small bottom row:

```
RESOURCES
↳ +0:30  Crews on scene
↳ +0:45  First helitack drop
↳ +2:15  Containment ≥ 50%
```

Three latest events, scrolling. Helps the user feel time in operational terms.

### Reuse the dual-pass comparison

The existing `EmissionsDetailModal` pattern works perfectly for a `SuppressionDetailModal`: same backdrop blur, same card layout. Inside, four cards:

- **Containment over time** — line chart, P(contained) vs hour
- **Cumulative line built** — bar chart, by resource
- **Area: with vs without** — two lines on one chart
- **Cost vs damage avoided** — single number with calc breakdown

## Output metrics (the "what-if" answers)

| Metric | Source |
|---|---|
| Final containment % | Reed–McCool integrated over sim duration |
| Time to 50% / 90% containment | First step where P crosses thresholds |
| Hectares burned (suppressed) | Standard area calc on suppressed history |
| Hectares saved | `baselineHa - suppressedHa` |
| Suppression cost | `Σ resource × hours × $rate` |
| Cost per hectare saved | Cost ÷ hectares saved (efficiency) |
| Estimated suppressed-run emissions | Existing emissions formula on suppressed history |
| Avoided emissions | Baseline emissions − suppressed emissions |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Two-pass simulation doubles compute | The worker is already fast (~5–10s); 10–20s is acceptable. Show a progress indicator. |
| Suppression state diverges from real ops | Be explicit in the modal: this is a **simplified educational model** based on published rates. Cite NWCG/Reed–McCool. |
| Memory ~360 MB peak | Already noted; acceptable on modern browsers. If it becomes a problem, downsample baseline snapshots (every 4th step). |
| Ghost overlay clutter | Cap ghost alpha at 25%; draw only cells where baseline burned AND suppressed didn't. |
| Resource staging UX is fake (we don't really model them moving) | Treat them as schematic icons clearly, not literal vehicle locations. The modal is honest about the abstraction. |

## Success criteria

The feature ships when **all** of:

1. Picking "Initial Attack at +30 min" vs "Type 1 at +30 min" produces meaningfully different final-area numbers on the same fire.
2. Increasing response delay from 30 → 120 min visibly worsens both area-saved and final containment %.
3. Map visualization clearly shows the difference between actually-burned and would-have-burned cells.
4. P(contained) curve is monotonically increasing and plausibly shaped (S-curve).
5. End-to-end run on the Bay Area scenario takes < 25 s on a modern laptop.

## Out of scope

- Spatially-aware resource placement (user clicking to position units on map)
- Crew fatigue, supply chain, real terrain access constraints
- Wind shifts, mid-fire weather changes during suppression
- Optimization ("what's the cheapest bundle to contain this fire by hour 6?")
- Real-time intervention (pause sim, drop a unit, resume)
- Non-US suppression doctrines (CFFDRS / Australian models)

These are reasonable Phase-2 candidates after the core scenario-comparison feature lands.

## Phase 2 ideas (future)

1. **Optimization mode** — fix a containment goal, search the cheapest bundle that hits it.
2. **Map-clickable resource staging** — drop crews on specific points; their effectiveness depends on access (road density, slope from terrain map we already have).
3. **Real-time pause-and-intervene** — slider to scrub mid-sim, change resource mix, replay forward.
4. **Bringing in real CAL FIRE / NWS data** — pre-fill the response-delay slider with the historical median for that county.

## Resolved decisions

| Decision | Resolution |
|---|---|
| Default resource bundle | **Initial Attack** — every real fire gets some response, so this is the realistic baseline. The user can flip to "None" to see the no-suppression case. |
| Ghost overlay (counterfactual area) | **On by default.** A checkbox in `Legend` lets the user toggle it off if it feels visually noisy on a given scene. |
| Custom-bundle resource types | **All 6 exposed** — Type 1 Crew, Type 2 Crew, Engine, Type 1 Dozer, Helitack, Air Tanker. No "simplified" mode. Each row shows its NWCG production rate inline so the user understands what they're choosing. |
