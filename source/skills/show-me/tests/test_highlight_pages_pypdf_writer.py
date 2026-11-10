"""highlight_pages.py paints its overlay on a page the writer owns.

pypdf 7.0.0 removed merging into a page that no writer holds (pypdf 6.x warned
with a DeprecationWarning first). The script runs here with that warning made an
error, so the check holds under either pypdf version.
"""

import subprocess
import sys
from pathlib import Path

from pypdf import PdfReader
from reportlab.pdfgen import canvas

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "highlight_pages.py"


def test_painting_a_paragraph_uses_a_writer_owned_page(tmp_path):
    source = tmp_path / "sample.pdf"
    c = canvas.Canvas(str(source), pagesize=(612, 792))
    c.setFont("Helvetica", 12)
    for row, text in enumerate(["[1] An invented first paragraph.", "[2] An invented second one."]):
        c.drawString(72, 720 - row * 24, text)
    c.showPage()
    c.save()
    out = tmp_path / "out.pdf"
    result = subprocess.run(
        [sys.executable, "-W", "error::DeprecationWarning", str(SCRIPT), str(source),
         "--out", str(out), "--para", "1", "yellow"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr[-400:]
    assert len(PdfReader(out).pages) == 1
