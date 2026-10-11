"""Stage 2 of assemble-affidavit: add a centered arabic footer page number
to every page of a user-approved draft PDF.

CLI: python paginate.py <input.json path>
     python paginate.py   (reads JSON from stdin)

Input JSON: {"input_pdf": "...", "output_path": "..."}
Output JSON: {"success": true, "output_path": "...", "versioned_from"?: "...", "page_count": N}
(same structured error envelope as the other scripts on failure)

output_path's folder must exist (else no_output_dir); it is never created. An
existing file is never overwritten: output_path's own name counts as v1 and
`<stem> vN.pdf` as vN, so with none present output_path is written, else
v(highest + 1), reported as "output_path", and "versioned_from" names the
highest existing copy. The PDF is saved to a `~`-prefixed temporary file in
the same folder and then renamed.
"""
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common

try:
    import pymupdf as fitz
except ImportError as exc:  # refuse in this script's JSON contract, not as a traceback
    common.emit({"success": False, "error": "missing_dependency", "detail": (
        f"{exc.name or exc} is not installed. This script runs on the PC, in a Claude Code "
        "session in the desktop app's Code tab, where the Probanda plugin is installed "
        "-- not in a Cowork cloud sandbox, which has no PyMuPDF and blocks pypi. "
        "On the PC, install it: "
        "pip install PyMuPDF")}, False)

FOOTER_FONTSIZE = 10.0
FOOTER_BOTTOM_MARGIN = 36.0  # 0.5 inch


def main():
    data = common.read_input_json()

    body_font_path = common.resolve_font("body")
    if isinstance(body_font_path, dict):
        return body_font_path

    input_pdf = Path(data["input_pdf"])
    output_path = Path(data["output_path"])
    if not output_path.parent.is_dir():
        return {"success": False, "error": "no_output_dir",
                "detail": f"{output_path.parent} is not a folder; it is never created here"}

    scratch_dir = Path(tempfile.mkdtemp(prefix="affpag_"))
    try:
        # Read-only source: never mutate the caller's file. Work on a copy.
        work_copy = scratch_dir / input_pdf.name
        shutil.copy2(input_pdf, work_copy)

        doc = fitz.open(str(work_copy))
        measure_font = fitz.Font(fontfile=body_font_path)
        fontname = "aa2pagenum"

        for page in doc:
            page_num = page.number + 1
            text = str(page_num)
            text_width = measure_font.text_length(text, fontsize=FOOTER_FONTSIZE)
            x = page.rect.width / 2 - text_width / 2
            y = page.rect.height - FOOTER_BOTTOM_MARGIN
            page.insert_text(
                (x, y), text, fontsize=FOOTER_FONTSIZE, fontfile=body_font_path,
                fontname=fontname, color=(0, 0, 0),
            )

        output_path, prior = common.save_new(output_path, lambda tmp: doc.save(str(tmp)))
        page_count = doc.page_count
        doc.close()

        result = {"success": True, "output_path": str(output_path), "page_count": page_count}
        if prior:
            result["versioned_from"] = str(prior)
        return result
    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)


if __name__ == "__main__":
    try:
        result = main()
        common.emit(result, result.get("success", False))
    except Exception:
        common.emit(
            {"success": False, "error": "unexpected_exception", "detail": traceback.format_exc()},
            False,
        )
