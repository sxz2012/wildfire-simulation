# Fire-Spread Model Training Report (v2)

**Date:** 2026-05-03
**Dataset:** `src/data/training_data_enriched.csv` (251,429 rows; 246,303 after dropping trailing days)
**Features:** 27 (hours_since_start, latitude, longitude, is_daytime, fuel_type_enc, temp_mean_c, temp_max_c, humidity_pct, wind_speed_kmh, wind_direction_deg, precipitation_mm, cumulative_precip_mm, neighbors_1km, neighbors_5km, neighbors_10km, elevation_m, pct_forest, pct_shrub, pct_grass, pct_urban, dominant_fuel_enc, land_cover_code, curr_hotspot_count, curr_area_km2, curr_extent_ns_km, curr_extent_ew_km, recent_precip_3day_mm)
**Target:** `fire_spreads_5km`

## Cross-validation (24 train fires, 5-fold leave-fires-out)

- Per-fold AUC-PR: ['0.9711', '0.9527', '0.9548', '0.9500', '0.9856']
- Mean ± std: 0.9628 ± 0.0135
- Median best n_estimators: 11

## Holdout (6 fires: caldor-fire-2021, bolivia-2019, siberia-2021, kincade-2019, greece-2023, maui-fire-2023)

| Metric | v1 (18 features) | v2 (27 features) | Δ |
|---|---|---|---|
| AUC-PR | 0.9921 | 0.9668 | -0.0252 |
| AUC-ROC | 0.9248 | 0.7504 | -0.1744 |
| F1 @ 0.5 | 0.8728 | 0.9522 | +0.0795 |
| Brier | 0.1458 | 0.0762 | -0.0696 |

## Per-fire AUC-PR (v2)
- bolivia-2019: 0.8814
- caldor-fire-2021: 0.9980
- greece-2023: 0.9214
- kincade-2019: 0.8776
- maui-fire-2023: 1.0000
- siberia-2021: 0.9234

## Decision

**SHIP — calibration & F1 favor v2 for simulation use case.** v1 wins rank metrics (likely due to leakage — v1 trained on holdout fires); v2 wins Brier (calibration) and F1, which matter more for probabilistic per-cell simulation. User accepted this tradeoff.
