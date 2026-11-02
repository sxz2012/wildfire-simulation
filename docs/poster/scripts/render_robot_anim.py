"""Render the animated robot-dog shots in docs/poster/src/robot-dog-anim.html to MP4 clips.

Run from the repo root:
  python3 -I docs/poster/scripts/render_robot_anim.py [shot ...] [--stills]
Writes docs/poster/media/anim/<shot>.mp4 (1920x1080, 30 fps). --stills writes one PNG per shot instead.
"""
import base64
import pathlib
import shutil
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
PAGE = ROOT / "docs/poster/src/robot-dog-anim.html"
OUT = ROOT / "docs/poster/media/anim"
FPS = 30

args = [a for a in sys.argv[1:] if not a.startswith("--")]
stills = "--stills" in sys.argv
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    page.goto(PAGE.as_uri())
    page.wait_for_function("window.__ready === true", timeout=120000)
    shots = page.evaluate("window.SHOTS")
    for shot in args or list(shots):
        dur = shots[shot]
        if stills:
            for i, t in enumerate((0.5, dur / 2, dur - 0.5)):
                data = page.evaluate(f"(renderFrame({shot!r}, {t}), document.querySelector('canvas').toDataURL('image/jpeg', 0.9))")
                (OUT / f"{shot}-{i}.jpg").write_bytes(base64.b64decode(data.split(",", 1)[1]))
            print("stills", shot)
            continue
        tmp = pathlib.Path(tempfile.mkdtemp())
        for f in range(int(dur * FPS)):
            data = page.evaluate(f"(renderFrame({shot!r}, {f / FPS}), document.querySelector('canvas').toDataURL('image/jpeg', 0.93))")
            (tmp / f"{f:05d}.jpg").write_bytes(base64.b64decode(data.split(",", 1)[1]))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(tmp / "%05d.jpg"),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(OUT / f"{shot}.mp4")], check=True)
        shutil.rmtree(tmp)
        print("wrote", (OUT / f"{shot}.mp4").relative_to(ROOT))
    browser.close()
