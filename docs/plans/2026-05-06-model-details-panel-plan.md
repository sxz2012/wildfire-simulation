# Model Details Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development for same-session) to implement this plan task-by-task.

**Goal:** Slide-out right-edge "Model Details" panel with three tabs (Overview / Parameters / References). Six sliders let the user live-tune resource production rates + inverse-search parameters. Changes take effect on the next Compute / Approve via a React Context propagated through the API call.

**Architecture:** New `ModelConfigContext` carries six adjustable parameters in session state. `cheapestRosterForCapacity` and `findMinRosterForBoundary` accept optional override params. The dev-server endpoint `/api/q-boundary` accepts a `modelConfig` field in the request body and threads it through to the inverse search. No global mutable state.

**Tech Stack:** TypeScript, React (Context API), Tailwind CSS, Vitest.

---

## Pre-task: confirm clean baseline

Run `npm test && npm run build`. Both must pass. Fix anything broken on `version3` before starting Task 1.

---

## Task 1: `ModelConfig` Context + hook (TDD)

**Files:**
- Create: `src/contexts/ModelConfig.tsx`
- Test: `src/contexts/__tests__/ModelConfig.test.tsx`

**Public API:**
```typescript
export interface ModelConfig {
  dozerChainsHr: number;        // default 75
  crewChainsHr: number;         // default 9
  engineChainsHr: number;       // default 4
  helitackSwathChains: number;  // default 8
  breachTolerancePct: number;   // default 2  (percent units)
  searchCeilingChainsHr: number; // default 2500
  resumeWindowSteps: number;     // default 30
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = { ... };

export function ModelConfigProvider({ children }: { children: React.ReactNode }): JSX.Element;

export function useModelConfig(): {
  config: ModelConfig;
  setConfig: (partial: Partial<ModelConfig>) => void;
  resetAll: () => void;
  isModified: boolean;        // true if any field differs from default
};
```

**Step 1: Write failing tests** (vitest + @testing-library/react):
- Provider exposes default config when no overrides.
- `setConfig({ dozerChainsHr: 150 })` updates only that field; other fields unchanged.
- After multiple `setConfig` calls, all changes persist.
- `resetAll()` restores all fields to `DEFAULT_MODEL_CONFIG`.
- `isModified` is `false` initially, `true` after any change, `false` again after `resetAll`.
- Hook called outside provider throws (or returns defaults — pick one and test).

**Step 2: Run vitest — expect fail.**

**Step 3: Implement.** Use `useState<ModelConfig>(DEFAULT_MODEL_CONFIG)`. `setConfig` does `setState(prev => ({ ...prev, ...partial }))`. `isModified` computed via shallow comparison with defaults. `useModelConfig` reads from context, throws if no provider.

**Step 4: Re-run vitest — expect pass.**

**Step 5: Run `npx tsc -b` — confirm clean.**

**Step 6: Commit:** `feat: ModelConfig context with six adjustable parameters`.

---

## Task 2: `cheapestRosterForCapacity` accepts rate overrides (TDD)

**Files:**
- Modify: `src/utils/cheapestRoster.ts`
- Modify: `src/utils/__tests__/cheapestRoster.test.ts`

**Public API change:**
```typescript
export interface RosterRateOverrides {
  dozerChainsHr?: number;
  crewChainsHr?: number;
  helitackThresholdChainsHr?: number;
  tankerThresholdChainsHr?: number;
}

export function cheapestRosterForCapacity(
  targetChainsHr: number,
  overrides?: RosterRateOverrides,
): ResourceCount[];
```

**Step 1: Add tests** (existing 6 stay):
- With `dozerChainsHr=150`, target=1500 returns 10 dozers (1500/150) instead of 20 (1500/75).
- With `crewChainsHr=18`, target with remainder needs HALF the crews (since each crew is 2x more productive).
- With `dozerChainsHr=0` (degenerate), all capacity comes from crews (`ceil(target/9)`).
- No-overrides call still produces existing behavior (regression).

**Step 2: Run vitest — expect fail (existing pass, new fail).**

**Step 3: Implement.** Function signature gains optional `overrides`. Inside, `dozerRate = overrides?.dozerChainsHr ?? DOZER_RATE` etc. Greedy logic unchanged.

**Step 4: Re-run vitest — all pass.**

**Step 5: Commit:** `feat: cheapestRosterForCapacity accepts rate overrides`.

---

## Task 3: `findMinRosterForBoundary` accepts `modelConfig` (TDD)

**Files:**
- Modify: `src/simulation/inverseSearch.ts`
- Modify: `src/simulation/__tests__/findMinRosterForBoundary.test.ts`

**Public API change:**
```typescript
export interface BoundarySearchOverrides {
  breachTolerancePct?: number;       // 0..100, default 2
  searchCeilingChainsHr?: number;    // default 2500
  rosterOverrides?: RosterRateOverrides;
}

export interface FindMinRosterForBoundaryInput {
  // ... existing fields
  modelConfig?: BoundarySearchOverrides;
}
```

