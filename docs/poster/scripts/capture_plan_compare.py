"""Capture the left panel's two real screenshots: the same mission planned on the fire now and on the predicted fire.

Needs both dev servers: `npx vite --port 5199` and `npm run server`.
Run from the repo root: python3 -I docs/poster/scripts/capture_plan_compare.py

Same Big Sur fire, staging and target as record_robot_demo.py. Both routes are drawn at the
step the dog on the fire-now route would reach the first spot the forecast fire got to first. Writes
docs/poster/img/plan-fire-now.jpg, plan-fire-now-later.jpg and plan-predicted-later.jpg.
"""
import math
import pathlib
import time

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
IMG = ROOT / "docs/poster/img"
APP = "http://localhost:5199/"

# Same scene as record_robot_demo.py (that script records on import, so the values are repeated here).
BURN_TO_STEP = 60
FLANK_M = 1500
TARGET_M = 600        # target beyond the opposite side edge; the dog scouts from 100 m short of the predicted fire
MAP_CROP = (560, 140, 1600, 920)
ZOOM_CROP = (1000, 330, 1480, 690)   # 4:3 close-up of the fire's east flank, where the two routes part


def cell_ll(info, row, col):
    n, size = info["gridSize"], info["cellSizeMeters"]
    lat0, lng0 = info["center"]["lat"], info["center"]["lng"]
    return {
        "lat": lat0 + (row - n / 2) * size / 111320,
        "lng": lng0 + (col - n / 2) * size / (111320 * math.cos(math.radians(lat0))),
    }


def placements(info):
    """Staging and target on opposite flanks of the fire, as in record_robot_demo.py."""
    c, size = info["centroid"], info["cellSizeMeters"]
    spread = math.radians(info["windDirection"] + 180)
    side = (-math.sin(spread), math.cos(spread))
    edge = info["headEdgeCells"]
    s, t = edge + FLANK_M / size, edge + TARGET_M / size
    staging = cell_ll(info, c["row"] + side[0] * s, c["col"] + side[1] * s)
    target = cell_ll(info, c["row"] - side[0] * t, c["col"] - side[1] * t)
    return staging, target

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=False, args=["--window-size=1950,1150"])
    pg = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=2).new_page()
    pg.goto(APP)
    time.sleep(8)
    pg.get_by_role("button", name="Simulate").first.click()
    time.sleep(1)
    pg.get_by_role("button", name="Seasonal").first.click()
    pg.get_by_placeholder("Search a location...").fill("Big Sur")
    time.sleep(3)
    pg.get_by_text("California").first.click()
    time.sleep(12)
    pg.mouse.click(1250, 600)
    time.sleep(2)
    pg.get_by_role("button", name="Start the Wildfire").click()
    pg.wait_for_function(
        f"window.__robotDemo && (window.__robotDemo.info()?.step ?? 0) >= {BURN_TO_STEP}", timeout=240000
    )
    pg.locator("div.fire-panel.bottom-3 button").first.click()  # pause
    time.sleep(2)
    pg.locator("div.fire-panel.top-3 button").first.click()  # collapse the control panel
    pg.add_style_tag(content=".briefing-enter { display: none !important; }")
    pg.get_by_role("button", name="🐕 Robot Dog").click()
    time.sleep(2)
    staging, target = placements(pg.evaluate("window.__robotDemo.info()"))
    res = pg.evaluate("([s, t]) => window.__robotDemo.compare(s, t)", [staging, target])
    print("compare:", res)
    if isinstance(res, str) or res["crossStep"] is None:
        raise SystemExit("no crossing: the route planned on the fire now stays clear of the forecast fire")

    def shot(which, step, name):
        pg.evaluate("([w, s]) => window.__robotDemo.show(w, s)", [which, step])
        time.sleep(4)  # let the fire layer and route redraw
        path = IMG / f"{name}.png"
        pg.screenshot(path=str(path))
        img = Image.open(path).convert("RGB")
        img.crop(tuple(2 * v for v in MAP_CROP)).save(IMG / f"{name}.jpg", quality=90)
        img.crop(tuple(2 * v for v in ZOOM_CROP)).save(IMG / f"{name}-zoom.jpg", quality=90)
        path.unlink()

    shot("now", res["nowStep"], "plan-fire-now")
    shot("now", res["dogMeetsFireStep"], "plan-fire-now-later")
    shot("predicted", res["dogMeetsFireStep"], "plan-predicted-later")
    browser.close()
    later = (res["dogMeetsFireStep"] - res["nowStep"]) * 15
    print(f"wrote plan-fire-now, plan-fire-now-later and plan-predicted-later ({later} min later)")
