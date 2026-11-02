#!/usr/bin/env bash
# Render each tri-fold panel to a print-ready PDF at its exact size.
# Usage: bash docs/poster/build.sh   (outputs to docs/poster/out/)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/out"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p "$OUT"

# The poster (Swiss style), then the alternative styles kept under alternatives/ (PDFs go to out/alternatives/...).
for panel in left center right \
             alternatives/classic/left alternatives/classic/center alternatives/classic/right \
             alternatives/classic/center-comic alternatives/classic/center-map \
             alternatives/betterposter/left alternatives/betterposter/center alternatives/betterposter/right \
             alternatives/journal/left alternatives/journal/center alternatives/journal/right; do
  mkdir -p "$(dirname "$OUT/$panel.pdf")"
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
    --virtual-time-budget=5000 \
    --print-to-pdf="$OUT/$panel.pdf" "file://$DIR/$panel.html" 2>/dev/null
  echo "wrote $OUT/$panel.pdf"
done

# All three panels on one 48 x 36 in page, for printing as a single poster.
python3 -I "$DIR/scripts/combine_panels.py"
