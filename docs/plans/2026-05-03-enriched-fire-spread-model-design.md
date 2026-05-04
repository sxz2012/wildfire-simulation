# Enriched Fire-Spread Model — Design

**Date:** 2026-05-03
**Status:** Draft, validated through brainstorm
**Replaces:** `src/data/xgboost_model.json` (existing 18-feature model)

## Goal

Train a higher-quality fire-spread classifier on the **enriched 251K-row dataset** and deploy it to the in-browser simulation runtime, replacing the current 18-feature XGBoost model. Every input feature must be producible at inference time inside the Web Worker (`spread.ts`).

## Why

The existing model has two structural problems:

1. **Training/inference distribution mismatch.** It uses three satellite-only features — `frp_mw`, `brightness_k`, `confidence` — that the runtime fakes with constants (`15`, `300`, `50`). The model was trained on real satellite signal but is queried with constants, so those features contribute pure noise at inference.
2. **Leaves signal on the table.** The enrichment work added terrain (`elevation_m`), land-cover composition (`pct_forest/shrub/grass/urban`), and runtime-computable fire-day aggregates (`curr_area_km2`, extents, hotspot count). These were never available before.

The new model drops the satellite features (good — removes the mismatch) and adds 12 features that *are* runtime-producible.

## Target

`fire_spreads_5km` — binary, "will fire reach a 5 km radius within the observation window".

- 880K full / 251K balanced; we use balanced (`training_data_balanced.csv` → enriched).
- Class ratio in enriched data: **228,288 positive : 23,141 negative (~9:1)**.
- Loss: binary logistic. Imbalance handled via `scale_pos_weight = neg/pos ≈ 0.10` (the asymmetry favors recall on the **negative** class — "fire stops here" — which is the rarer event).

## Feature set (27 features, all runtime-producible)

| # | Feature | Type | Source at inference time |
|---|---|---|---|
| 1 | `hours_since_start` | float | `stepNumber * timestepMinutes / 60` |
| 2 | `latitude` | float | `cell.lat` |
| 3 | `longitude` | float | `cell.lng` |
| 4 | `is_daytime` | int (0/1) | derive from `hours_since_start` mod 24 |
| 5 | `fuel_type_enc` | int | `encodeFuelType(cell.fuel)` |
| 6 | `temp_mean_c` | float | `config.tempMean` |
| 7 | `temp_max_c` | float | `config.tempMax` |
| 8 | `humidity_pct` | float | `config.humidity` |
| 9 | `wind_speed_kmh` | float | `config.windSpeed` |
| 10 | `wind_direction_deg` | float | `config.windDirection` |
| 11 | `precipitation_mm` | float | `config.precipitation` |
| 12 | `cumulative_precip_mm` | float | `config.cumulativePrecip` |
| 13 | `neighbors_1km` | int | `countBurningNeighbors(grid, r, c, 2)` |
| 14 | `neighbors_5km` | int | `countBurningNeighbors(grid, r, c, 5)` |
| 15 | `neighbors_10km` | int | `countBurningNeighbors(grid, r, c, 10)` |
| 16 | `elevation_m` | float | `cell.elevation` (already in grid) |
| 17 | `pct_forest` | float [0,1] | computed once per scenario from fuel map |
| 18 | `pct_shrub` | float [0,1] | computed once per scenario |
| 19 | `pct_grass` | float [0,1] | computed once per scenario |
| 20 | `pct_urban` | float [0,1] | computed once per scenario |
| 21 | `dominant_fuel_enc` | int | argmax of pct_* — constant per scenario |
| 22 | `land_cover_code` | int | preset per scenario (passed in `weatherData`) |
| 23 | `curr_hotspot_count` | int | count of burning cells, recomputed each step |
| 24 | `curr_area_km2` | float | bbox of burning cells × cell size² |
| 25 | `curr_extent_ns_km` | float | (lat range of burning cells) × 111 |
| 26 | `curr_extent_ew_km` | float | (lng range) × 111 × cos(mid lat) |
| 27 | `recent_precip_3day_mm` | float | `config.recentPrecip3Day` |

