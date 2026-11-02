"""Place the three poster panels side by side on one page: docs/poster/out/poster.pdf (48 x 36 in).

Run from the repo root after build.sh has written the panel PDFs:
  python3 -I docs/poster/scripts/combine_panels.py
The panels stay vector (pages are placed, not rasterised).
"""
import pathlib

from pypdf import PageObject, PdfReader, PdfWriter, Transformation

OUT = pathlib.Path(__file__).resolve().parents[1] / "out"

pages = [PdfReader(OUT / f"{name}.pdf").pages[0] for name in ("left", "center", "right")]
width = sum(float(p.mediabox.width) for p in pages)
height = max(float(p.mediabox.height) for p in pages)
sheet = PageObject.create_blank_page(width=width, height=height)
x = 0.0
for p in pages:
    sheet.merge_transformed_page(p, Transformation().translate(tx=x, ty=0))
    x += float(p.mediabox.width)

writer = PdfWriter()
writer.add_page(sheet)
writer.compress_identical_objects()
with open(OUT / "poster.pdf", "wb") as f:
    writer.write(f)
print(f"wrote {OUT / 'poster.pdf'} ({width / 72:.0f} x {height / 72:.0f} in)")
