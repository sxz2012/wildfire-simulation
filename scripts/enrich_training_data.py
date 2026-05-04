"""Enrich training_data_balanced.csv with daily-level features from training_data.csv.

Phase 1: broadcast-join daily features onto each per-hotspot row by (fire_id, date).
Phase 2: for trailing fire-days that have no daily-aggregate row, recompute the
         aggregates from the per-hotspot data itself.
Phase 3: backfill static terrain / land-cover features from a per-fire lookup
         (these are constant per fire, verified empirically).

Output: src/data/training_data_enriched.csv
"""

from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "src" / "data"
BALANCED_PATH = DATA_DIR / "training_data_balanced.csv"
DAILY_PATH = DATA_DIR / "training_data.csv"
OUTPUT_PATH = DATA_DIR / "training_data_enriched.csv"

# Columns shared by name between the two files. Balanced's values are at hotspot
# granularity, so we keep those and drop daily's duplicates from the join side.
REDUNDANT_IN_DAILY = [
    "latitude",
    "longitude",
    "temp_mean_c",
    "temp_max_c",
    "humidity_pct",
    "wind_speed_kmh",
    "wind_direction_deg",
    "precipitation_mm",
    "cumulative_precip_mm",
]

# Per-fire static features (verified to have exactly 1 unique value per fire_id).
STATIC_PER_FIRE = [
    "fire_name",
    "elevation_m",
    "land_cover_code",
    "land_cover_name",
    "dominant_fuel",
    "pct_forest",
    "pct_shrub",
    "pct_grass",
    "pct_urban",
]


def main() -> None:
    print(f"Loading {BALANCED_PATH.name} ...")
    balanced = pd.read_csv(BALANCED_PATH)
    print(f"  {len(balanced):,} rows, {balanced.shape[1]} cols")

    print(f"Loading {DAILY_PATH.name} ...")
    daily = pd.read_csv(DAILY_PATH)
    print(f"  {len(daily):,} rows, {daily.shape[1]} cols")

    # === PHASE 1: broadcast join ====================================
    balanced["date"] = balanced["timestamp"].str[:10]
    daily_to_join = daily.drop(columns=REDUNDANT_IN_DAILY)

    print("\n[Phase 1] Broadcast join on (fire_id, date) ...")
    merged = balanced.merge(daily_to_join, on=["fire_id", "date"], how="left")
    matched_mask = merged["fire_name"].notna()
    n_matched = int(matched_mask.sum())
    n_unmatched = len(merged) - n_matched
    print(f"  matched: {n_matched:,} ({100 * n_matched / len(merged):.1f}%)")
    print(f"  unmatched (trailing days): {n_unmatched:,}")

    # === PHASE 2: recompute daily aggregates for trailing days =======
    print("\n[Phase 2] Recomputing daily aggregates from per-hotspot data ...")
    grouped = balanced.groupby(["fire_id", "date"])
    agg = grouped.agg(
        _hotspot_count=("frp_mw", "count"),
        _avg_frp=("frp_mw", "mean"),
        _max_frp=("frp_mw", "max"),
        _lat_min=("latitude", "min"),
        _lat_max=("latitude", "max"),
        _lng_min=("longitude", "min"),
        _lng_max=("longitude", "max"),
    ).reset_index()

    # NS extent: 1 deg lat ≈ 111 km. EW extent scales by cos(mean lat).
    agg["_extent_ns_km"] = (agg["_lat_max"] - agg["_lat_min"]) * 111.0
    mid_lat_rad = np.radians((agg["_lat_max"] + agg["_lat_min"]) / 2)
    agg["_extent_ew_km"] = (agg["_lng_max"] - agg["_lng_min"]) * 111.0 * np.cos(mid_lat_rad)
    agg["_area_km2"] = agg["_extent_ns_km"] * agg["_extent_ew_km"]

    merged = merged.merge(
        agg[
            [
                "fire_id",
                "date",
                "_hotspot_count",
                "_avg_frp",
                "_max_frp",
                "_extent_ns_km",
                "_extent_ew_km",
                "_area_km2",
            ]
        ],
        on=["fire_id", "date"],
        how="left",
    )

    fill_pairs = [
        ("curr_hotspot_count", "_hotspot_count"),
        ("avg_frp_mw", "_avg_frp"),
        ("max_frp_mw", "_max_frp"),
        ("curr_extent_ns_km", "_extent_ns_km"),
        ("curr_extent_ew_km", "_extent_ew_km"),
        ("curr_area_km2", "_area_km2"),
    ]
    for target, source in fill_pairs:
        merged[target] = merged[target].fillna(merged[source])
    merged = merged.drop(columns=[s for _, s in fill_pairs])

    # day_of_fire: derive as days since each fire's first observed date.
    fire_first_date = balanced.groupby("fire_id")["date"].min()
    merged_dates = pd.to_datetime(merged["date"])
    fire_start_dates = pd.to_datetime(merged["fire_id"].map(fire_first_date))
    derived_day = (merged_dates - fire_start_dates).dt.days + 1
    merged["day_of_fire"] = merged["day_of_fire"].fillna(derived_day)

    # === PHASE 3: backfill static per-fire features ==================
    print("\n[Phase 3] Backfilling static terrain / land-cover from per-fire lookup ...")
    # Sanity: each fire should have exactly one unique value for each static col.
    for col in STATIC_PER_FIRE:
        nuniq = daily.groupby("fire_id")[col].nunique()
        bad = nuniq[nuniq > 1]
        if len(bad):
            raise RuntimeError(
                f"Static column {col!r} varies within fire(s): {bad.to_dict()}"
            )

    fire_lookup = daily.groupby("fire_id")[STATIC_PER_FIRE].first()
    for col in STATIC_PER_FIRE:
        mapped = merged["fire_id"].map(fire_lookup[col])
        merged[col] = merged[col].fillna(mapped)

    # === Indicator + verification ====================================
    merged["daily_features_recomputed"] = (~matched_mask).astype("int8")

    print("\n[Verify] Null counts in newly-added columns:")
    new_cols = [c for c in merged.columns if c not in balanced.columns]
    null_summary = merged[new_cols].isna().sum()
    for c, n in null_summary.items():
        if n:
            print(f"  {c}: {n:,} nulls ({100 * n / len(merged):.2f}%)")
        else:
            print(f"  {c}: 0 nulls")

    print(f"\nFinal shape: {merged.shape[0]:,} rows × {merged.shape[1]} cols")

    print(f"\nWriting {OUTPUT_PATH.name} ...")
    merged.to_csv(OUTPUT_PATH, index=False)
    size_mb = OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f"  wrote {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