### Excluded features and why

| Feature(s) | Reason |
|---|---|
| `frp_mw`, `brightness_k`, `confidence` | satellite-only; runtime fakes them with constants — pure noise |
| `avg_frp_mw`, `max_frp_mw`, `fire_intensity_index` | derived from FRP, no runtime signal |
| `wind_spread_alignment` | daily aggregate computed differently from per-cell alignment — distribution mismatch |
| `next_*`, `*_growth*`, `spread_distance_km`, `spread_direction_deg`, `area_growth_km2`, `next_area_km2` | **forward-looking targets** — leakage |
| `fire_id`, `fire_name`, `timestamp`, `date`, `day_of_fire`, `daily_features_recomputed` | identifiers / metadata |

## Data preparation

1. **Source:** `src/data/training_data_enriched.csv` (built by `scripts/enrich_training_data.py`, 251,429 × 50).
2. **Drop the 5,126 trailing-day rows** where `daily_features_recomputed = 1`. Although our target `fire_spreads_5km` is well-defined for those rows, they have NaN in `recent_precip_3day_mm` and represent the *last* observed day of each fire — a different distribution than the rest. Removing them keeps the training set clean. Final: ~246,303 rows.
3. **Categorical encoding:**
   - `fuel_type` → label-encoded matching `encodeFuelType` in `mlModel.ts`: `forest=0, grass=1, none=2, shrub=3, urban=4`.
   - `dominant_fuel` → same mapping (assertion: only values seen in training are these five).
   - `land_cover_code` → already integer; pass through.
4. **Sanity-check:** zero NaN in any selected feature column after the trailing-day drop.

## Train / validation / test split

**Leave-one-fire-out (LOFO) is the right call here**, but we have only 30 fires — too few for k-fold-LOFO to give stable estimates and not enough for one held-out fire to be representative. So:

- **Holdout test set:** 6 fires (~20%) chosen to span fuel types and continents. Candidates: `caldor-fire-2021` (forest, US), `bolivia-2019` (forest, S. America), `siberia-2021` (forest, Russia, very large), `kincade-2019` (small US fire), `greece-2023` (Mediterranean shrub), `maui-fire-2023` (small, urban-adjacent).
- **Training set:** 24 fires.
- **Validation:** 5-fold cross-validation **at the fire-id level** within the 24 training fires (each fold holds out 4–5 fires). This is what early-stopping watches.

Random row-level splits would leak: rows from the same fire are highly correlated.

## Model: XGBoost

Hyperparameters (initial, tuned via the 5-fold CV):

| Param | Value | Why |
|---|---|---|
| `objective` | `binary:logistic` | matches existing model; sigmoid + tree sum |
| `eval_metric` | `aucpr` | better than AUC under 9:1 imbalance |
| `n_estimators` | up to 600, `early_stopping_rounds=30` | existing model has 300 trees; let CV decide |
| `max_depth` | 6 | starting point; CV will sweep 4-8 |
| `learning_rate` | 0.05 | slower than default for stability |
| `min_child_weight` | 5 | guard against overfitting on small leaves |
| `subsample` | 0.8 | row subsampling per tree |
| `colsample_bytree` | 0.8 | column subsampling per tree |
| `scale_pos_weight` | 0.10 | n_neg / n_pos ≈ 23k / 228k |
| `tree_method` | `hist` | fast on 250K rows |
| `random_state` | 42 | reproducibility |

## Evaluation

Report on the **6-fire holdout test set**:

| Metric | Why |
|---|---|
| AUC-PR | primary; robust under imbalance |
| AUC-ROC | comparison with literature |
| F1 at threshold 0.5 | default decision quality |
| Brier score | calibration check (sigmoid output should be probability-like) |
| Confusion matrix | failure-mode visibility |
| Per-fire breakdown | catch a single bad fire dragging averages |
| Top-15 SHAP / gain importances | feature value sanity check |

