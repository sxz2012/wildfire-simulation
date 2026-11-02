"""Record the robot-dog mock simulation: video + poster still.

Needs both dev servers: `npx vite --port 5199` and `npm run server`.
Run from the repo root: python3 -I docs/poster/scripts/record_robot_demo.py

Writes docs/poster/media/robot-dog-demo.mp4 (captioned with the six mission beats
the poster's centre panel lists) and one caption-free still per loop step:
docs/poster/img/step2-route.jpg, step3-escape.jpg, step4-scout.jpg, step5-feedback.jpg.
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
IMG = ROOT / "docs/poster/img"
APP = "http://localhost:5199/"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"

BURN_TO_STEP = 60      # let the fire grow ~15 sim-hours before the dog sets out
FLANK_M = 1500         # staging sits this far beyond the fire's side edge
TARGET_M = 600        # target beyond the opposite side edge; the dog scouts from 100 m short of the predicted fire
SHIFT_AFTER_S = 5      # true-wind shift early in the outbound walk
MAX_RUN_S = 50
MAP_CROP = (560, 140, 1600, 920)    # 4:3 — fire, staging, target and both paths
HUD_CROP = (700, 100, 1910, 1000)   # map plus the robot HUD and readings card

CAPTION_JS = """([beat, label, text]) => {
  let el = document.getElementById('demo-caption');
  if (!el) {
    el = document.createElement('div');
    el.id = 'demo-caption';
    el.style.cssText = 'position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:99999;' +
      'max-width:1180px;padding:16px 28px;border-radius:14px;background:rgba(15,18,26,.88);color:#fff;' +
      'font:500 30px/1.3 system-ui,sans-serif;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.4);' +
      'pointer-events:none';
    document.body.appendChild(el);
  }
  const color = beat === 2 ? '#F28B30' : '#8DB4FF';
  el.innerHTML = '<span style="font-weight:800;color:' + color + '">' + beat + ' · ' + label + '</span><br>' + text;
}"""


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
    pg.get_by_role("button", name="0.25x", exact=True).evaluate("el => el.click()")
    err = pg.evaluate("([s, t]) => window.__robotDemo.start(s, t)", [staging, target])  # awaits the true-fire fork
    if err:
        raise SystemExit(f"start failed: {err}")
    t_start = time.time()  # the video starts once the dog sets out

    shifted = sped_up = False
    saved = {}
    beat = [0]  # current caption beat, 1–6
    beat_at = 0.0

    def caption(n, label, text):
        beat[0] = n
        pg.evaluate(CAPTION_JS, [n, label, text])

    def green_px(img):
        """Pixels of the escape-path green (#2E8540), to catch a frame where the lines are mid-redraw."""
        return sum(1 for r, g, b in img.getdata() if 30 < r < 80 and 110 < g < 160 and 45 < b < 95)

    def still(name, crop, need_green=False):
        pg.evaluate("document.getElementById('demo-caption')?.style.setProperty('visibility', 'hidden')")
        for _ in range(6):
            shot = pathlib.Path(tmp) / f"{name}.png"
            pg.screenshot(path=str(shot))
            img = Image.open(shot).convert("RGB").crop(crop)
            if not need_green or green_px(img.resize((260, 195))) > 40:
                break
            time.sleep(0.3)
        img.save(pathlib.Path(tmp) / f"{name}.jpg", quality=90)  # copied to the poster only if the take succeeds
        saved[name] = time.time() - t_start
        pg.evaluate("document.getElementById('demo-caption')?.style.setProperty('visibility', 'visible')")

    def match_txt(st):
        return f"{st['match']}%" if st["match"] is not None else "…"

    while time.time() - t_start < MAX_RUN_S:
        st = pg.evaluate("window.__robotDemo.state()")
        sim = pg.evaluate("window.__robotDemo.info()?.step") or 0
        print(f"{time.time() - t_start:5.1f}s {sim * 15 // 60:02d}:{sim * 15 % 60:02d} {st}", flush=True)
        elapsed = time.time() - t_start
        b = beat[0]
        # Captions follow what actually happens, with live numbers, so the video never disagrees with itself.
        if st["reports"] == 0 and not st["reporting"]:
            if not shifted:
                caption(1, "Launch", f"Route (blue) and escape path home (green) keep 100 m from the forecast fire. Forecast match {match_txt(st)}")
            else:
                caption(2, "Wind shifts", f"The true fire turns — the dog's forecast doesn't know yet. Forecast match drops to {match_txt(st)}")
        elif b < 3:
            where = ("At its scout spot, as close as the 100 m rule allows" if st["phase"] == "scouting"
                     else "On the way, the dog's sensors see the real fire coming closer than forecast")
            caption(3, "Measure", f"{where} — it measures the real wind, temperature, humidity and fire edge")
        if st["reports"] >= 1 and b < 4:
            before, after = st["lastReport"]
            caption(4, "Report", f"Forecast re-run on the dog's data. Forecast match {before}% → {after}%")
            beat_at = elapsed
        elif b == 4 and elapsed - beat_at >= 4:
            if st["phase"] == "returning":
                caption(5, "Re-plan", "The corrected forecast shows the fire coming: it cuts scouting short and heads home another way")
            else:
                caption(5, "Re-plan", "New route and escape path on the corrected forecast")
            beat_at = elapsed
        if b == 5 and st["phase"] == "scouting":
            caption(5, "Re-plan", "The corrected route reaches its scout spot, as close as the 100 m rule allows — scouting, then home")
        if b == 5 and st["phase"] == "returning" and elapsed - beat_at >= 4:
            caption(6, "Home safe", "Walking home on the corrected forecast, ahead of the fire")
        if st["phase"] == "done":
            caption(6, "Home safe", "Back at staging before the fire arrives")
        if "step2-route" not in saved and elapsed >= 2:
            still("step2-route", MAP_CROP)
        # The shift is refused while a report is in flight; keep asking until it lands.
        if not shifted and elapsed >= SHIFT_AFTER_S and st["phase"] in ("outbound", "scouting"):
            pg.evaluate("window.__robotDemo.shiftWind()")
            shifted = (pg.evaluate("window.__robotDemo.state()")["event"] or "").startswith("True wind")
            if shifted:
                shift_at = time.time() - t_start
        if "step5-feedback" not in saved and st["reports"] >= 1:
            still("step5-feedback", HUD_CROP)
        if shifted and "step3-escape" not in saved and st["reports"] == 0 and elapsed - shift_at >= 3:
            still("step3-escape", MAP_CROP, need_green=True)  # route ahead + arrowed escape path home
        if "step4-scout" not in saved and st["phase"] == "scouting":
            time.sleep(0.5)
            still("step4-scout", MAP_CROP, need_green=True)
        if not sped_up and st["phase"] == "returning":
            pg.get_by_role("button", name="0.5x", exact=True).evaluate("el => el.click()")  # story told; walk home faster
            sped_up = True
        if st["phase"] == "done":
            time.sleep(2)
            break
        time.sleep(0.5)
    t_end = time.time()
    video_path = pg.video.path()
    ctx.close()
    browser.close()

    missing = {"step2-route", "step3-escape", "step4-scout", "step5-feedback"} - saved.keys()
    if missing or not shifted:
        raise SystemExit(f"story incomplete: shifted={shifted}, missing stills {sorted(missing)}")
    for name in saved:
        shutil.copy(pathlib.Path(tmp) / f"{name}.jpg", IMG / f"{name}.jpg")
    VIDEO.parent.mkdir(parents=True, exist_ok=True)
    start = max(0.0, t_start - t_video - 1.0)
    subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-ss", f"{start:.1f}", "-t", f"{t_end - t_start + 1.0:.1f}",
         "-i", video_path, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(VIDEO)],
        check=True,
    )
    print(f"wrote {VIDEO.relative_to(ROOT)} ({t_end - t_start + 1.0:.0f} s) and stills {sorted(saved)}")
