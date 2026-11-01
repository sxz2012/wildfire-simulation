"""Record the robot-dog mock simulation: video + poster still.

Needs both dev servers: `npx vite --port 5199` and `npm run server`.
Run from the repo root: python3 -I docs/poster/scripts/record_robot_demo.py

Writes docs/poster/media/robot-dog-demo.mp4 and docs/poster/img/robot-mock.jpg.
"""
import math
import pathlib
import shutil
import subprocess
import tempfile
import time

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
VIDEO = ROOT / "docs/poster/media/robot-dog-demo.mp4"
STILL = ROOT / "docs/poster/img/robot-mock.jpg"
APP = "http://localhost:5199/"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"

BURN_TO_STEP = 60      # let the fire grow ~15 sim-hours before the dog sets out
FLANK_M = 1500         # staging sits this far beyond the fire's side edge
TARGET_M = 1500        # target sits this far beyond the opposite side edge
SHIFT_AFTER_S = 7      # wind shift ~half-way along the outbound route
MAX_RUN_S = 40
STILL_CROP = (700, 120, 1910, 960)  # fire, both paths and the robot HUD


def cell_ll(info, row, col):
    n, size = info["gridSize"], info["cellSizeMeters"]
    lat0, lng0 = info["center"]["lat"], info["center"]["lng"]
    return {
        "lat": lat0 + (row - n / 2) * size / 111320,
        "lng": lng0 + (col - n / 2) * size / (111320 * math.cos(math.radians(lat0))),
    }


def placements(info):
    """Staging and target on opposite flanks of the fire, so the route must bend around it."""
    c, size = info["centroid"], info["cellSizeMeters"]
    spread = math.radians(info["windDirection"] + 180)  # direction the fire moves
    side = (-math.sin(spread), math.cos(spread))         # (row, col) across the wind
    edge = info["headEdgeCells"]
    s, t = edge + FLANK_M / size, edge + TARGET_M / size
    staging = cell_ll(info, c["row"] + side[0] * s, c["col"] + side[1] * s)
    target = cell_ll(info, c["row"] - side[0] * t, c["col"] - side[1] * t)
    return staging, target


with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=False, args=["--window-size=1950,1150"])
    ctx = browser.new_context(
        viewport={"width": 1920, "height": 1080},
        record_video_dir=tmp,
        record_video_size={"width": 1920, "height": 1080},
    )
    t_video = time.time()
    pg = ctx.new_page()
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
    pg.get_by_role("button", name="0.25x", exact=True).click()
    t_start = time.time()
    err = pg.evaluate("([s, t]) => window.__robotDemo.start(s, t)", [staging, target])
    if err:
        raise SystemExit(f"start failed: {err}")

    shifted = still_saved = sped_up = False
    while time.time() - t_start < MAX_RUN_S:
        st = pg.evaluate("window.__robotDemo.state()")
        print(f"{time.time() - t_start:5.1f}s {st}", flush=True)
        if not shifted and time.time() - t_start >= SHIFT_AFTER_S:
            pg.evaluate("window.__robotDemo.shiftWind()")
            shifted = True
        if not still_saved and (st["replanCount"] > 0 or st["phase"] == "retreating"):
            time.sleep(1.5)  # let the new route and escape path draw
            shot = pathlib.Path(tmp) / "still.png"
            pg.screenshot(path=str(shot))
            Image.open(shot).convert("RGB").crop(STILL_CROP).save(STILL, quality=90)
            still_saved = True
        if not sped_up and st["phase"] == "returning":
            pg.get_by_role("button", name="0.5x", exact=True).click()  # story told; walk home faster
            sped_up = True
        if st["phase"] == "done":
            time.sleep(2)
            break
        time.sleep(0.5)
    t_end = time.time()
    video_path = pg.video.path()
    ctx.close()
    browser.close()

    if not still_saved:
        raise SystemExit("no re-plan or retreat happened — nothing to show")
    VIDEO.parent.mkdir(parents=True, exist_ok=True)
    start = max(0.0, t_start - t_video - 1.0)
    subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-ss", f"{start:.1f}", "-t", f"{t_end - t_start + 1.0:.1f}",
         "-i", video_path, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(VIDEO)],
        check=True,
    )
    print(f"wrote {VIDEO.relative_to(ROOT)} ({t_end - t_start + 1.0:.0f} s) and {STILL.relative_to(ROOT)}")
