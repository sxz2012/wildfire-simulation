# Model Details Panel — Design

**Date:** 2026-05-06
**Branch:** version3
**Status:** Validated

## Goal

Surface the math + assumptions behind the fire spread, suppression, and inverse-search models, AND let users live-tune a small set of headline parameters during the demo. Audience: both demo viewers (plain-language overview) and analysts (math + sliders).

## Panel architecture

**Trigger.** Floating "📊 Model Details" button top-right of viewport, just below TimeInfoPanel. Visible at all appModes.

**Panel.** 360 px wide, full viewport height, slides in from the right edge over 250ms. Backdrop styled to match `fire-panel`. Close × top-right OR re-click trigger to dismiss.

**Tab strip:**
1. **Overview** — plain-language explanation of the three models. ~3 paragraphs each, no formulas.
2. **Parameters** — six adjustable sliders. Two sections: Resource Production (4) + Inverse Search (2).
3. **References** — citations + formulas (monospace pseudocode, no LaTeX in v1).

**State.** Single `ModelConfigContext` (React Context). Defaults match current hardcoded values. Session-only — no localStorage. Reset-all button always available.

**Effect propagation.** Sliders update Context → next user-initiated action (Compute, Approve, etc.) reads new values. No "Apply" button — algorithmic parameters don't take effect until next operation anyway.

## Six adjustable parameters

**Resource Production Rates** (chains/hr — defaults from NWCG):
- Type 1 Dozer: 75 (range 0..150)
- Type 1 Crew: 9 (range 0..18)
- Engine: 4 (range 0..8)
- Helitack swath: 8 chains (range 0..16)

**Inverse Search:**
- Breach tolerance: 2 % (range 0..10 %)
- Search ceiling: 2500 ch/hr (range 500..5000, step 100)

Each slider has a `(modified)` amber tag when non-default + per-slider reset. Below all sliders: "Reset all to defaults" button highlighted amber when any parameter is non-default.

Tooltips on each slider label explain in one line what the parameter does and the default's source.

## Overview tab content

Three sections, plain language:

**Fire Spread Model** — Rothermel base × ML refinement, 600×600 grid, 50 m cells, real terrain (Cesium World Terrain) + real vegetation (ESA WorldCover 10 m). Cells transition Unburned → Burning → Burned (or Suppressed).

**Suppression Model** — NWCG production rates × Hirsch-Martell delay decay. Reed-McCool containment probability from line-built / active-perimeter ratio. Each timestep picks N cells along the active perimeter, marks them Suppressed.

**Inverse Search** — bisection on chains/hr capacity. For each candidate, build cheapest mix (greedy by $/chain), run a 30-step sim, check breach < tolerance %. Output: smallest passing roster + realism-tier badge.

Each Overview section has a `[See parameters]` link that switches to Parameters tab.

## References tab content

Static, scrollable. Each entry: citation + formula in monospace + one-line context note.

- Rothermel (1972) — surface fire spread base rate
- Albini (1976) — fuel coefficients extension
- NWCG Standards — production rates table
- Hirsch & Martell (1996) — delay decay formula
- Reed & McCool (2000) — containment probability formula
- Bisection algorithm pseudocode
- Containment check pseudocode

External links list at bottom (rendered text, not clickable in v1).

## Architecture

### New components
- `src/contexts/ModelConfig.tsx` — Context + provider + hook (`useModelConfig`).
- `src/components/ModelDetailsPanel.tsx` — Three-tab slide-out panel (~300 LoC).
- `src/components/ModelDetailsButton.tsx` — Floating trigger button.

### Modified
- `src/services/simulationApi.ts` — `apiQBoundary` accepts optional `modelConfig` field in request body.
- `scripts/dev-server.ts` — `/api/q-boundary` reads `modelConfig` from request body, threads it through to `findMinRosterForBoundary`. **No global mutable state** to keep concurrent requests safe.
- `src/simulation/inverseSearch.ts` — `findMinRosterForBoundary` accepts optional `modelConfig` parameter; falls back to constants.
- `src/utils/cheapestRoster.ts` — `cheapestRosterForCapacity` accepts optional rate overrides; falls back to constants.
- `src/App.tsx` — wraps subtree in `<ModelConfigProvider>`, reads config in `handleBoundaryClose`/`handleApproveRoster`, posts with API calls.

### State flow
```
[Slider in Panel] → setConfig() → React Context →
  → next user click on Compute →
  → handleBoundaryClose() reads config →
  → apiQBoundary({..., modelConfig}) →
  → server uses these values for one bisection
```

## Testing

**Unit (vitest):**
- `ModelConfig.test.tsx` — provider exposes defaults; setters work; resetAll restores.
- `cheapestRoster.test.ts` extended — rate overrides change roster size correctly.
- `findMinRosterForBoundary.test.ts` extended — tolerance + ceiling overrides change behavior as expected.

**Manual smoke (8 steps):**
1. Click 📊 Model Details → panel slides in.
2. Drag dozer rate 75 → 150 → see (modified) tag.
3. Compute on previously-13-dozer polygon → verify ~6-7 dozers now.
4. Reset all → sliders return.
5. Switch to Overview tab; click "See parameters" link → tab switches.
6. Switch to References tab; all citations display.
7. Close panel.
8. Reload → defaults restored (no persistence).

## Out of scope (v1)

- localStorage persistence.
- Preset configurations.
- LaTeX math rendering.
- JSON config import/export.
- Auto-recompute on slider change.
- Side-by-side A/B comparison.

## Risks

| Risk | Mitigation |
|---|---|
| Server-side concurrency races on shared constants | Pass `modelConfig` through call stack as parameter; never mutate module globals |
| User confusion when a tweak doesn't visibly change the recommendation | Tooltips explain "applies to next Compute"; preview line below sliders shows "current settings → next Compute" |
| Slider extremes break the model (e.g. dozer rate 0) | Sliders allow 0; algorithms handle gracefully (fall through to crews); tested |

## Success criteria

1. Panel opens/closes via trigger button.
2. All six sliders work, show defaults, support reset.
3. Tweaking dozer rate visibly changes Compute recommendation on next click.
4. Overview reads cleanly to a non-expert.
5. References tab displays all citations and formulas.
6. No persistence (reload = defaults).
