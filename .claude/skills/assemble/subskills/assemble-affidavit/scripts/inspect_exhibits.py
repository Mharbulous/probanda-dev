"""Inventory exhibit files, extract identifying text, classify, and render
scanned pages to PNG for downstream OCR-by-reading.

CLI: python inspect_exhibits.py <input.json path>
     python inspect_exhibits.py   (reads JSON from stdin)

Input JSON:
{"exhibit_dirs": ["<dir>", ...], "exhibit_files": ["<pdf>", ...], "png_out_dir": "<dir>"}

Output JSON:
{"success": true,
 "files": [{"letter", "path", "ext", "page_count", "has_text", "is_scanned",
            "classification", "page1_text", "file_own_date",
            "pre_existing_stamp"}, ...],
 "unmatched_files": ["<paths that didn't match any exhibit-letter pattern>"]}
"""
import re
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common

# Exhibit filename patterns: "Exhibit {letter}...", "Ex {letter}...", "{letter} - ..."
_PATTERNS = [
    re.compile(r'^Exhibit\s+([A-Z])\b', re.IGNORECASE),
    re.compile(r'^Ex\s+([A-Z])\b', re.IGNORECASE),
    re.compile(r'^([A-Z])\s*-\s*', re.IGNORECASE),
]

_DATE_WORD = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}'
_STANDALONE_DATE_RE = re.compile(rf'^\s*({_DATE_WORD})\s*$', re.MULTILINE)
_DATED_PREFIX_RE = re.compile(rf'(?i)dated[:\s]+({_DATE_WORD})')
_ANY_DATE_RE = re.compile(_DATE_WORD)


def match_letter(filename):
    stem = Path(filename).stem
    for pat in _PATTERNS:
        m = pat.match(stem)
        if m:
            return m.group(1).upper()
    return None


def extract_file_own_date(page1_text):
    page1_text = re.sub(rf'(?i)WHEREAS[^.;]*|(?:[^\s.:]\s+|\. +)dated\s+{_DATE_WORD}', ' ', page1_text)
    m = _STANDALONE_DATE_RE.search(page1_text)
    if m:
        return m.group(1)
    m = _DATED_PREFIX_RE.search(page1_text)
    if m:
        return m.group(1)
    m = _ANY_DATE_RE.search(page1_text)
    if m:
        return m.group(0)
    return None


def inspect_pdf(path, letter, png_out_dir):
    import pymupdf as fitz

    result = {
        "letter": letter,
        "path": str(path),
        "ext": path.suffix.lower(),
        "size": path.stat().st_size,
        "page_count": None,
        "has_text": False,
        "is_scanned": False,
        "classification": None,
        "page1_text": "",
        "file_own_date": None,
        "pre_existing_stamp": None,
    }

    try:
        doc = fitz.open(str(path))
    except Exception:
        result["classification"] = "UNVERIFIABLE"
        return result

    try:
        result["page_count"] = doc.page_count

        def page_text(idx):
            if idx >= doc.page_count:
                return ""
            return doc[idx].get_text().replace("\xa0", " ")

        page0_text = page_text(0)
        page1_text_raw = page_text(1)
        combined_0_1 = (page0_text + "\n" + page1_text_raw).strip()

        stamp_match = common.STAMP_ONLY_PATTERN.search(page0_text)
        page0_is_stamp_only = False
        if stamp_match:
            # "no other substantive text" heuristic: strip the stamp block
            # lines and see if meaningful content remains.
            non_stamp_len = len(re.sub(r'\s+', '', page0_text))
            stamp_block_len = len(re.sub(r'\s+', '', stamp_match.group(0)))
            # crude heuristic: if page0 text (whitespace-stripped) isn't much
            # longer than the matched stamp phrase, treat as stamp-only.
            page0_is_stamp_only = non_stamp_len <= stamp_block_len + 80

        if page0_is_stamp_only:
            letter_in_stamp_m = re.search(r'Exhibit\s+"?([A-Z])"?\s+referred to in the', page0_text, re.IGNORECASE)
            result["pre_existing_stamp"] = letter_in_stamp_m.group(1).upper() if letter_in_stamp_m else "?"
            page2_text = page_text(2)
            result["page1_text"] = (page1_text_raw + "\n" + page2_text).strip()
            has_text = bool(result["page1_text"].strip())
        else:
            result["page1_text"] = combined_0_1
            has_text = bool(combined_0_1)

        result["has_text"] = has_text
        result["is_scanned"] = not has_text

        if not has_text:
            result["classification"] = "SCANNED"
            png_out_dir.mkdir(parents=True, exist_ok=True)
            stem = path.stem
            for idx in (0, 1):
                if idx < doc.page_count:
                    pix = doc[idx].get_pixmap(dpi=200)
                    out_path = png_out_dir / f"{stem}_p{idx}.png"
                    pix.save(str(out_path))
                    result.setdefault("png_paths", []).append(str(out_path))
        else:
            result["classification"] = "TEXT"

        result["file_own_date"] = extract_file_own_date(result["page1_text"])

    finally:
        doc.close()

    return result


def main():
    data = common.read_input_json()
    exhibit_dirs = [Path(d) for d in data["exhibit_dirs"]]
    png_out_dir = Path(data["png_out_dir"])

    files = []
    unmatched_files = []
    by_letter_ext = {}  # letter -> {ext: path}

    for d in exhibit_dirs:
        if not d.is_dir():
            continue
        for p in sorted(d.iterdir()):
            if not p.is_file():
                continue
            letter = match_letter(p.name)
            if letter is None:
                unmatched_files.append(str(p))
                continue
            by_letter_ext.setdefault(letter, {})[p.suffix.lower()] = p

    for letter in sorted(by_letter_ext):
        ext_map = by_letter_ext[letter]
        # If both PDF and non-PDF exist for the same letter, silently prefer PDF.
        if ".pdf" in ext_map and len(ext_map) > 1:
            for ext, p in ext_map.items():
                if ext != ".pdf":
                    pass  # dropped from consideration, not reported as unmatched
            paths_to_process = {".pdf": ext_map[".pdf"]}
        else:
            paths_to_process = ext_map

        for ext, p in paths_to_process.items():
            if ext == ".pdf":
                files.append(inspect_pdf(p, letter, png_out_dir))
            else:
                files.append({
                    "letter": letter,
                    "path": str(p),
                    "ext": ext,
                    "size": p.stat().st_size,
                    "page_count": None,
                    "has_text": None,
                    "is_scanned": None,
                    "classification": None,
                    "page1_text": "",
                    "file_own_date": None,
                    "pre_existing_stamp": None,
                })

    for p in map(Path, data.get("exhibit_files", [])):
        files.append(inspect_pdf(p, None, png_out_dir))

    return {"success": True, "files": files, "unmatched_files": unmatched_files}


if __name__ == "__main__":
    try:
        result = main()
        common.emit(result, result["success"])
    except ImportError as exc:  # see SUBSKILL.md Error handling
        common.emit({"success": False, "error": "missing_dependency", "detail": f"{exc.name or exc} is not installed"}, False)
    except Exception:
        common.emit(
            {"success": False, "error": "unexpected_exception", "detail": traceback.format_exc()},
            False,
        )
