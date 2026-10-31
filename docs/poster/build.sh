#!/usr/bin/env bash
# Render each tri-fold panel to a print-ready PDF at its exact size.
# Usage: bash docs/poster/build.sh   (outputs to docs/poster/out/)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/out"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p "$OUT"

for panel in left center right; do
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
    --virtual-time-budget=5000 \
    --print-to-pdf="$OUT/$panel.pdf" "file://$DIR/$panel.html" 2>/dev/null
  echo "wrote $OUT/$panel.pdf"
done
