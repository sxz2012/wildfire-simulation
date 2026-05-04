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


def main() -> None:
    print("TODO: implement pipeline")


if __name__ == "__main__":
    main()