Plus: **comparison to the existing model on the same holdout** (re-evaluate `xgboost_model.json` on the 6 test fires) to quantify the lift from enrichment.

## Output artifacts

1. **`src/data/xgboost_model_v2.json`** — same custom `{features, base_score, trees}` format as the existing model, exported by walking the trained Booster trees and emitting nested `{f, t, y, n, v}` nodes. This is the format `mlModel.ts` already understands.
2. **`models/xgboost_v2.ubj`** — native XGBoost binary, in case we want to retrain from it or use the standard runtime in tooling.
3. **`models/training_metadata.json`** — feature list, encoding map, holdout fires, hyperparameters, all metrics. Pinned to a git commit for reproducibility.
4. **`models/training_report.md`** — human-readable summary: dataset stats, splits, metrics, comparison to v1, a few example predictions.

## Runtime integration

After training, the model swap touches three files:

1. **`src/simulation/mlModel.ts`** — update the feature-order docstring (15→27). The custom JSON format and the `predictSpreadProbability` function need no logic change; they just walk the new trees.
2. **`src/simulation/spread.ts`** — extend the feature vector at line 117 from 18 entries to 27 entries:
   - drop `frp_mw=15, brightness_k=300, confidence=50`
   - add `cell.elevation`, the 4 `pct_*` (precomputed), `dominant_fuel_enc`, `land_cover_code`, the 4 runtime aggregates, `recent_precip_3day_mm`
   - precompute the scenario-level pct_* and dominant_fuel once per simulation start (not per cell, not per step)
   - precompute the 4 hotspot aggregates **once per step** (O(N) over the grid), not per candidate cell — significant perf win
3. **`src/simulation/useSimulation.ts`** — extend `weatherData` in the `startSimulation` signature to carry `humidity, windSpeed, windDirection, recentPrecip3Day, landCoverCode`. Currently it only carries `tempMean, tempMax, precipitation, cumulativePrecip`.

The model file path stays the same (`src/data/xgboost_model.json`) — we replace it atomically once the new model lands.

## Risk + mitigations

| Risk | Mitigation |
|---|---|
| New model overfits despite CV | LOFO 6-fire test set is the final gate; ship only if it beats v1 on it |
| Runtime feature computation is slow | Precompute scenario-static features once; precompute step-static features once per step (not per cell) |
| Model is *worse* than v1 due to dropping satellite features | Compare on holdout before swapping. If worse, keep v1, reevaluate. Risk mostly mitigated because v1's satellite features were faked at inference anyway |
| `pct_*` at runtime computed differently from training | Training: per-fire static (one value per fire). Runtime: computed from the user-loaded fuel map. These should match if the fuel map matches the fire's land-cover composition. Sanity-check by sampling a few runtime maps against training values |
| `land_cover_code` not available for user-clicked custom ignitions | Fall back to "shrub" / a default code for free-form ignitions; only enforce for preset scenarios |

## Success criteria

The project succeeds if **all** of:

1. New model AUC-PR on the 6-fire holdout is **≥ existing model's AUC-PR** on the same holdout.
2. Brier score is **≤ 0.20** (sigmoid output is roughly calibrated).
3. The browser simulation loads the new model and runs the existing test scenarios without errors.
4. The qualitative behavior in the running app (spread shape, speed, fuel sensitivity) looks reasonable on at least 3 preset scenarios.

If 1 fails, we don't ship. If 2-4 fail, we iterate before shipping.

## Out of scope

- Hyperparameter search beyond the listed grid (will revisit if the model underperforms).
- LightGBM / CatBoost / NN comparison — XGBoost is enough to validate the enrichment.
- Runtime feature computation optimization beyond the per-step precompute (already O(N), not O(N²)).
- Updating the legacy `fire_spread_model.pkl` — separate artifact, not used by the browser sim.
