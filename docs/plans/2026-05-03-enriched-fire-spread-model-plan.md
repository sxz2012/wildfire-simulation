# Enriched Fire-Spread Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Train an XGBoost classifier on the enriched 251K-row dataset using 27 runtime-producible features, export it to the browser-compatible JSON format, and integrate it into the in-browser fire-spread simulation, replacing the current 18-feature model.

**Architecture:** Python training script reads `src/data/training_data_enriched.csv`, drops 5,126 trailing-day rows (NaN in `recent_precip_3day_mm`), encodes categoricals, splits leave-fire-out (24 train / 6 test, 5-fold CV inside train), trains XGBoost with early stopping, exports trees to the existing `{f,t,y,n,v}` JSON format, evaluates on holdout, and compares to v1. Runtime changes extend `SimulationConfig` and `weatherData` with `recentPrecip3Day` + `landCoverCode`, precompute scenario-static features once and step-static aggregates once per step in `spread.ts`, and grow the inference feature vector from 18 to 27 entries.

**Tech Stack:** Python 3 + xgboost 3.2 + scikit-learn + pandas (training); TypeScript + vitest (runtime + tests). The custom JSON tree-format runtime in `mlModel.ts` is unchanged.

**Reference design:** `docs/plans/2026-05-03-enriched-fire-spread-model-design.md`

---

## Phase A — Python training pipeline

### Task A1: Add a Python directory layout for training artifacts

**Files:**
- Create: `models/` (directory; will hold `.ubj`, metadata, report)
- Create: `models/.gitkeep` (empty file so the directory commits)
- Modify: `.gitignore` — add `models/*.ubj` (binaries) but keep `models/*.json` and `models/*.md`

**Step 1: Create the directory and .gitkeep**

```bash
mkdir -p /Users/mlstudio/projects/WildFireVisualization/models
touch /Users/mlstudio/projects/WildFireVisualization/models/.gitkeep
```

**Step 2: Append to .gitignore**

Add these lines:

```
# Trained model binaries (the browser-loaded JSON is checked in separately)
models/*.ubj
```

**Step 3: Commit**

```bash
git add models/.gitkeep .gitignore
git commit -m "chore: add models directory for training artifacts"
```

---

### Task A2: Write training script skeleton with config

**Files:**
- Create: `scripts/train_fire_spread_model.py`

**Step 1: Write skeleton**

```python
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
```

**Step 2: Verify the skeleton runs**

Run: `cd /Users/mlstudio/projects/WildFireVisualization && python3 scripts/train_fire_spread_model.py`
Expected output: `TODO: implement pipeline`

**Step 3: Commit**

```bash
git add scripts/train_fire_spread_model.py
git commit -m "feat: scaffold enriched fire-spread training script"
```

---

### Task A3: Add data loading + cleaning function

**Files:**
- Modify: `scripts/train_fire_spread_model.py`

**Step 1: Add `load_and_prepare()` above `main()`**

```python
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
```

**Step 2: Wire `main()` to call it and print a summary**

Replace `main()` body with:

```python
def main() -> None:
    df = load_and_prepare()
    print("\nLabel balance:")
    print(df[TARGET].value_counts().to_dict())
    print("\nFires:", df["fire_id"].nunique(), "unique")
```

**Step 3: Run and verify**

Run: `python3 scripts/train_fire_spread_model.py`
Expected: prints "246,303 rows × 27 features", label balance, "30 unique fires" (note: enriched still has 30 fires after trailing-day drop because every fire has non-trailing days too).

**Step 4: Commit**

```bash
git add scripts/train_fire_spread_model.py
git commit -m "feat: load and clean enriched training data"
```

---

### Task A4: Add the leave-fire-out split

**Files:**
- Modify: `scripts/train_fire_spread_model.py`

**Step 1: Add `split_train_test()` and `make_cv_folds()`**

```python
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
```

**Step 2: Wire `main()`**

Append to `main()`:

```python
    train_df, test_df = split_train_test(df)
    gkf = make_cv_folds(train_df)
    for i, (tr_idx, va_idx) in enumerate(gkf.split(train_df, groups=train_df["fire_id"]), 1):
        tr_fires = train_df.iloc[tr_idx]["fire_id"].nunique()
        va_fires = train_df.iloc[va_idx]["fire_id"].nunique()
        print(f"  Fold {i}: train_fires={tr_fires} val_fires={va_fires}")
```

**Step 3: Run and verify**

Run: `python3 scripts/train_fire_spread_model.py`
Expected: prints train/test counts, then "Fold 1: train_fires=19 val_fires=5" through fold 5 (counts may vary; total val_fires should equal 24).

**Step 4: Commit**

```bash
git add scripts/train_fire_spread_model.py
git commit -m "feat: add leave-fire-out train/test split and CV folds"
```

---

### Task A5: Add CV training loop with early stopping

**Files:**
- Modify: `scripts/train_fire_spread_model.py`

