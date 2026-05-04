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
import math
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
    "eval_metric": "auc",
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


def split_train_test(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split into 24-fire training set and 6-fire holdout test set."""
    test_df = df[df["fire_id"].isin(HOLDOUT_FIRES)].copy()
    train_df = df[~df["fire_id"].isin(HOLDOUT_FIRES)].copy()

    missing = set(HOLDOUT_FIRES) - set(df["fire_id"].unique())
    assert not missing, f"Holdout fires not in data: {missing}"

    print(f"\nTrain: {len(train_df):,} rows, {train_df['fire_id'].nunique()} fires")
    print(f"Test:  {len(test_df):,} rows, {test_df['fire_id'].nunique()} fires")
    return train_df, test_df


def make_cv_folds(train_df: pd.DataFrame, n_splits: int = 5) -> GroupKFold:
    """5-fold leave-fires-out cross-validation inside the training set."""
    return GroupKFold(n_splits=n_splits)


def cv_train(train_df: pd.DataFrame) -> tuple[int, list[float]]:
    """Run 5-fold leave-fires-out CV. Return (best n_estimators, per-fold AUC-PR)."""
    gkf = make_cv_folds(train_df)
    best_iters: list[int] = []
    aucpr_per_fold: list[float] = []

    for fold, (tr_idx, va_idx) in enumerate(
        gkf.split(train_df, groups=train_df["fire_id"]), 1
    ):
        tr = train_df.iloc[tr_idx]
        va = train_df.iloc[va_idx]
        dtrain = xgb.DMatrix(tr[FEATURES], label=tr[TARGET])
        dval = xgb.DMatrix(va[FEATURES], label=va[TARGET])

        params = XGB_PARAMS
        booster = xgb.train(
            params,
            dtrain,
            num_boost_round=600,
            evals=[(dtrain, "train"), (dval, "val")],
            early_stopping_rounds=30,
            verbose_eval=50,
        )
        best_iters.append(booster.best_iteration + 1)
        preds = booster.predict(dval, iteration_range=(0, booster.best_iteration + 1))
        aucpr = average_precision_score(va[TARGET], preds)
        aucpr_per_fold.append(aucpr)
        print(f"Fold {fold}: best_iter={best_iters[-1]} val_aucpr={aucpr:.4f}")

    best_n = int(np.median(best_iters))
    print(f"\nMedian best_iter across folds: {best_n}")
    print(f"Mean val AUC-PR: {np.mean(aucpr_per_fold):.4f} ± {np.std(aucpr_per_fold):.4f}")
    return best_n, aucpr_per_fold


def train_final(train_df: pd.DataFrame, n_estimators: int) -> xgb.Booster:
    """Train final booster on all 24 train fires, fixed n_estimators."""
    dtrain = xgb.DMatrix(train_df[FEATURES], label=train_df[TARGET])

    print(f"\nTraining final model: {n_estimators} trees on {len(train_df):,} rows ...")
    booster = xgb.train(
        XGB_PARAMS,
        dtrain,
        num_boost_round=n_estimators,
        verbose_eval=False,
    )
    return booster


def evaluate(booster: xgb.Booster, test_df: pd.DataFrame, label: str) -> dict:
    """Evaluate booster on holdout. Return metrics dict."""
    dtest = xgb.DMatrix(test_df[FEATURES], label=test_df[TARGET])
    preds = booster.predict(dtest)
    y = test_df[TARGET].values
    yhat = (preds >= 0.5).astype(int)

    metrics = {
        "model": label,
        "n_rows": int(len(test_df)),
        "n_fires": int(test_df["fire_id"].nunique()),
        "aucpr": float(average_precision_score(y, preds)),
        "aucroc": float(roc_auc_score(y, preds)),
        "f1": float(f1_score(y, yhat)),
        "brier": float(brier_score_loss(y, preds)),
        "positive_rate": float(y.mean()),
    }
    print(f"\n=== Holdout metrics ({label}) ===")
    for k, v in metrics.items():
        if isinstance(v, float):
            print(f"  {k:>15}: {v:.4f}")
        else:
            print(f"  {k:>15}: {v}")

    print(f"\n  Per-fire AUC-PR ({label}):")
    per_fire = {}
    for fid, group in test_df.groupby("fire_id"):
        idx = group.index
        # group preds need positional indexing; rebuild
        gp = booster.predict(xgb.DMatrix(group[FEATURES]))
        ap = average_precision_score(group[TARGET], gp) if group[TARGET].nunique() > 1 else float("nan")
        per_fire[fid] = float(ap)
        print(f"    {fid:<22} aucpr={ap:.4f} (n={len(group):,})")
    metrics["per_fire_aucpr"] = per_fire
    return metrics


V1_FEATURES = [
    "hours_since_start",
    "latitude",
    "longitude",
    "frp_mw",
    "brightness_k",
    "confidence",
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
]


def _walk_tree(node: dict, x: np.ndarray) -> float:
    while "v" not in node:
        if x[node["f"]] < node["t"]:
            node = node["y"]
        else:
            node = node["n"]
    return float(node["v"])


def predict_v1(test_df: pd.DataFrame) -> np.ndarray:
    """Predict with the existing model's custom JSON, using v1 feature set
    and the same constants the runtime fakes for satellite features."""
    with open(EXISTING_MODEL_PATH) as f:
        v1 = json.load(f)

    # The runtime fakes these for unburned candidate cells:
    df = test_df.copy()
    if "frp_mw" not in df:
        df["frp_mw"] = 15.0
    if "brightness_k" not in df:
        df["brightness_k"] = 300.0
    if "confidence" not in df:
        df["confidence"] = 50.0

    X = df[V1_FEATURES].to_numpy()
    n = len(df)
    sums = np.zeros(n)
    for tree in v1["trees"]:
        for i in range(n):
            sums[i] += _walk_tree(tree, X[i])
    # sigmoid
    return 1.0 / (1.0 + np.exp(-sums))


def evaluate_v1(test_df: pd.DataFrame) -> dict:
    """Evaluate v1 model on holdout — uses the runtime's faked satellite
    constants to mirror what the browser sim actually sees, NOT the real
    satellite values from the dataset."""
    preds = predict_v1(test_df.assign(frp_mw=15.0, brightness_k=300.0, confidence=50.0))
    y = test_df[TARGET].values
    yhat = (preds >= 0.5).astype(int)
    metrics = {
        "model": "v1 (existing, 18 features, satellite-faked)",
        "n_rows": int(len(test_df)),
        "n_fires": int(test_df["fire_id"].nunique()),
        "aucpr": float(average_precision_score(y, preds)),
        "aucroc": float(roc_auc_score(y, preds)),
        "f1": float(f1_score(y, yhat)),
        "brier": float(brier_score_loss(y, preds)),
        "positive_rate": float(y.mean()),
    }
    print(f"\n=== Holdout metrics (v1) ===")
    for k, v in metrics.items():
        if isinstance(v, float):
            print(f"  {k:>15}: {v:.4f}")
        else:
            print(f"  {k:>15}: {v}")
    return metrics


def export_booster_to_json(
    booster: xgb.Booster, feature_names: list[str]
) -> dict:
    """Convert a trained XGBoost Booster to the custom JSON tree format
    consumed by src/simulation/mlModel.ts.

    Output schema:
        {"features": [...], "base_score": 0.5, "trees": [<tree>, ...]}
    Each tree is a nested {"f": int, "t": float, "y": <child>, "n": <child>}
    or a leaf {"v": float}.

    The runtime evaluates ``sigmoid(sum_of_tree_leaves)`` without an explicit
    base-score term. XGBoost (>= 2.0) auto-tunes ``base_score`` from the
    label distribution, so we bake its logit into a single-leaf "bias" tree
    prepended to the tree list. This makes the export self-contained.
    """
    feat_index = {name: i for i, name in enumerate(feature_names)}
    raw_trees = booster.get_dump(dump_format="json")
    trees: list[dict] = []
    for raw in raw_trees:
        tree_dict = json.loads(raw)
        trees.append(_convert_node(tree_dict, feat_index))

    config = json.loads(booster.save_config())
    # XGBoost wraps the base_score scalar in brackets like "[4.94E-1]".
    base_score = float(
        config["learner"]["learner_model_param"]["base_score"].strip("[]")
    )
    # Clamp to avoid log(0); XGBoost itself clamps similarly.
    base_score = min(max(base_score, 1e-7), 1.0 - 1e-7)
    bias = math.log(base_score / (1.0 - base_score))
    if abs(bias) > 0.0:
        trees.insert(0, {"v": bias})

    return {"features": feature_names, "base_score": base_score, "trees": trees}


def _convert_node(node: dict, feat_index: dict[str, int]) -> dict:
    """Recursively convert one XGBoost tree-dump node to the {f,t,y,n,v}
    format used by mlModel.ts.

    XGBoost's "yes" branch is taken when feature < split_condition (matches
    mlModel.ts which tests `featureValue < node.t -> y`). The "missing"
    direction is also recorded by XGBoost; we use the "yes"/"no" pair the
    runtime expects and ignore missing handling (our features have no NaN).

    XGBoost stores split conditions and feature values internally as float32,
    so its comparison is `float32(x) < float32(threshold)`. The runtime
    (mlModel.ts) compares feature values in float64 (JS numbers). To make the
    float64 comparison agree with XGBoost's float32 comparison for any input
    x, we shift the threshold to the midpoint between the float32 split value
    and its predecessor in float32 — that is exactly the rounding boundary
    where float64 values switch from rounding to ``prev`` to rounding to
    ``T``. With the midpoint as the threshold, ``x_f64 < midpoint`` is
    equivalent to ``float32(x) < T_f32`` for all float64 x.
    """
    if "leaf" in node:
        return {"v": float(node["leaf"])}

    f = feat_index[node["split"]]
    t_f32 = np.float32(node["split_condition"])
    prev_t_f32 = np.nextafter(t_f32, np.float32(-np.inf))
    t = (float(prev_t_f32) + float(t_f32)) / 2.0
    yes_id = node["yes"]
    no_id = node["no"]
    children_by_id = {c["nodeid"]: c for c in node["children"]}
    return {
        "f": f,
        "t": t,
        "y": _convert_node(children_by_id[yes_id], feat_index),
        "n": _convert_node(children_by_id[no_id], feat_index),
    }


def main() -> None:
    df = load_and_prepare()
    print("\nLabel balance:")
    print(df[TARGET].value_counts().to_dict())
    print("\nFires:", df["fire_id"].nunique(), "unique")

    train_df, test_df = split_train_test(df)
    gkf = make_cv_folds(train_df)
    for i, (tr_idx, va_idx) in enumerate(gkf.split(train_df, groups=train_df["fire_id"]), 1):
        tr_fires = train_df.iloc[tr_idx]["fire_id"].nunique()
        va_fires = train_df.iloc[va_idx]["fire_id"].nunique()
        print(f"  Fold {i}: train_fires={tr_fires} val_fires={va_fires}")

    best_n, fold_aucprs = cv_train(train_df)

    booster = train_final(train_df, best_n)

    new_metrics = evaluate(booster, test_df, label="v2 (enriched, 27 features)")

    v1_metrics = evaluate_v1(test_df)
    print("\n=== v2 vs v1 ===")
    print(f"  AUC-PR: v1={v1_metrics['aucpr']:.4f}  v2={new_metrics['aucpr']:.4f}  "
          f"Δ={new_metrics['aucpr']-v1_metrics['aucpr']:+.4f}")


if __name__ == "__main__":
    main()
