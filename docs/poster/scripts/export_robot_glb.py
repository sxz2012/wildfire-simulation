"""Export the three.js robot-dog model to public/models/robot-dog.glb.

Run from the repo root: python3 -I docs/poster/scripts/export_robot_glb.py
"""
import base64
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
PAGE = ROOT / "docs/poster/src/robot-dog-3d.html"
OUT = ROOT / "public/models/robot-dog.glb"

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=angle", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 400, "height": 300})
    page.goto(PAGE.as_uri())
    page.wait_for_function("window.__done === true", timeout=60000)
    data = base64.b64decode(page.evaluate("window.__exportGlb()"))
    browser.close()

OUT.write_bytes(data)
print(f"wrote {OUT.relative_to(ROOT)} ({len(data) / 1024:.0f} KB)")