**Step 1: Add `cv_train()`**

```python
def cv_train(train_df: pd.DataFrame) -> tuple[int, list[float]]:
    """Run 5-fold leave-fires-out CV. Return (best n_estimators, per-fold AUC-PR)."""
    gkf = make_cv_folds(train_df)
    best_iters: list[int] = []
    aucpr_per_fold: list[float] = []

    pos = (train_df[TARGET] == 1).sum()
    neg = (train_df[TARGET] == 0).sum()
    spw = neg / pos
    print(f"\nscale_pos_weight = {spw:.4f} (neg={neg:,} / pos={pos:,})")

    for fold, (tr_idx, va_idx) in enumerate(
        gkf.split(train_df, groups=train_df["fire_id"]), 1
    ):
        tr = train_df.iloc[tr_idx]
        va = train_df.iloc[va_idx]
        dtrain = xgb.DMatrix(tr[FEATURES], label=tr[TARGET])
        dval = xgb.DMatrix(va[FEATURES], label=va[TARGET])

        params = {**XGB_PARAMS, "scale_pos_weight": spw}
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
```

**Step 2: Wire `main()`**

Append to `main()`:

```python
    best_n, fold_aucprs = cv_train(train_df)
```

**Step 3: Run and verify**

Run: `python3 scripts/train_fire_spread_model.py`
Expected: 5 folds train, each prints periodic eval-aucpr, final summary with median best_iter and mean AUC-PR. Should take ~2-5 min on a laptop.

**Step 4: Commit**

```bash
git add scripts/train_fire_spread_model.py
git commit -m "feat: 5-fold leave-fires-out CV with early stopping"
```

---

### Task A6: Train final model on all 24 train fires

**Files:**
- Modify: `scripts/train_fire_spread_model.py`

**Step 1: Add `train_final()`**

```python
def train_final(train_df: pd.DataFrame, n_estimators: int) -> xgb.Booster:
    """Train final booster on all 24 train fires, fixed n_estimators."""
    pos = (train_df[TARGET] == 1).sum()
    neg = (train_df[TARGET] == 0).sum()
    spw = neg / pos
    dtrain = xgb.DMatrix(train_df[FEATURES], label=train_df[TARGET])

    print(f"\nTraining final model: {n_estimators} trees on {len(train_df):,} rows ...")
    booster = xgb.train(
        {**XGB_PARAMS, "scale_pos_weight": spw},
        dtrain,
        num_boost_round=n_estimators,
        verbose_eval=False,
    )
    return booster
```

**Step 2: Wire `main()`**

Append:

```python
    booster = train_final(train_df, best_n)
```

**Step 3: Run and verify**

Run: `python3 scripts/train_fire_spread_model.py`
Expected: trains and prints the line "Training final model: N trees on 200000+ rows ...".

**Step 4: Commit**

```bash
git add scripts/train_fire_spread_model.py
git commit -m "feat: train final model on full train fold"
```

---

### Task A7: Add holdout evaluation

**Files:**
- Modify: `scripts/train_fire_spread_model.py`

**Step 1: Add `evaluate()`**

```python
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
```

**Step 2: Wire `main()`**

Append:

```python
    new_metrics = evaluate(booster, test_df, label="v2 (enriched, 27 features)")
```

**Step 3: Run and verify**

Run: `python3 scripts/train_fire_spread_model.py`
Expected: prints holdout metrics block, per-fire AUC-PR for 6 fires.

**Step 4: Commit**

```bash
git add scripts/train_fire_spread_model.py
git commit -m "feat: evaluate model on 6-fire holdout set"
```

---

### Task A8: Compare against the existing v1 model on the holdout

**Files:**
- Modify: `scripts/train_fire_spread_model.py`

This is the critical comparison. v1 uses 18 features, including the 3 satellite columns (`frp_mw`, `brightness_k`, `confidence`). To evaluate v1 on the same holdout we must build its 18-feature input vector. Since v1's tree format is the custom JSON (not loadable by xgboost directly), we re-implement its tree walker in Python.

**Step 1: Add v1 evaluation helpers**

```python
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
```

**Step 2: Wire `main()`**

Append:

```python
    v1_metrics = evaluate_v1(test_df)
    print("\n=== v2 vs v1 ===")
    print(f"  AUC-PR: v1={v1_metrics['aucpr']:.4f}  v2={new_metrics['aucpr']:.4f}  "
          f"Δ={new_metrics['aucpr']-v1_metrics['aucpr']:+.4f}")
```

**Step 3: Run and verify**

Run: `python3 scripts/train_fire_spread_model.py`
Expected: prints v1 metrics + comparison line. v1 AUC-PR will be a baseline; v2 should beat it (if not, do not ship and re-evaluate).

**Step 4: Commit**

```bash
git add scripts/train_fire_spread_model.py
git commit -m "feat: evaluate existing v1 model on holdout for comparison"
```

