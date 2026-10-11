"""Stage 1 of assemble-affidavit: convert affidavit DOCX, stamp exhibits,
rewrite header/jurat, concatenate into one draft PDF.

CLI:
  python assemble.py <input.json path>
  python assemble.py --probe <docx path>
  python assemble.py            (reads main input JSON from stdin)

Main input JSON schema (all fields required):
{
  "affiant_name": "string",
  "affidavit_number": 2,
  "jurat_verb": "AFFIRMED",
  "signing_date": "2026-06-10",
  "affidavit_pdf": "path to .docx or .pdf",
  "header_bbox": [x0, y0, x1, y1],   // null for an affidavit of service
  "jurat_bbox": [72, 325, 340, 370],
  "exhibits": [{"letter": "A", "path": "..."}],
  "name_affiant_on_stamps": false,
  "output_path": "..."
}

header_bbox is required but nullable. Rule 22-2(3) requires the top-right
identifier block on every affidavit OTHER THAN an affidavit of service, and
Forms 15 and 16 carry none, so `"header_bbox": null` means "no identifier
block to rewrite" and the header pass is skipped. Omitting the key entirely is
a caller error, not a way to opt out. affiant_name, affidavit_number and
signing_date are still used by the jurat pass and stay required.

output_path's folder must exist (else no_output_dir); it is never created. An
existing file is never overwritten: output_path's own name counts as v1 and
`<stem> vN.pdf` as vN, so with none present output_path is written, else
v(highest + 1), and the result's "output_path" names the file written and
"versioned_from" the highest existing copy. The PDF is saved to a `~`-prefixed
temporary file in the same folder and then renamed.

--probe <docx> mode converts the DOCX to PDF in a scratch dir (left in
place, not cleaned up, so the agent can reuse it) and returns a computed
header_bbox: {"success": true, "header_bbox": [...], "converted_pdf": "..."}.
When the top-right region holds no identifier block, it returns
"header_bbox": null with a "note" rather than a bbox over the court file
number and registry.

Every failure path emits {"success": false, "error": "<code>", "detail": "..."}
(plus extra fields like "which" or "file" where noted in the plan).
"""
import gc
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common

try:
    import pymupdf as fitz
    import numpy as np
except ImportError as exc:  # refuse in this script's JSON contract, not as a traceback
    common.emit({"success": False, "error": "missing_dependency", "detail": (
        f"{exc.name or exc} is not installed. This script runs on the PC, in a Claude Code "
        "session in the desktop app's Code tab, where the Probanda plugin is installed "
        "-- not in a Cowork cloud sandbox, which has no PyMuPDF and blocks pypi. "
        "On the PC, install it: "
        "pip install PyMuPDF numpy")}, False)

STAMP_ONLY_PATTERN = common.STAMP_ONLY_PATTERN

STAMP_WIDTH = 211.09
STAMP_HEIGHT = 116.05
STAMP_SCALE = 1.25
STAMP_MARGIN = 18.0
GRID_CELL = 4.0

STAMP_LINE_OFFSETS = [
    (0.8, 1.1),
    (0.8, 14.3),
    (0.8, 27.5),
    (4.2, 53.9),
    (1.8, 67.1),
    (4.7, 80.3),
]


# The Form 109 identifier block ("This is the 2nd affidavit / of X in this
# case / and was made on ..."). Deliberately matched on Form 109's wording,
# not on the three R. 22-2(3) data items generically: every affidavit that
# reaches this pipeline is the firm's own, drafted on the LEAP or /publish
# Form 109 template (STATE 0 admits only a .docx from 0. DRAFT/), and
# rewrite_header re-renders the block in Form 109 wording anyway. Matched by
# content because the top-right of page 1 also holds the court file number
# and registry, which must never be redacted.
# Forms 15 and 16 carry no block (R. 22-2(3) excepts an affidavit of
# service), so no match is a legitimate document shape. An affidavit that
# states the three items in other words is also no match: the block is left
# as drafted and the run warns, it is never redacted on a guess.
# Returns the block's lines, each a list of words: on every baseline, only the
# run of words ending rightmost (the right-aligned identifier text), so a label
# at the left on the same baseline is not part of the block. A baseline whose
# run does not overlap the first line's horizontally (a left-margin label set
# between the identifier lines) is not part of it either.
def _identifier_lines(words):
    block = []
    for line in _cluster_lines(words):
        run = _word_runs(line["words"])[-1]
        s = " ".join(w[4] for w in run).lower()
        if block and run[-1][2] < block[0][0][0]:
            continue
        if block or ("this is the" in s and "affidavit" in s):
            block.append(run)
            if "made on" in s:
                return block
    return []