**Behavior:**
- `breachTolerancePct` is in percent units (0..100), divide by 100 to get fraction.
- `searchCeilingChainsHr` overrides `Q_BOUNDARY_HI` (which becomes the default).
- `rosterOverrides` passed through to every `cheapestRosterForCapacity` call.

**Step 1: Add tests** (existing 4 stay):
- With `breachTolerancePct=10`, a candidate that previously failed at 5% breach now passes.
- With `searchCeilingChainsHr=500`, a fire that needs 1000+ ch/hr returns `recommendedRoster: null`.
- With `rosterOverrides.dozerChainsHr=150`, recommended roster has fewer dozers for the same fire.
- No-overrides call still produces existing behavior.

**Step 2: Run vitest — expect failures.**

**Step 3: Implement.** Replace hardcoded `BREACH_TOLERANCE` reads with `(input.modelConfig?.breachTolerancePct ?? 2) / 100`. Replace `Q_BOUNDARY_HI` with `input.modelConfig?.searchCeilingChainsHr ?? Q_BOUNDARY_HI`. Pass `rosterOverrides` through to all `cheapestRosterForCapacity` calls.

**Step 4: Re-run vitest — all pass.**

**Step 5: Commit:** `feat: findMinRosterForBoundary accepts modelConfig overrides`.

---

## Task 4: API server `/api/q-boundary` reads `modelConfig`

**Files:**
- Modify: `scripts/dev-server.ts`

**Behavior:**
- POST body gains optional `modelConfig: BoundarySearchOverrides`.
- Handler passes it through to `findMinRosterForBoundary({ ..., modelConfig: body.modelConfig })`.
- **Critical:** No mutation of module-scoped constants. Pass by argument only so concurrent requests are independent.

**Step 1:** Update the request type:
```typescript
interface QBoundaryRequest {
  // ... existing fields
  modelConfig?: BoundarySearchOverrides;
}
```

**Step 2:** Pass through inside the handler:
```typescript
const result = await findMinRosterForBoundary({
  // ... existing
  modelConfig: body.modelConfig,
});
```

**Step 3:** Manual smoke (curl): post a request with `modelConfig: { breachTolerancePct: 10 }`, verify response `bisectionTrace` shows different breach decisions than default.

**Step 4: `npx tsc -b` clean.**

**Step 5: Commit:** `feat: /api/q-boundary accepts modelConfig in request body`.

---

## Task 5: `simulationApi.apiQBoundary` posts `modelConfig`

**Files:**
- Modify: `src/services/simulationApi.ts`

**Public API change:**
```typescript
export interface ApiQBoundaryRequest {
  // ... existing
  modelConfig?: BoundarySearchOverrides;
}
```

**Behavior:** Pass `modelConfig` through to `postJson` body. No other change.

**Step 1: Add the field to `ApiQBoundaryRequest` interface.**
**Step 2: Update `apiQBoundary` to spread the new field into the POST body.**
**Step 3: `npx tsc -b` clean. `npm test` still passes.**
**Step 4: Commit:** `feat: apiQBoundary posts modelConfig`.

---

## Task 6: `ModelDetailsPanel` component

**Files:**
- Create: `src/components/ModelDetailsPanel.tsx`

**Public API:**
```typescript
interface ModelDetailsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ModelDetailsPanel(props: ModelDetailsPanelProps): JSX.Element;
```

**Layout:**
- Fixed position right-edge slide-out: `right: -360px` when closed, `right: 0` when open. Transition 250ms ease-out.
- 360px wide, full viewport height.
- Inner: top header with close × button + tab strip (3 tabs) + scrollable content.

**Three tabs (managed by local `useState<"overview" | "params" | "references">`):**

### Overview tab
Three sections (Fire Spread / Suppression / Inverse Search), ~3 paragraphs each. Plain language. Each section has a `[See parameters]` link that calls `setActiveTab("params")` and scrolls to the relevant section.

Use the exact copy from the design doc Section 3.

### Parameters tab
Six sliders + a "Reset all" button. Use `useModelConfig` hook from Task 1.

Each slider:
```tsx
<div>
  <div className="flex items-baseline justify-between">
    <label>Type 1 Dozer <Tooltip>...</Tooltip></label>
    <div>
      <span className="tabular-nums">{config.dozerChainsHr} ch/hr</span>
      {config.dozerChainsHr !== DEFAULT.dozerChainsHr && (
        <span className="text-amber-400 text-micro ml-1">(modified)</span>
      )}
      <button onClick={() => setConfig({ dozerChainsHr: DEFAULT.dozerChainsHr })}>↺</button>
    </div>
  </div>
  <input type="range" min={0} max={150} value={config.dozerChainsHr}
         onChange={e => setConfig({ dozerChainsHr: parseInt(e.target.value, 10) })} />
</div>
```

