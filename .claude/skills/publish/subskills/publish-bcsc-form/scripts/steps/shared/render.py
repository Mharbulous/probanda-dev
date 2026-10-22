"""Render a filled .docx to PDF, report its true page count, and extract the
Form 32 assembled tail. Owned by publish-bcsc-form (the formatting skill) — the
Rule 8-1(4) 10-page cap is a property of the *rendered* document, so the true
count only exists after a real render.

Renderer selection: Microsoft Word via COM when available (Windows/local),
else LibreOffice `soffice` headless (Cowork/Linux). If neither is present this
hard-fails naming the missing renderer — never a word-count estimate. A fake
page count is worse than a hard failure the caller can act on (transparency).
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

from steps.shared.paths import next_free_path

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _WN(tag: str) -> str:
    return f"{{{W}}}{tag}"


class RendererUnavailable(RuntimeError):
    """No DOCX->PDF renderer is installed on this host."""


# ---------------------------------------------------------------------------
# Render + page count
# ---------------------------------------------------------------------------

def render_to_pdf(docx_path: Path) -> tuple[Path, int]:
    """Render docx_path to a sibling .pdf and return (pdf_path, page_count).

    An existing PDF is never replaced: the render goes to the first unused
    "<stem> vN.pdf" instead. Raises RendererUnavailable if no renderer is
    present.
    """
    docx_path = Path(docx_path).resolve()
    pdf_path = next_free_path(docx_path.with_suffix(".pdf"))
    if _has_word():
        return _render_word(docx_path, pdf_path)
    if _has_powershell_word():
        return _render_word_powershell(docx_path, pdf_path)
    soffice = _find_soffice()
    if soffice:
        return _render_soffice(soffice, docx_path, pdf_path)
    raise RendererUnavailable(
        "No DOCX->PDF renderer available: neither Microsoft Word COM "
        "(native Python or PowerShell) nor LibreOffice (soffice) was found. The Rule 8-1(4) page count is a "
        "property of the rendered document and cannot be estimated — install a "
        "renderer or assemble on a host that has one.")


def _has_word() -> bool:
    if os.name != "nt":
        return False
    try:
        import win32com.client  # noqa: F401
        return True
    except ImportError:
        return False


def _has_powershell_word() -> bool:
    if os.name != "nt" or shutil.which("powershell") is None:
        return False
    candidates = (
        Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "Microsoft Office" / "root" / "Office16" / "WINWORD.EXE",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
        / "Microsoft Office" / "root" / "Office16" / "WINWORD.EXE",
    )
    return any(candidate.is_file() for candidate in candidates)


def _render_word_powershell(
    docx_path: Path,
    pdf_path: Path,
) -> tuple[Path, int]:
    script = (
        '$ErrorActionPreference = "Stop"\n'
        '$word = New-Object -ComObject Word.Application\n'
        '$word.Visible = $false\n'
        'try {\n'
        '    $doc = $word.Documents.Open($env:COCLERK_RENDER_DOCX)\n'
        '    $doc.ExportAsFixedFormat($env:COCLERK_RENDER_PDF, 17)\n'
        '    $doc.Close([ref]$false)\n'
        '} finally {\n'
        '    $word.Quit()\n'
        '}\n'
    )
    environment = {
        **os.environ,
        "COCLERK_RENDER_DOCX": str(docx_path),
        "COCLERK_RENDER_PDF": str(pdf_path),
    }
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        timeout=180,
        env=environment,
    )
    if completed.returncode != 0 or not pdf_path.is_file():
        raise RuntimeError(
            "Word PowerShell COM rendering failed: "
            f"rc={completed.returncode} stdout={completed.stdout.strip()!r} "
            f"stderr={completed.stderr.strip()!r}"
        )
    return pdf_path, _count_pdf_pages(pdf_path)


def _render_word(docx_path: Path, pdf_path: Path) -> tuple[Path, int]:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    word = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        doc = word.Documents.Open(str(docx_path), ReadOnly=True)
        try:
            doc.ExportAsFixedFormat(str(pdf_path), 17)  # 17 = wdExportFormatPDF
            doc.Repaginate()
            page_count = int(doc.ComputeStatistics(2))  # 2 = wdStatisticPages
        finally:
            doc.Close(False)
    finally:
        if word is not None:
            word.Quit()
        pythoncom.CoUninitialize()
    if not pdf_path.exists():
        raise RuntimeError(f"Word produced no PDF: {pdf_path}")
    return pdf_path, page_count


def _find_soffice() -> str | None:
    for name in ("soffice", "libreoffice", "soffice.bin"):
        found = shutil.which(name)
        if found:
            return found
    for guess in (r"C:\Program Files\LibreOffice\program\soffice.exe",
                  "/usr/bin/soffice", "/usr/bin/libreoffice"):
        if Path(guess).exists():
            return guess
    return None


def _render_soffice(soffice: str, docx_path: Path, pdf_path: Path) -> tuple[Path, int]:
    with tempfile.TemporaryDirectory() as outdir:
        subprocess.run(
            [soffice, "--headless", "--convert-to", "pdf", "--outdir",
             outdir, str(docx_path)],
            check=True, capture_output=True, timeout=180)
        produced = Path(outdir) / (docx_path.stem + ".pdf")
        if not produced.exists():
            raise RuntimeError(f"soffice produced no PDF for {docx_path}")
        shutil.move(str(produced), str(pdf_path))
    return pdf_path, _count_pdf_pages(pdf_path)


def _count_pdf_pages(pdf_path: Path) -> int:
    """Count pages with no external dependency: the /Pages tree /Count, then a
    /Type /Page leaf-object fallback."""
    data = Path(pdf_path).read_bytes()
    counts = [int(m) for m in re.findall(
        rb"/Type\s*/Pages\b[^>]*?/Count\s+(\d+)", data)]
    counts += [int(m) for m in re.findall(
        rb"/Count\s+(\d+)[^>]*?/Type\s*/Pages\b", data)]
    if counts:
        return max(counts)
    leaves = len(re.findall(rb"/Type\s*/Page(?![s])", data))
    if leaves:
        return leaves
    raise RuntimeError(f"could not determine page count from PDF: {pdf_path}")


# ---------------------------------------------------------------------------
# Form 32 tail extraction
# ---------------------------------------------------------------------------

# The assembled Form 32 tail — the closing/appointment endorsement, the
# signature/date block, and the address-for-service block — begins at this
# endorsement paragraph and runs to the end of the document body. It is static
# template content (only the fill above touches Parts 1-4), so this marker is
# stable across every assembled Form 32.
_FORM32_TAIL_MARKER = "TO THE PERSONS RECEIVING THIS NOTICE OF APPLICATION"


def extract_form32_tail(docx_path: Path) -> str:
    """Return the assembled Form 32 tail block as plain text (paragraph and
    table-cell text, one line each), for a truthful G6 whole-form preview
    without the caller knowing the template's structure."""
    with zipfile.ZipFile(docx_path) as z:
        root = etree.fromstring(z.read("word/document.xml"))
    body = root.find(_WN("body"))
    lines: list[str] = []
    in_tail = False
    for el in body:
        if el.tag == _WN("sectPr"):
            break
        text = "".join(t.text or "" for t in el.iter(_WN("t")))
        if not in_tail and text.startswith(_FORM32_TAIL_MARKER):
            in_tail = True
        if in_tail and text.strip():
            lines.append(text.strip())
    return "\n".join(lines)


def page_limit_advisories(form: str, rule: str, page_count: int, cover: bool) -> list[str]:
    """The 10-page limit of Rule 8-1(4) and (10) as an advisory: it never blocks the publish. The NOT
    FINAL cover page is not counted. A Form 32 draft order is a separate document, never in the
    rendered form, so it is not counted either."""
    pages = page_count - (1 if cover else 0)
    if pages <= 10:
        return []
    return [f"{form} runs to {pages} pages, over the 10-page limit of {rule}; "
            "the cover page is not counted (advisory only)"]