# A word space at the template's 12pt is about 3.3pt, so an 18pt (1.5 em) gap
# never falls inside a line of words but splits off text that merely shares
# the baseline, such as a "FORM 109" label at the left margin.
RUN_GAP = 18.0


def _word_runs(line_words):
    """Split one baseline's words, left to right, wherever the gap between
    neighbours exceeds RUN_GAP."""
    runs = []
    for w in sorted(line_words, key=lambda w: w[0]):
        if not runs or w[0] - runs[-1][-1][2] > RUN_GAP:
            runs.append([])
        runs[-1].append(w)
    return runs


# The prescribed jurat date line (Forms 15, 16, /publish 109): "British Columbia on
# ..[date or blank].. ." — the LEAP Form 109 idiom is "this .. day of .., ..".
PRESCRIBED_JURAT_DATE_PATTERN = re.compile(
    r'\bon\s+(?:[A-Z][a-z]+\.?\s+\d{1,2}|_+),\s*\d{4}')


class DocxConversionError(Exception):
    pass


class FontResolutionError(Exception):
    def __init__(self, role):
        self.role = role
        super().__init__(f"font not found for role: {role}")


def _resolve_font_or_raise(role):
    result = common.resolve_font(role)
    if isinstance(result, dict):
        raise FontResolutionError(role)
    return result


# ---------------------------------------------------------------------------
# DOCX -> PDF conversion
# ---------------------------------------------------------------------------

def _word_com_convert(docx_path, pdf_path):
    docx_path = str(Path(docx_path).resolve())
    pdf_path = str(Path(pdf_path).resolve())
    # Paths are passed via environment variables, never interpolated into the
    # script body — PowerShell's tokenizer treats $env:* references as opaque
    # values, so a path containing a quote or backtick can't break out.
    ps_script = (
        '$ErrorActionPreference = "Stop"\n'
        '$word = New-Object -ComObject Word.Application\n'
        '$word.Visible = $false\n'
        'try {\n'
        '    $doc = $word.Documents.Open($env:AFFASM_DOCX)\n'
        '    $doc.ExportAsFixedFormat($env:AFFASM_PDF, 17)\n'
        '    $doc.Close([ref]$false)\n'
        '} finally {\n'
        '    $word.Quit()\n'
        '}\n'
    )
    env = {**os.environ, "AFFASM_DOCX": docx_path, "AFFASM_PDF": pdf_path}
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
        capture_output=True, text=True, timeout=120, env=env,
    )
    if proc.returncode != 0 or not Path(pdf_path).is_file():
        raise RuntimeError(
            f"Word COM conversion failed: rc={proc.returncode} "
            f"stdout={proc.stdout.strip()!r} stderr={proc.stderr.strip()!r}"
        )
    return pdf_path


def _soffice_convert(docx_path, out_dir):
    docx_path = Path(docx_path)
    proc = subprocess.run(
        ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(docx_path)],
        capture_output=True, text=True, timeout=120,
    )
    pdf_path = Path(out_dir) / (docx_path.stem + ".pdf")
    if proc.returncode != 0 or not pdf_path.is_file():
        raise RuntimeError(
            f"soffice conversion failed: rc={proc.returncode} stderr={proc.stderr.strip()!r}"
        )
    return str(pdf_path)