Sections:
- "Resource Production": dozer (0-150), crew (0-18), engine (0-8), helitack swath (0-16)
- "Inverse Search": breachTolerancePct (0-10, step 1), searchCeilingChainsHr (500-5000, step 100)

Reset all button at bottom calls `resetAll()`. Highlighted amber when `isModified`.

Below sliders: a small preview line showing current settings summary.

### References tab
Static content from design Section 4: Rothermel / Albini / NWCG / Hirsch-Martell / Reed-McCool / bisection / containment-check, each with citation + monospace pseudocode + one-line context.

**Tooltips:** Use a simple `title` attribute on labels for v1. (Don't build a tooltip component.)

**Style:** Match `fire-panel` styling. Tabs in `JetBrains Mono`. Body in `DM Sans`.

**Step 1: Implement the panel.** ~300-400 LoC.

**Step 2: `npx tsc -b` clean. `npm test` still passes.**

**Step 3: Commit:** `feat: ModelDetailsPanel with Overview/Parameters/References tabs`.

---

## Task 7: `ModelDetailsButton` trigger

**Files:**
- Create: `src/components/ModelDetailsButton.tsx`

**Public API:**
```typescript
interface ModelDetailsButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

export default function ModelDetailsButton(props: ModelDetailsButtonProps): JSX.Element;
```

**Layout:** Floating button. Position: top-right, just below the existing TimeInfoPanel. `position: absolute; top: 200px; right: 12px`. Show "📊 Model Details" or just "📊" when open. Active state when `isOpen`.

**Step 1: Implement. ~30 LoC.**
**Step 2: `npx tsc -b` clean.**
**Step 3: Commit:** `feat: ModelDetailsButton trigger`.

---

## Task 8: Wire panel + button into App.tsx

**Files:**
- Modify: `src/App.tsx`

**Changes:**

1. **Wrap subtree in provider.** At the top of the App's return JSX, wrap everything in `<ModelConfigProvider>`. To do this, the App component needs to either be wrapped externally (in `main.tsx`) or refactor App into a wrapper + inner. Easiest: wrap in main.tsx.

   In `src/main.tsx`:
   ```tsx
   import { ModelConfigProvider } from "./contexts/ModelConfig";
   <ModelConfigProvider><App /></ModelConfigProvider>
   ```

2. **Add panel + button** to App's JSX:
   ```tsx
   const [modelPanelOpen, setModelPanelOpen] = useState(false);
   // ...
   <ModelDetailsButton isOpen={modelPanelOpen} onClick={() => setModelPanelOpen(v => !v)} />
   <ModelDetailsPanel isOpen={modelPanelOpen} onClose={() => setModelPanelOpen(false)} />
   ```

3. **Read config in handlers** that call `apiQBoundary`:
   ```typescript
   const { config } = useModelConfig();
   // In handleBoundaryClose:
   const result = await apiQBoundary({
     // ... existing
     modelConfig: {
       breachTolerancePct: config.breachTolerancePct,
       searchCeilingChainsHr: config.searchCeilingChainsHr,
       rosterOverrides: {
         dozerChainsHr: config.dozerChainsHr,
         crewChainsHr: config.crewChainsHr,
         helitackThresholdChainsHr: 50,  // not exposed
         tankerThresholdChainsHr: 200,
       },
     },
   });
   ```

4. **Read resumeWindowSteps in `handleApproveRoster`:**
   ```typescript
   const remainingSteps = config.resumeWindowSteps;
   ```

**Step 1: Make the changes.**
**Step 2: `npx tsc -b` clean. `npm test` still passes.**
**Step 3: Commit:** `feat: wire ModelConfigProvider + ModelDetailsPanel into App`.

---

## Task 9: Final smoke + acceptance

Walk through the 8-step manual smoke from the design:

1. Click 📊 Model Details — panel slides in from right.
2. Switch to Parameters tab. Drag dozer rate 75 → 150. (modified) tag shows; Reset-all amber.
3. Click Compute on a previously-13-dozer polygon. Verify recommended roster has ~6-7 dozers.
4. Click Reset all. Sliders return; tags clear.
5. Switch to Overview tab. Read all three sections. Click "See parameters" link → switches to Parameters tab.
6. Switch to References tab. Verify all citations + formulas display.
7. Close panel via × OR re-click trigger. Slides out.
8. Hard reload page. All parameters back to defaults.

**Step 1: Walk through manually.**
**Step 2: Commit any post-smoke fixes:** `fix: post-smoke adjustments to model details panel`.

---

## After all tasks

1. `npm test` — all green.
2. `npm run build` — no TS / lint errors.
3. Use `superpowers:finishing-a-development-branch` to wrap up.

## Remember
- DRY, YAGNI, TDD where applicable.
- All adjustable parameters default to existing hardcoded values (no behavior change without explicit user tweak).
- No global mutable state on the server side — `modelConfig` flows through as a parameter only.
- No localStorage; reload restores defaults.
