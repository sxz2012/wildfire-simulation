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
