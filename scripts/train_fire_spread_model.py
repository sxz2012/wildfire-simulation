"""Train an enriched fire-spread classifier on training_data_enriched.csv.

Reads the 251K-row enriched dataset, drops trailing-day rows, builds the
27-feature input matrix, trains XGBoost with leave-fire-out CV, evaluates on
a held-out set of 6 fires, exports the model to the browser-compatible JSON
format, and writes a training report.

Usage:
    python3 scripts/train_fire_spread_model.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupKFold

# === Paths ===
ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "src" / "data" / "training_data_enriched.csv"
EXISTING_MODEL_PATH = ROOT / "src" / "data" / "xgboost_model.json"
OUTPUT_MODEL_JSON = ROOT / "src" / "data" / "xgboost_model_v2.json"
OUTPUT_MODEL_UBJ = ROOT / "models" / "xgboost_v2.ubj"
OUTPUT_METADATA = ROOT / "models" / "training_metadata.json"
OUTPUT_REPORT = ROOT / "models" / "training_report.md"

# === Feature set (must match runtime feature vector exactly) ===
FEATURES = [
    "hours_since_start",
    "latitude",
    "longitude",
    "is_daytime",
    "fuel_type_enc",
    "temp_mean_c",
    "temp_max_c",
    "humidity_pct",
    "wind_speed_kmh",
    "wind_direction_deg",
    "precipitation_mm",
    "cumulative_precip_mm",
    "neighbors_1km",
    "neighbors_5km",
    "neighbors_10km",
    "elevation_m",
    "pct_forest",
    "pct_shrub",
    "pct_grass",
    "pct_urban",
    "dominant_fuel_enc",
    "land_cover_code",
    "curr_hotspot_count",
    "curr_area_km2",
    "curr_extent_ns_km",
    "curr_extent_ew_km",
    "recent_precip_3day_mm",
]

TARGET = "fire_spreads_5km"

# Must match encodeFuelType in src/simulation/mlModel.ts
FUEL_ENCODING = {"forest": 0, "grass": 1, "none": 2, "shrub": 3, "urban": 4}

HOLDOUT_FIRES = [
    "caldor-fire-2021",
    "bolivia-2019",
    "siberia-2021",
    "kincade-2019",
    "greece-2023",
    "maui-fire-2023",
]

XGB_PARAMS = {
    "objective": "binary:logistic",
    "eval_metric": "aucpr",
    "max_depth": 6,
    "learning_rate": 0.05,
    "min_child_weight": 5,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "tree_method": "hist",
    "random_state": 42,
}


def load_and_prepare() -> pd.DataFrame:
    """Load enriched CSV, drop trailing-day rows, encode categoricals, sanity-check."""
    print(f"Loading {DATA_PATH.name} ...")
    df = pd.read_csv(DATA_PATH)
    n0 = len(df)
    print(f"  loaded {n0:,} rows, {df.shape[1]} cols")

    # Drop the 5,126 trailing-day rows (they have NaN in recent_precip_3day_mm
    # and represent each fire's last observed day — different distribution).
    df = df[df["daily_features_recomputed"] == 0].copy()
    print(f"  dropped {n0 - len(df):,} trailing-day rows; {len(df):,} remain")

    # Encode categorical fuels using the runtime encoding (mlModel.ts).
    unknown_fuels = set(df["fuel_type"].unique()) - set(FUEL_ENCODING)
    assert not unknown_fuels, f"Unknown fuel_type values: {unknown_fuels}"
    unknown_doms = set(df["dominant_fuel"].unique()) - set(FUEL_ENCODING)
    assert not unknown_doms, f"Unknown dominant_fuel values: {unknown_doms}"
    df["fuel_type_enc"] = df["fuel_type"].map(FUEL_ENCODING).astype("int8")
    df["dominant_fuel_enc"] = df["dominant_fuel"].map(FUEL_ENCODING).astype("int8")

    # Verify no NaN in any feature column.
    null_counts = df[FEATURES].isna().sum()
    bad = null_counts[null_counts > 0]
    assert bad.empty, f"NaN found in feature columns:\n{bad}"

    print(f"  feature matrix ready: {len(df):,} rows × {len(FEATURES)} features")
    return df


def main() -> None:
    df = load_and_prepare()
    print("\nLabel balance:")
    print(df[TARGET].value_counts().to_dict())
    print("\nFires:", df["fire_id"].nunique(), "unique")


if __name__ == "__main__":
    main()