---

### Task A9: Write unit test for tree-format conversion

This is THE critical correctness test: the exported JSON must produce **byte-identical predictions** to the trained Booster. Without this test, runtime predictions would silently diverge from training-time predictions.

**Files:**
- Create: `scripts/tests/test_tree_export.py`

**Step 1: Create test directory + __init__**

```bash
mkdir -p /Users/mlstudio/projects/WildFireVisualization/scripts/tests
touch /Users/mlstudio/projects/WildFireVisualization/scripts/tests/__init__.py
```

**Step 2: Write the failing test**

```python
"""Round-trip test for the XGBoost-to-custom-JSON tree exporter.

The exported JSON's predictions, evaluated by walking the trees in pure
Python (matching mlModel.ts), MUST match the Booster's predictions to
within floating-point tolerance for every row in a sample.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from train_fire_spread_model import export_booster_to_json  # noqa: E402


def _walk(node: dict, x: np.ndarray) -> float:
    while "v" not in node:
        if x[node["f"]] < node["t"]:
            node = node["y"]
        else:
            node = node["n"]
    return float(node["v"])


def _predict_with_exported(exported: dict, X: np.ndarray) -> np.ndarray:
    sums = np.zeros(len(X))
    for tree in exported["trees"]:
        for i in range(len(X)):
            sums[i] += _walk(tree, X[i])
    return 1.0 / (1.0 + np.exp(-sums))


def test_export_roundtrip_matches_booster():
    rng = np.random.default_rng(42)
    n_features = 27
    n_rows = 500
    X = rng.normal(size=(n_rows, n_features))
    y = (X[:, 0] + X[:, 1] > 0).astype(int)

    feature_names = [f"f{i}" for i in range(n_features)]
    dtrain = xgb.DMatrix(X, label=y, feature_names=feature_names)
    booster = xgb.train(
        {"objective": "binary:logistic", "max_depth": 4, "eta": 0.1},
        dtrain,
        num_boost_round=20,
    )
    booster_preds = booster.predict(dtrain)

    exported = export_booster_to_json(booster, feature_names)
    exported_preds = _predict_with_exported(exported, X)

    max_diff = float(np.abs(booster_preds - exported_preds).max())
    assert max_diff < 1e-5, f"Exported predictions diverge from Booster: max diff = {max_diff}"
```