def convert_docx_to_pdf(docx_path, out_dir):
    """Word COM (via PowerShell) first, soffice fallback. Raises
    DocxConversionError with both attempts' details if both fail."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / (Path(docx_path).stem + ".pdf")

    errors = []
    try:
        return _word_com_convert(docx_path, pdf_path)
    except Exception as e:
        errors.append(f"word_com: {e}")

    try:
        return _soffice_convert(docx_path, out_dir)
    except FileNotFoundError as e:
        errors.append(f"soffice: not found on PATH ({e})")
    except Exception as e:
        errors.append(f"soffice: {e}")

    raise DocxConversionError("; ".join(errors))


# ---------------------------------------------------------------------------
# --probe mode
# ---------------------------------------------------------------------------

HEADER_WINDOW_BOTTOM = 150  # page-1 words starting above this y can be the identifier block


def probe(docx_path):
    scratch_dir = Path(tempfile.mkdtemp(prefix="affasm_probe_"))
    try:
        pdf_path = convert_docx_to_pdf(docx_path, scratch_dir)
    except DocxConversionError as e:
        return {"success": False, "error": "docx_conversion_failed", "detail": str(e)}

    doc = fitz.open(pdf_path)
    try:
        page = doc[0]
        words = page.get_text("words")
        candidates = [w for w in words if w[1] < HEADER_WINDOW_BOTTOM]
        if not candidates:
            return {"success": False, "error": "bbox_validation_failed", "which": "header"}
        candidates = [w for line in _identifier_lines(candidates) for w in line]
        if not candidates:
            # An affidavit of service (Form 15/16) has no identifier block.
            # Returning a bbox here would point rewrite_header at the court
            # file number and registry and redact them.
            return {"success": True, "header_bbox": None,
                    "converted_pdf": str(pdf_path),
                    "note": ("no Form 109 identifier block ('This is the ... affidavit ... made on') found "
                             'in the top right of page 1; assemble with "header_bbox": null. '
                             "Expected for a Form 15 or Form 16 affidavit of service. On any "
                             "other affidavit the block is not recognised and will be left as "
                             "drafted: check its number and date by hand.")}
        x0 = min(w[0] for w in candidates) - 5
        y0 = min(w[1] for w in candidates) - 5
        x1 = max(w[2] for w in candidates) + 5
        y1 = max(w[3] for w in candidates) + 5
        bbox = [x0, y0, x1, y1]
    finally:
        doc.close()

    return {"success": True, "header_bbox": bbox, "converted_pdf": str(pdf_path)}


# ---------------------------------------------------------------------------
# Header rewrite
# ---------------------------------------------------------------------------

def rewrite_header(doc, data, body_font_path):
    page = doc[0]
    x0, y0, x1, y1 = data["header_bbox"]

    pad = 3
    check_rect = fitz.Rect(x0 - pad, y0 - pad, x1 + pad, y1 + pad)
    words = page.get_text("words")
    inside = [w for w in words if fitz.Rect(w[:4]).intersects(check_rect)]
    if not inside:
        return {"success": False, "error": "bbox_validation_failed", "which": "header"}

    # The bbox must cover the identifier block and nothing else. Redacting
    # anything more — the court file number and registry — destroys the style
    # of proceeding. And every identifier line it touches must lie wholly
    # inside it, or the redaction leaves fragments beside the redrawn line.
    # "Touches" uses the padded check_rect and containment the bbox itself, so
    # a near miss is refused rather than redacted.
    region_text = " ".join(
        w[4] for w in sorted(inside, key=lambda w: (round(w[1], 1), w[0])))
    block = _identifier_lines([w for w in words if w[1] < HEADER_WINDOW_BOTTOM])
    block_words = {w for line in block for w in line}
    bbox = fitz.Rect(x0, y0, x1, y1)
    touches_other_text = any(w not in block_words for w in inside)
    cuts_identifier_line = any(
        fitz.Rect(w[:4]) not in bbox
        for line in block if any(w in inside for w in line)
        for w in line)
    if touches_other_text or cuts_identifier_line:
        return {"success": False, "error": "header_bbox_not_identifier_block",
                "which": "header", "found_text": region_text[:200],
                "detail": ('header_bbox does not cover a Rule 22-2(3) identifier '
                           'block alone, or cuts through one of its lines. An '
                           'affidavit of service (Form 15/16) has none — '
                           'assemble with "header_bbox": null. Else re-probe.')}

    page.add_redact_annot(bbox, fill=(1, 1, 1))
    page.apply_redactions()

    signing_date = common.parse_date(data["signing_date"])
    lines = [
        f"This is the {common.ordinal(data['affidavit_number'])} affidavit",
        f"of {data['affiant_name']} in this case",
        f"and was made on {common.format_month_day_year(signing_date)}",
    ]
    right_x = 540.0
    ys = [y0 + 12.8, y0 + 26.6, y0 + 40.4]
    fontname = "aa2body"
    measure_font = fitz.Font(fontfile=body_font_path)

    for text, y in zip(lines, ys):
        text_width = measure_font.text_length(text, fontsize=12)
        x = right_x - text_width
        page.insert_text(
            (x, y), text, fontsize=12, fontfile=body_font_path, fontname=fontname, color=(0, 0, 0)
        )

    return {"success": True}


# ---------------------------------------------------------------------------
# Jurat rewrite
# ---------------------------------------------------------------------------

def _cluster_lines(words, y_tol=3.0):
    sorted_words = sorted(words, key=lambda w: (w[1], w[0]))
    lines = []
    for w in sorted_words:
        y_center = (w[1] + w[3]) / 2
        placed = False
        for line in lines:
            if abs(line["y_center"] - y_center) <= y_tol:
                line["words"].append(w)
                placed = True
                break
        if not placed:
            lines.append({"y_center": y_center, "words": [w]})

    for line in lines:
        line["text"] = " ".join(w[4] for w in sorted(line["words"], key=lambda w: w[0]))

    lines.sort(key=lambda l: l["y_center"])
    return lines


def _find_jurat_page(doc, jurat_verb):
    other_verb = "SWORN" if jurat_verb == "AFFIRMED" else "AFFIRMED"
    verb_pat = re.compile(rf'{jurat_verb}\s+BEFORE\s+ME', re.IGNORECASE)
    other_pat = re.compile(rf'{other_verb}\s+BEFORE\s+ME', re.IGNORECASE)
    bare_pat = re.compile(r'BEFORE\s+ME', re.IGNORECASE)
    verb_anywhere_pat = re.compile(jurat_verb, re.IGNORECASE)

    for page_idx in range(doc.page_count):
        text = doc[page_idx].get_text()
        if verb_pat.search(text) or other_pat.search(text):
            return page_idx
        if bare_pat.search(text) and verb_anywhere_pat.search(text):
            return page_idx
    return None


def _get_line_font_size(page, bbox, default=12.0):
    d = page.get_text("dict", clip=fitz.Rect(bbox))
    sizes = []
    for block in d.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                sizes.append(span["size"])
    return max(sizes) if sizes else default


# The jurat table's middle column is a stack of ")" glyphs. A city or date line is
# redacted and rewritten only left of its ")", so the bracket and any right-hand
# column text on the same baseline survive (#1429). Returns the line's words left
# of the bracket and the bracket's x, or all its words and None when it has no ")".
def _left_of_bracket(line_words):
    bracket_words = [w for w in line_words if w[4].strip() == ")"]
    if not bracket_words:
        return line_words, None
    bracket_x = min(w[0] for w in bracket_words)
    return [w for w in line_words if w[2] <= bracket_x], bracket_x


def _words_bbox(ws):
    return [min(w[0] for w in ws), min(w[1] for w in ws),
            max(w[2] for w in ws), max(w[3] for w in ws)]


def rewrite_jurat(doc, data, body_font_path):
    warnings = []
    page_idx = _find_jurat_page(doc, data["jurat_verb"])
    if page_idx is None:
        page_idx = doc.page_count - 1
        warnings.append("jurat page not found by text search; falling back to last page")

    page = doc[page_idx]
    words = page.get_text("words")

    # Strictly the requested verb: a mismatch here means jurat_verb doesn't
    # match the document, which is itself a bbox_validation_failed signal
    # (see references/assembly.md's error-branching guidance for "which":
    # "jurat" -- the page-finding fallback above is lenient about which verb
    # locates the page, but the word search here must not be, or a wrong
    # jurat_verb would silently produce a mislabelled stamp). The verb is the
    # one followed by "BEFORE ME", as in _find_jurat_page, wherever it sits on
    # the page, so a verb in the body is never the anchor (#1430).
    verb_lower = "affirmed" if data["jurat_verb"] == "AFFIRMED" else "sworn"
    texts = [w[4].lower().strip(".,:;\"'") for w in words]
    verb_word = None
    for i, w in enumerate(words):
        if texts[i:i + 3] == [verb_lower, "before", "me"]:
            verb_word = w
            break
    if verb_word is None:
        return {"success": False, "error": "bbox_validation_failed", "which": "jurat", "check": "verb"}

    lines = _cluster_lines(words)
    verb_y_center = (verb_word[1] + verb_word[3]) / 2
    lines_below = [l for l in lines if l["y_center"] > verb_y_center + 1]

    city_line = next(
        (l for l in lines_below if "province of british columbia" in l["text"].lower()), None
    )
    if city_line is None and lines_below and _left_of_bracket(lines_below[0]["words"])[0]:
        city_line = lines_below[0]

    if city_line is None:
        return {"success": False, "error": "bbox_validation_failed", "which": "jurat", "check": "city"}

    lines_below_city = [l for l in lines_below if l["y_center"] > city_line["y_center"] + 1]
    date_line = next((l for l in lines_below_city if "day of" in l["text"].lower()), None)
    # The prescribed jurat (B.C. Reg. 165/2024) reads
    # "British Columbia on ..[date].. ." rather than the LEAP Form 109's
    # "this .. day of .., ..", so it is matched — and rewritten — in its own
    # idiom. Its wording is prescribed and is not to be normalised away.
    prescribed_style = False
    if date_line is None:
        date_line = next(
            (l for l in lines_below_city if PRESCRIBED_JURAT_DATE_PATTERN.search(l["text"])),
            None)
        prescribed_style = date_line is not None
    if date_line is None:
        return {"success": False, "error": "bbox_validation_failed", "which": "jurat", "check": "date"}

    city_words, city_bracket_x = _left_of_bracket(city_line["words"])
    date_words, date_bracket_x = _left_of_bracket(date_line["words"])
    city_bbox = _words_bbox(city_words)
    date_bbox = _words_bbox(date_words)
    if city_bbox[3] > date_bbox[1]:
        midpoint = (city_line["y_center"] + date_line["y_center"]) / 2
        city_bbox[3] = min(city_bbox[3], midpoint)
        date_bbox[1] = max(date_bbox[1], midpoint)

    city_fontsize = _get_line_font_size(page, city_bbox)
    date_fontsize = _get_line_font_size(page, date_bbox)

    page.add_redact_annot(fitz.Rect(city_bbox), fill=(1, 1, 1))
    page.add_redact_annot(fitz.Rect(date_bbox), fill=(1, 1, 1))
    page.apply_redactions()

    signing_date = common.parse_date(data["signing_date"])
    if prescribed_style:
        city_text = "at ______________,"
        date_text = (f"British Columbia on {common.month_name(signing_date)} "
                     f"{signing_date.day}, {signing_date.year}.")
    else:
        city_text = "______________, Province of British Columbia,"
        date_text = f"this {common.ordinal(signing_date.day)} day of {common.month_name(signing_date)}, {signing_date.year}."

    fontname = "aa2body"
    verb_x0 = verb_word[0]
    body_font = fitz.Font(fontfile=body_font_path)

    def fit_left_of(name, text, fontsize, bracket_x):
        # Shrinks the rewrite, and says so, only if it would otherwise run into the bracket.
        if bracket_x is None:
            return fontsize
        fitted = (bracket_x - 1 - verb_x0) / body_font.text_length(text, 1)
        if fitted >= fontsize:
            return fontsize
        warnings.append(f"jurat {name} line set at {fitted:.1f}pt rather than "
                        f"{fontsize:.1f}pt to end left of the jurat bracket")
        return fitted

    city_fontsize = fit_left_of("city", city_text, city_fontsize, city_bracket_x)
    date_fontsize = fit_left_of("date", date_text, date_fontsize, date_bracket_x)
    page.insert_text(
        (verb_x0, city_bbox[3] - 2), city_text,
        fontsize=city_fontsize, fontfile=body_font_path, fontname=fontname, color=(0, 0, 0),
    )
    page.insert_text(
        (verb_x0, date_bbox[3] - 2), date_text,
        fontsize=date_fontsize, fontfile=body_font_path, fontname=fontname, color=(0, 0, 0),
    )

    result = {"success": True}
    if warnings:
        result["warning"] = "; ".join(warnings)
    return result


# ---------------------------------------------------------------------------
# Exhibit stamping
# ---------------------------------------------------------------------------

def _is_stamp_only_page(text):
    m = STAMP_ONLY_PATTERN.search(text)
    if not m:
        return False
    non_stamp_len = len(re.sub(r'\s+', '', text))
    stamp_block_len = len(re.sub(r'\s+', '', m.group(0)))
    return non_stamp_len <= stamp_block_len + 80


def _find_clear_window(page):
    rect = page.rect
    x_min, y_min = STAMP_MARGIN, STAMP_MARGIN
    x_max, y_max = rect.width - STAMP_MARGIN, rect.height - STAMP_MARGIN
    if x_max <= x_min or y_max <= y_min:
        return None

    cols = int(np.ceil((x_max - x_min) / GRID_CELL))
    rows = int(np.ceil((y_max - y_min) / GRID_CELL))
    if cols <= 0 or rows <= 0:
        return None

    occ = np.zeros((rows, cols), dtype=np.uint8)

    def mark(bbox, pad=6.0):
        bx0, by0, bx1, by1 = bbox
        bx0 -= pad; by0 -= pad; bx1 += pad; by1 += pad
        c0 = max(0, int((bx0 - x_min) // GRID_CELL))
        r0 = max(0, int((by0 - y_min) // GRID_CELL))
        c1 = min(cols, int(np.ceil((bx1 - x_min) / GRID_CELL)))
        r1 = min(rows, int(np.ceil((by1 - y_min) / GRID_CELL)))
        if c1 > c0 and r1 > r0:
            occ[r0:r1, c0:c1] = 1

    text_dict = page.get_text("dict")
    for block in text_dict.get("blocks", []):
        for line in block.get("lines", []):
            bbox = line.get("bbox")
            if bbox:
                mark(bbox)

    for img in page.get_image_info():
        bbox = img.get("bbox")
        if bbox:
            mark(bbox)

    for drawing in page.get_drawings():
        r = drawing.get("rect")
        if r:
            mark((r.x0, r.y0, r.x1, r.y1))

    win_cols = int(np.ceil(STAMP_WIDTH * STAMP_SCALE / GRID_CELL))
    win_rows = int(np.ceil(STAMP_HEIGHT * STAMP_SCALE / GRID_CELL))
    if win_cols > cols or win_rows > rows:
        return None

    prefix = np.zeros((rows + 1, cols + 1), dtype=np.int64)
    prefix[1:, 1:] = occ.cumsum(0).cumsum(1)

    def window_sum(r0, c0, r1, c1):
        return prefix[r1, c1] - prefix[r0, c1] - prefix[r1, c0] + prefix[r0, c0]

    target_x, target_y = x_max, y_max
    best = None
    best_dist = None
    for r0 in range(0, rows - win_rows + 1):
        for c0 in range(0, cols - win_cols + 1):
            r1, c1 = r0 + win_rows, c0 + win_cols
            if window_sum(r0, c0, r1, c1) == 0:
                win_x1 = x_min + c1 * GRID_CELL
                win_y1 = y_min + r1 * GRID_CELL
                dist = (win_x1 - target_x) ** 2 + (win_y1 - target_y) ** 2
                if best_dist is None or dist < best_dist:
                    best_dist = dist
                    win_x0 = x_min + c0 * GRID_CELL
                    win_y0 = y_min + r0 * GRID_CELL
                    best = (win_x0, win_y0, win_x1, win_y1)
    return best


def _draw_stamp(page, window, letter, data, stamp_font_path):
    ox, oy = window[0], window[1]
    verb_word = "affirmed" if data["jurat_verb"] == "AFFIRMED" else "sworn"
    signing_date = common.parse_date(data["signing_date"])
    date_str = f"{signing_date.day:02d}/{signing_date.strftime('%b')}/{signing_date.year}"

    texts = [
        f'This is Exhibit " {letter} " referred to in the',
        f'affidavit of {data["affiant_name"] if data["name_affiant_on_stamps"] else "_" * 20} ',
        f'{verb_word} before me on {date_str}',
        '_____________________________ ',
        'A Commissioner for taking Affidavits ',
        'for the Province of British Columbia',
    ]

    fontname = "aa2stamp"
    font = fitz.Font(fontfile=stamp_font_path)
    for (sx, sy0), text in zip(STAMP_LINE_OFFSETS, texts):
        x = ox + sx * STAMP_SCALE
        y = oy + (sy0 + 8.83) * STAMP_SCALE
        page.insert_text(
            (x, y), text, fontsize=min(13.8, (window[2] - x) / font.text_length(text, 1)),
            fontfile=stamp_font_path, fontname=fontname,
            color=(0, 0, 0), fill_opacity=0.6,
        )


def stamp_exhibit(ex_path, letter, data, stamp_font_path):
    try:
        doc = fitz.open(str(ex_path))
    except Exception as e:
        return {"success": False, "error": "exhibit_open_failed", "file": str(ex_path), "detail": str(e)}

    try:
        if doc.page_count > 0:
            page0_text = doc[0].get_text()
            if _is_stamp_only_page(page0_text):
                doc.delete_page(0)

        if doc.page_count == 0:
            return {"success": False, "error": "exhibit_empty_after_stamp_strip", "file": str(ex_path)}

        page0 = doc[0]
        window = None
        min_w = STAMP_WIDTH * STAMP_SCALE + 2 * STAMP_MARGIN
        min_h = STAMP_HEIGHT * STAMP_SCALE + 2 * STAMP_MARGIN
        if page0.rotation == 0 and page0.rect.width >= min_w and page0.rect.height >= min_h:
            window = _find_clear_window(page0)

        if window is None:
            blank = doc.new_page(pno=0, width=612, height=792)
            placement = "blank_page_inserted"
            stamp_page = blank
            ox = (612 - STAMP_WIDTH * STAMP_SCALE) / 2
            oy = (792 - STAMP_HEIGHT * STAMP_SCALE) / 2
            window = (ox, oy, ox + STAMP_WIDTH * STAMP_SCALE, oy + STAMP_HEIGHT * STAMP_SCALE)
        else:
            placement = "whitespace"
            stamp_page = page0

        _draw_stamp(stamp_page, window, letter, data, stamp_font_path)

        stamped_path = Path(ex_path).with_name(Path(ex_path).stem + ".stamped.pdf")
        doc.save(str(stamped_path))

        return {"success": True, "letter": letter, "stamped_path": str(stamped_path), "stamp_placement": placement}
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_pipeline(data):
    output_dir = Path(data["output_path"]).parent
    if not output_dir.is_dir():
        return {"success": False, "error": "no_output_dir",
                "detail": f"{output_dir} is not a folder; it is never created here"}
    warnings = []
    scratch_dir = Path(tempfile.mkdtemp(prefix="affasm_"))
    affidavit_doc = None
    try:
        try:
            stamp_font_path = _resolve_font_or_raise("stamp")
            body_font_path = _resolve_font_or_raise("body")
        except FontResolutionError as e:
            return {"success": False, "error": "font_not_found", "role": e.role}

        affidavit_src = Path(data["affidavit_pdf"])
        work_affidavit = scratch_dir / ("affidavit" + affidavit_src.suffix.lower())
        shutil.copy2(affidavit_src, work_affidavit)

        work_exhibits = []
        for ex in data["exhibits"]:
            src = Path(ex["path"])
            dst = scratch_dir / f"exhibit_{ex['letter']}{src.suffix.lower()}"
            shutil.copy2(src, dst)
            work_exhibits.append({"letter": ex["letter"], "path": dst})

        for ex in work_exhibits:
            if ex["path"].suffix.lower() != ".pdf":
                return {"success": False, "error": "unsupported_format", "file": str(ex["path"])}

        if work_affidavit.suffix.lower() == ".docx":
            try:
                pdf_path = convert_docx_to_pdf(work_affidavit, scratch_dir)
            except DocxConversionError as e:
                return {"success": False, "error": "docx_conversion_failed", "detail": str(e)}
            work_affidavit_pdf = Path(pdf_path)
        elif work_affidavit.suffix.lower() == ".pdf":
            work_affidavit_pdf = work_affidavit
        else:
            return {"success": False, "error": "unsupported_format", "file": str(affidavit_src)}

        affidavit_doc = fitz.open(str(work_affidavit_pdf))

        # header_bbox must be present, but may be null: Rule 22-2(3) excepts an
        # affidavit of service from the identifier block, so Forms 15 and 16
        # have nothing to rewrite. Absent (rather than null) is a caller error.
        if "header_bbox" not in data:
            return {"success": False, "error": "missing_field", "field": "header_bbox",
                    "detail": ('header_bbox is required; pass null for an affidavit '
                               'with no Rule 22-2(3) identifier block.')}
        if data["header_bbox"]:
            header_result = rewrite_header(affidavit_doc, data, body_font_path)
            if not header_result.get("success"):
                return header_result
        else:
            warnings.append("no identifier block rewritten (header_bbox is null): "
                            "expected for an affidavit of service; otherwise the "
                            "top-right block was left as drafted, check its number and date")

        jurat_result = rewrite_jurat(affidavit_doc, data, body_font_path)
        if not jurat_result.get("success"):
            return jurat_result
        if jurat_result.get("warning"):
            warnings.append(jurat_result["warning"])

        exhibit_stamp_results = []
        for ex in sorted(work_exhibits, key=lambda e: e["letter"]):
            stamp_result = stamp_exhibit(ex["path"], ex["letter"], data, stamp_font_path)
            if not stamp_result.get("success"):
                return stamp_result
            exhibit_stamp_results.append(stamp_result)
            gc.collect()

        try:
            final_doc = fitz.Document()
            final_doc.insert_pdf(affidavit_doc)
            affidavit_doc.close()
            affidavit_doc = None

            exhibit_page_info = []
            current_page = final_doc.page_count
            for res in exhibit_stamp_results:
                ex_doc = fitz.open(res["stamped_path"])
                start = current_page + 1
                final_doc.insert_pdf(ex_doc)
                ex_doc.close()
                current_page = final_doc.page_count
                exhibit_page_info.append({
                    "letter": res["letter"],
                    "pages": f"{start}-{current_page}",
                    "stamp_placement": res["stamp_placement"],
                })
        except Exception:
            return {"success": False, "error": "concat_failed", "detail": traceback.format_exc()}

        output_path, prior = common.save_new(
            data["output_path"], lambda tmp: final_doc.save(str(tmp)))
        final_doc.close()

        reopened = fitz.open(str(output_path))
        page_count = reopened.page_count
        reopened.close()

        result = {
            "success": True,
            "output_path": str(output_path),
            "page_count": page_count,
            "exhibits": exhibit_page_info,
            "warnings": warnings,
        }
        if prior:
            result["versioned_from"] = str(prior)
        return result
    finally:
        if affidavit_doc is not None:
            affidavit_doc.close()
        shutil.rmtree(scratch_dir, ignore_errors=True)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--probe":
        if len(sys.argv) < 3:
            return {"success": False, "error": "missing_argument", "detail": "--probe requires a docx path"}
        return probe(sys.argv[2])

    data = common.read_input_json()
    return run_pipeline(data)


if __name__ == "__main__":
    try:
        result = main()
        common.emit(result, result.get("success", False))
    except Exception:
        common.emit(
            {"success": False, "error": "unexpected_exception", "detail": traceback.format_exc()},
            False,
        )