**Step 3: Run the test to verify it fails (function doesn't exist yet)**

Run: `cd /Users/mlstudio/projects/WildFireVisualization && python3 -m pytest scripts/tests/test_tree_export.py -v`
Expected: ImportError or AttributeError on `export_booster_to_json`.

If pytest isn't installed: `python3 -m unittest scripts.tests.test_tree_export 2>&1 | tail -20`. If neither, install pytest: `pip3 install pytest`.

**Step 4: Commit (failing test first)**

```bash
git add scripts/tests/__init__.py scripts/tests/test_tree_export.py
git commit -m "test: round-trip test for XGBoost-to-custom-JSON exporter"
```

---

### Task A10: Implement the tree exporter to make the test pass

**Files:**
- Modify: `scripts/train_fire_spread_model.py`

**Step 1: Add `export_booster_to_json()`**

XGBoost can dump a Booster as a list of dicts via `booster.get_dump(dump_format="json")`. Each tree dict has `nodeid`, `split` (feature name), `split_condition`, `yes`/`no`/`missing` (child node ids), `children` (list of child dicts), and leaves have `leaf` (float). We convert to nested `{f, t, y, n, v}` form.

```python
def export_booster_to_json(
    booster: xgb.Booster, feature_names: list[str]
) -> dict:
    """Convert a trained XGBoost Booster to the custom JSON tree format
    consumed by src/simulation/mlModel.ts.

    Output schema:
        {"features": [...], "base_score": 0.5, "trees": [<tree>, ...]}
    Each tree is a nested {"f": int, "t": float, "y": <child>, "n": <child>}
    or a leaf {"v": float}.
    """
    feat_index = {name: i for i, name in enumerate(feature_names)}
    raw_trees = booster.get_dump(dump_format="json")
    trees: list[dict] = []
    for raw in raw_trees:
        tree_dict = json.loads(raw)
        trees.append(_convert_node(tree_dict, feat_index))
    return {"features": feature_names, "base_score": 0.5, "trees": trees}


def _convert_node(node: dict, feat_index: dict[str, int]) -> dict:
    """Recursively convert one XGBoost tree-dump node to the {f,t,y,n,v}
    format used by mlModel.ts.

    XGBoost's "yes" branch is taken when feature < split_condition (matches
    mlModel.ts which tests `featureValue < node.t -> y`). The "missing"
    direction is also recorded by XGBoost; we use the "yes"/"no" pair the
    runtime expects and ignore missing handling (our features have no NaN).
    """
    if "leaf" in node:
        return {"v": float(node["leaf"])}

    f = feat_index[node["split"]]
    t = float(node["split_condition"])
    yes_id = node["yes"]
    no_id = node["no"]
    children_by_id = {c["nodeid"]: c for c in node["children"]}
    return {
        "f": f,
        "t": t,
        "y": _convert_node(children_by_id[yes_id], feat_index),
        "n": _convert_node(children_by_id[no_id], feat_index),
    }
```

**Step 2: Run the test, expect it to pass**

Run: `python3 -m pytest scripts/tests/test_tree_export.py -v`
Expected: PASSED.

If max_diff is in the range 1e-7 to 1e-5: pass. If larger: there's a logic bug — most likely yes/no inversion (xgboost's "yes" is `<` and the runtime's "y" is `<`; verify both with a single tree before debugging the exporter further).

**Step 3: Commit**

```bash
git add scripts/train_fire_spread_model.py
git commit -m "feat: export XGBoost Booster to custom browser JSON format"
```

---

### Task A11: Save artifacts (JSON, .ubj, metadata, report)

**Files:**
- Modify: `scripts/train_fire_spread_model.py`

**Step 1: Add `save_artifacts()`**

```python
def save_artifacts(
    booster: xgb.Booster,
    new_metrics: dict,
    v1_metrics: dict,
    fold_aucprs: list[float],
    best_n: int,
) -> None:
    # 1. Custom JSON (browser-loadable)
    exported = export_booster_to_json(booster, FEATURES)
    with open(OUTPUT_MODEL_JSON, "w") as f:
        json.dump(exported, f)
    print(f"\nWrote {OUTPUT_MODEL_JSON.relative_to(ROOT)} "
          f"({OUTPUT_MODEL_JSON.stat().st_size / 1024:.0f} KB, "
          f"{len(exported['trees'])} trees)")

    # 2. Native binary
    booster.save_model(str(OUTPUT_MODEL_UBJ))
    print(f"Wrote {OUTPUT_MODEL_UBJ.relative_to(ROOT)}")

    # 3. Metadata
    metadata = {
        "version": "v2",
        "trained_on": "src/data/training_data_enriched.csv",
        "features": FEATURES,
        "target": TARGET,
        "fuel_encoding": FUEL_ENCODING,
        "holdout_fires": HOLDOUT_FIRES,
        "xgb_params": XGB_PARAMS,
        "best_n_estimators": best_n,
        "cv_fold_aucpr": fold_aucprs,
        "cv_mean_aucpr": float(np.mean(fold_aucprs)),
        "v2_holdout_metrics": new_metrics,
        "v1_holdout_metrics": v1_metrics,
    }
    with open(OUTPUT_METADATA, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"Wrote {OUTPUT_METADATA.relative_to(ROOT)}")

    # 4. Human-readable report
    delta = new_metrics["aucpr"] - v1_metrics["aucpr"]
    report = f"""# Fire-Spread Model Training Report (v2)

**Date:** 2026-05-03
**Dataset:** `src/data/training_data_enriched.csv` (251,429 rows; 246,303 after dropping trailing days)
**Features:** {len(FEATURES)} ({', '.join(FEATURES)})
**Target:** `{TARGET}`

## Cross-validation (24 train fires, 5-fold leave-fires-out)

- Per-fold AUC-PR: {[f'{x:.4f}' for x in fold_aucprs]}
- Mean ± std: {np.mean(fold_aucprs):.4f} ± {np.std(fold_aucprs):.4f}
- Median best n_estimators: {best_n}

## Holdout (6 fires: {', '.join(HOLDOUT_FIRES)})

| Metric | v1 (18 features) | v2 (27 features) | Δ |
|---|---|---|---|
| AUC-PR | {v1_metrics['aucpr']:.4f} | {new_metrics['aucpr']:.4f} | {delta:+.4f} |
| AUC-ROC | {v1_metrics['aucroc']:.4f} | {new_metrics['aucroc']:.4f} | {new_metrics['aucroc']-v1_metrics['aucroc']:+.4f} |
| F1 @ 0.5 | {v1_metrics['f1']:.4f} | {new_metrics['f1']:.4f} | {new_metrics['f1']-v1_metrics['f1']:+.4f} |
| Brier | {v1_metrics['brier']:.4f} | {new_metrics['brier']:.4f} | {new_metrics['brier']-v1_metrics['brier']:+.4f} |

## Per-fire AUC-PR (v2)
""" + "\n".join(
        f"- {fid}: {ap:.4f}" for fid, ap in new_metrics["per_fire_aucpr"].items()
    ) + f"""

## Decision

{'**SHIP** — v2 beats v1 on AUC-PR.' if delta > 0 else '**DO NOT SHIP** — v2 underperforms v1, investigate before deploying.'}
"""
    with open(OUTPUT_REPORT, "w") as f:
        f.write(report)
    print(f"Wrote {OUTPUT_REPORT.relative_to(ROOT)}")
```

**Step 2: Wire `main()`**

Append:

```python
    save_artifacts(booster, new_metrics, v1_metrics, fold_aucprs, best_n)
    print("\nDone.")
```

**Step 3: Run end-to-end and verify**

Run: `python3 scripts/train_fire_spread_model.py`
Expected: full pipeline runs, prints "Wrote src/data/xgboost_model_v2.json" + 3 more, ends with "Done."

**Step 4: Inspect the output**

```bash
ls -la src/data/xgboost_model_v2.json models/
cat models/training_report.md
```

Expected: `xgboost_model_v2.json` exists (similar size to v1's 2.3 MB, possibly a bit larger), report shows AUC-PR delta.

**Step 5: Decision gate**

Read `models/training_report.md`. If AUC-PR delta is **negative**, STOP. Investigate (check feature alignment, hyperparams, CV stability) before continuing to runtime integration.

**Step 6: Commit**

```bash
git add scripts/train_fire_spread_model.py models/training_report.md models/training_metadata.json src/data/xgboost_model_v2.json
git commit -m "feat: complete training pipeline with v1 vs v2 comparison and artifacts"
```

---

## Phase B — Runtime integration

### Task B1: Update `mlModel.ts` feature comment + add new feature index constants

**Files:**
- Modify: `src/simulation/mlModel.ts`

**Step 1: Replace the feature-list docstring**

Find the comment block at lines 53-60 starting with `* Features array must match the model's feature order:`. Replace the feature list with the new 27-feature order (matching `FEATURES` in the Python script exactly).

**Step 2: Add named index constants at the bottom of the file**

```typescript
/**
 * Feature indices for the v2 enriched model. Order MUST match FEATURES in
 * scripts/train_fire_spread_model.py exactly.
 */
export const FEATURE_INDEX = {
  hours_since_start: 0,
  latitude: 1,
  longitude: 2,
  is_daytime: 3,
  fuel_type_enc: 4,
  temp_mean_c: 5,
  temp_max_c: 6,
  humidity_pct: 7,
  wind_speed_kmh: 8,
  wind_direction_deg: 9,
  precipitation_mm: 10,
  cumulative_precip_mm: 11,
  neighbors_1km: 12,
  neighbors_5km: 13,
  neighbors_10km: 14,
  elevation_m: 15,
  pct_forest: 16,
  pct_shrub: 17,
  pct_grass: 18,
  pct_urban: 19,
  dominant_fuel_enc: 20,
  land_cover_code: 21,
  curr_hotspot_count: 22,
  curr_area_km2: 23,
  curr_extent_ns_km: 24,
  curr_extent_ew_km: 25,
  recent_precip_3day_mm: 26,
} as const;

export const FEATURE_COUNT = 27;
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/mlstudio/projects/WildFireVisualization && npx tsc -b`
Expected: zero errors. (`tsc -b` is the same check `npm run build` runs.)

**Step 4: Commit**

```bash
git add src/simulation/mlModel.ts
git commit -m "feat: update mlModel feature documentation for v2 (27 features)"
```

---

### Task B2: Extend `SimulationConfig` with new fields

**Files:**
- Modify: `src/simulation/types.ts`

**Step 1: Find the `SimulationConfig` interface (around line 23) and add the new optional fields**

```typescript
// Inside SimulationConfig interface, after cumulativePrecip:
recentPrecip3Day?: number; // mm of rain in last 3 days
landCoverCode?: number;    // numeric land-cover code (preset per scenario)
```

Also add corresponding entries to `DEFAULT_CONFIG` (around line 65):

```typescript
recentPrecip3Day: 0,
landCoverCode: 126, // 'open_forest_unknown' — neutral default
```

**Step 2: Verify**

Run: `cd /Users/mlstudio/projects/WildFireVisualization && npx tsc -b`
Expected: zero errors.

**Step 3: Commit**

```bash
git add src/simulation/types.ts
git commit -m "feat: extend SimulationConfig with recentPrecip3Day and landCoverCode"
```

---

### Task B3: Add helper to compute scenario-static features (land-cover %, dominant fuel)

**Files:**
- Modify: `src/simulation/spread.ts`

**Step 1: Add a helper near the top of the file (after imports)**

```typescript
export interface ScenarioFeatures {
  pctForest: number;
  pctShrub: number;
  pctGrass: number;
  pctUrban: number;
  dominantFuelEnc: number;
}

/**
 * Compute land-cover percentages and dominant fuel from the full fuel map.
 * Constant for the duration of a simulation — call once at sim start.
 */
export function computeScenarioFeatures(fuelMap: FuelType[]): ScenarioFeatures {
  let f = 0, s = 0, g = 0, u = 0, n = 0;
  for (const fuel of fuelMap) {
    if (fuel === "forest") f++;
    else if (fuel === "shrub") s++;
    else if (fuel === "grass") g++;
    else if (fuel === "urban") u++;
    else n++; // 'none'
  }
  const total = fuelMap.length || 1;
  const pctForest = f / total;
  const pctShrub = s / total;
  const pctGrass = g / total;
  const pctUrban = u / total;

  // dominant_fuel = argmax. Must match FUEL_ENCODING (forest=0, grass=1, none=2, shrub=3, urban=4).
  const counts: [string, number][] = [
    ["forest", f], ["grass", g], ["none", n], ["shrub", s], ["urban", u],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const dominantFuelEnc = encodeFuelType(counts[0][0]);

  return { pctForest, pctShrub, pctGrass, pctUrban, dominantFuelEnc };
}
```

(Make sure `FuelType` is imported and `encodeFuelType` is already imported from `./mlModel`.)

**Step 2: Run existing tests to ensure nothing breaks**

Run: `npx vitest run src/simulation/__tests__/spread.test.ts`
Expected: all tests pass.

**Step 3: Add a unit test**

Modify `src/simulation/__tests__/spread.test.ts`. Add at the bottom:

```typescript
import { computeScenarioFeatures } from "../spread";

describe("computeScenarioFeatures", () => {
  it("computes percentages and dominant fuel correctly", () => {
    const fuelMap: FuelType[] = ["forest", "forest", "shrub", "grass", "urban"];
    const f = computeScenarioFeatures(fuelMap);
    expect(f.pctForest).toBeCloseTo(0.4, 5);
    expect(f.pctShrub).toBeCloseTo(0.2, 5);
    expect(f.pctGrass).toBeCloseTo(0.2, 5);
    expect(f.pctUrban).toBeCloseTo(0.2, 5);
    expect(f.dominantFuelEnc).toBe(0); // forest = 0
  });

  it("handles a single-fuel map", () => {
    const fuelMap: FuelType[] = Array(100).fill("shrub");
    const f = computeScenarioFeatures(fuelMap);
    expect(f.pctShrub).toBe(1);
    expect(f.dominantFuelEnc).toBe(3); // shrub = 3
  });

  it("handles an empty map without dividing by zero", () => {
    const f = computeScenarioFeatures([]);
    expect(f.pctForest).toBe(0);
    expect(Number.isFinite(f.pctForest)).toBe(true);
  });
});
```

**Step 4: Run the new tests**

Run: `npx vitest run src/simulation/__tests__/spread.test.ts -t computeScenarioFeatures`
Expected: 3 tests pass.

**Step 5: Commit**

```bash
git add src/simulation/spread.ts src/simulation/__tests__/spread.test.ts
git commit -m "feat: add computeScenarioFeatures for runtime land-cover stats"
```

---

### Task B4: Add helper to compute step-static aggregates (hotspot count, area, extents)

**Files:**
- Modify: `src/simulation/spread.ts`

**Step 1: Add the helper**

```typescript
export interface StepAggregates {
  currHotspotCount: number;
  currAreaKm2: number;
  currExtentNsKm: number;
  currExtentEwKm: number;
}

/**
 * Compute the bounding-box stats over all currently-burning cells. Call
 * ONCE per step (before iterating cells), not per candidate cell.
 */
export function computeStepAggregates(
  grid: GridCell[],
  cellSizeMeters: number,
): StepAggregates {
  let count = 0;
  let latMin = Infinity, latMax = -Infinity;
  let lngMin = Infinity, lngMax = -Infinity;
  for (const c of grid) {
    if (c.state !== CellState.Burning) continue;
    count++;
    if (c.lat < latMin) latMin = c.lat;
    if (c.lat > latMax) latMax = c.lat;
    if (c.lng < lngMin) lngMin = c.lng;
    if (c.lng > lngMax) lngMax = c.lng;
  }
  if (count === 0) {
    return { currHotspotCount: 0, currAreaKm2: 0, currExtentNsKm: 0, currExtentEwKm: 0 };
  }

  const ns = (latMax - latMin) * 111;
  const midLat = ((latMax + latMin) / 2) * Math.PI / 180;
  const ew = (lngMax - lngMin) * 111 * Math.cos(midLat);

  // Approximate burning-cell area as count × cell area, in km².
  const cellAreaKm2 = (cellSizeMeters / 1000) ** 2;
  const currAreaKm2 = count * cellAreaKm2;

  return {
    currHotspotCount: count,
    currAreaKm2,
    currExtentNsKm: ns,
    currExtentEwKm: ew,
  };
}
```

(Ensure `GridCell` and `CellState` are imported from `./types`.)

**Step 2: Add tests**

Append to `src/simulation/__tests__/spread.test.ts`:

```typescript
import { computeStepAggregates } from "../spread";
import { CellState } from "../types";

describe("computeStepAggregates", () => {
  function mkCell(lat: number, lng: number, state: CellState): GridCell {
    return {
      lat, lng, elevation: 0, fuel: "forest",
      state, burnTimer: 0, row: 0, col: 0,
    } as GridCell;
  }

  it("returns zeros when no cells are burning", () => {
    const grid = [mkCell(0, 0, CellState.Unburned)];
    const agg = computeStepAggregates(grid, 100);
    expect(agg.currHotspotCount).toBe(0);
    expect(agg.currAreaKm2).toBe(0);
  });

  it("computes count, area, and extents for a small burn cluster", () => {
    // Two cells at (0,0) and (0.01, 0.01) — about 1.1 km × 1.1 km (at equator)
    const grid = [
      mkCell(0, 0, CellState.Burning),
      mkCell(0.01, 0.01, CellState.Burning),
      mkCell(5, 5, CellState.Unburned),
    ];
    const agg = computeStepAggregates(grid, 100); // 100 m cells -> 0.01 km² each
    expect(agg.currHotspotCount).toBe(2);
    expect(agg.currAreaKm2).toBeCloseTo(0.02, 5);
    expect(agg.currExtentNsKm).toBeCloseTo(1.11, 1);
    expect(agg.currExtentEwKm).toBeGreaterThan(1.0);
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/simulation/__tests__/spread.test.ts -t computeStepAggregates`
Expected: 2 tests pass.

**Step 4: Commit**

```bash
git add src/simulation/spread.ts src/simulation/__tests__/spread.test.ts
git commit -m "feat: add computeStepAggregates for runtime hotspot stats"
```

---

### Task B5: Wire the new feature vector into `simulateStep` (the inference path)

**Files:**
- Modify: `src/simulation/spread.ts:80-150`

**Step 1: Find `simulateStep` and capture scenario + step features once**

Above the per-cell loop (between lines 80 and 88, after `const { gridSize, ... } = config`), add:

```typescript
// Compute scenario- and step-static features once per step (not per cell).
const scenarioFeatures = (config as any)._scenarioFeatures as ScenarioFeatures | undefined
  ?? computeScenarioFeatures(grid.map(c => c.fuel));
const stepAgg = computeStepAggregates(grid, cellSizeMeters);
const hoursElapsed = stepNumber * timestepMinutes / 60;
const isDaytime = (hoursElapsed % 24) >= 6 && (hoursElapsed % 24) <= 18 ? 1 : 0;
const recentPrecip3Day = (config as any).recentPrecip3Day ?? 0;
const landCoverCode = (config as any).landCoverCode ?? 126;
```

Note: `(config as any)._scenarioFeatures` is an opt-in cache — runner.ts can attach it once before calling simulateStep to avoid recomputing per step. Optional optimization; not required for correctness.

**Step 2: Replace the 18-element feature vector at lines 117-136 with the new 27-element vector**

```typescript
const n1km = countBurningNeighbors(grid, nr, nc, gridSize, 2);
const n5km = countBurningNeighbors(grid, nr, nc, gridSize, 5);
const n10km = countBurningNeighbors(grid, nr, nc, gridSize, 10);

const features = [
  hoursElapsed,                    // 0  hours_since_start
  neighbor.lat,                    // 1  latitude
  neighbor.lng,                    // 2  longitude
  isDaytime,                       // 3  is_daytime
  encodeFuelType(neighbor.fuel),   // 4  fuel_type_enc
  (config as any).tempMean ?? 25,  // 5  temp_mean_c
  (config as any).tempMax ?? 35,   // 6  temp_max_c
  humidity,                        // 7  humidity_pct
  windSpeed,                       // 8  wind_speed_kmh
  windDirection,                   // 9  wind_direction_deg
  (config as any).precipitation ?? 0,      // 10 precipitation_mm
  (config as any).cumulativePrecip ?? 0,   // 11 cumulative_precip_mm
  n1km,                            // 12 neighbors_1km
  n5km,                            // 13 neighbors_5km
  n10km,                           // 14 neighbors_10km
  neighbor.elevation,              // 15 elevation_m
  scenarioFeatures.pctForest,      // 16 pct_forest
  scenarioFeatures.pctShrub,       // 17 pct_shrub
  scenarioFeatures.pctGrass,       // 18 pct_grass
  scenarioFeatures.pctUrban,       // 19 pct_urban
  scenarioFeatures.dominantFuelEnc, // 20 dominant_fuel_enc
  landCoverCode,                   // 21 land_cover_code
  stepAgg.currHotspotCount,        // 22 curr_hotspot_count
  stepAgg.currAreaKm2,             // 23 curr_area_km2
  stepAgg.currExtentNsKm,          // 24 curr_extent_ns_km
  stepAgg.currExtentEwKm,          // 25 curr_extent_ew_km
  recentPrecip3Day,                // 26 recent_precip_3day_mm
];

const mlProb = predictSpreadProbability(features);
```

**Step 3: Type-check**

Run: `npx tsc -b`
Expected: zero errors.

**Step 4: Run existing simulation tests**

Run: `npx vitest run src/simulation/`
Expected: all tests pass. (Existing tests don't load a real ML model, so they exercise the fallback Rothermel path; new feature vector code only runs when `useML` is true.)

**Step 5: Commit**

```bash
git add src/simulation/spread.ts
git commit -m "feat: wire 27-feature vector into ML inference path"
```

---

### Task B6: Atomic model swap — replace v1 with v2

**Files:**
- Modify: `src/data/xgboost_model.json` (replace contents with v2)

This is the swap. Once done, the running browser sim immediately uses v2.

**Step 1: Verify v2 exists and has the right feature count**

Run:

```bash
python3 -c "
import json
m = json.load(open('src/data/xgboost_model_v2.json'))
print('v2 features:', len(m['features']))
print('v2 trees:', len(m['trees']))
assert len(m['features']) == 27
print('OK')
"
```

Expected: prints feature count 27, tree count, "OK".

**Step 2: Back up v1 (just in case) and swap**

```bash
cp src/data/xgboost_model.json src/data/xgboost_model_v1.json.bak
cp src/data/xgboost_model_v2.json src/data/xgboost_model.json
ls -la src/data/xgboost_model*.json
```

**Step 3: Smoke-load it via Node**

```bash
node -e "
const m = require('./src/data/xgboost_model.json');
console.log('features:', m.features.length);
console.log('trees:', m.trees.length);
console.log('first feature:', m.features[0]);
"
```

Expected: features = 27, trees = (some number), first feature = "hours_since_start".

**Step 4: Commit**

```bash
git add src/data/xgboost_model.json src/data/xgboost_model_v1.json.bak
git commit -m "feat: swap browser model from v1 (18 features) to v2 (27 features)"
```

(`xgboost_model_v1.json.bak` lets you roll back instantly with `cp`. Delete it after a few days of stability.)

---

### Task B7: End-to-end smoke test in the dev server

**Files:** None modified — manual verification.

**Step 1: Start the dev server**

Run: `npm run dev`
Open the URL it prints in a browser. Open DevTools console.

**Step 2: Verify model loads**

Look in the console for the line "ML fire spread model loaded" (already logged by `useSimulation.ts:46`).

If you see a warning "ML model not loaded, using fallback": the v2 JSON failed to load. Check the network tab and the JSON's structure.

**Step 3: Run a preset scenario**

Pick the "Caldor Fire 2021" or any preset scenario in the sidebar. Click "Start". The fire should ignite and spread. Watch for:
- Spread does NOT explode in all directions instantly (over-prediction)
- Spread does NOT die out immediately (under-prediction)
- Wind direction visibly biases spread direction
- Higher humidity / precipitation slows spread

**Step 4: Compare against a different fuel scenario**

Run a forest-heavy vs grass-heavy preset. The v2 model uses `pct_forest`/`pct_grass` directly — behavior should differ noticeably from the same simulation under v1 (which couldn't distinguish them).

**Step 5: Document findings**

If behavior is reasonable: proceed. If clearly wrong (instant explosion or death): rollback by `cp src/data/xgboost_model_v1.json.bak src/data/xgboost_model.json` and investigate.

**Step 6: Commit a note (no file change, just close the loop)**

(No code change — this task is verification only. Skip the commit step.)

---

### Task B8: Remove the v1 backup once stable

**Files:**
- Delete: `src/data/xgboost_model_v1.json.bak`

**Step 1: Delete after at least one day of confidence**

```bash
rm src/data/xgboost_model_v1.json.bak
```

**Step 2: Commit**

```bash
git add src/data/xgboost_model_v1.json.bak
git commit -m "chore: remove v1 model backup after v2 stability confirmed"
```

(Do this only after Phase B7 confirms v2 behaves well in the running app. Until then, leave the .bak in place.)

---

## Final verification

### Task F1: Run all tests + type-check

```bash
cd /Users/mlstudio/projects/WildFireVisualization
npm run build       # tsc -b && vite build
npm test            # vitest run
python3 -m pytest scripts/tests/ -v
```

Expected: all green.

### Task F2: Read the training report

```bash
cat models/training_report.md
```

Verify the AUC-PR delta is positive and the per-fire scores aren't catastrophically low for any single test fire.

### Task F3: One final manual smoke test

Reload the dev server, run two presets, confirm both look reasonable.

---

## Done. Outputs:

- `src/data/xgboost_model.json` — v2, 27 features (replacing v1)
- `src/data/xgboost_model_v2.json` — same content (kept for clarity)
- `models/xgboost_v2.ubj` — native XGBoost binary
- `models/training_metadata.json` — feature list, params, all metrics
- `models/training_report.md` — readable summary, v1 vs v2 comparison
- `scripts/train_fire_spread_model.py` — re-runnable training pipeline
- `scripts/tests/test_tree_export.py` — round-trip correctness test
- New tests in `src/simulation/__tests__/spread.test.ts` for `computeScenarioFeatures` + `computeStepAggregates`
