"""Score exhibit files against affidavit-body exhibit descriptions and
produce a best assignment via the Hungarian algorithm.

CLI: python match_exhibits.py <input.json path>
     python match_exhibits.py   (reads JSON from stdin)

Input JSON:
{"descriptions": [{"letter", "paragraph", "identity_date", "identity_terms": [],
                    "context_terms": [], "key_terms": []}, ...],
 "files": [{"letter", "path", "classification", "page1_text", "file_own_date"}, ...]}

Output JSON:
{"success": true,
 "assignments": [{"exhibit_letter", "file_path", "file_letter", "score", "status"}, ...],
 "rename_mapping": [{"from", "to"}, ...],
 "score_matrix": [[...]]}

Judgment call (flagged): the plan's prose says "discard assignments below
score 2.0 (treat as unassigned)" but also defines a WEAK status for scores
in [1.0, 2.0). Those two statements are only consistent if the discard
threshold is actually 1.0, not 2.0 — otherwise WEAK could never be
produced by the Hungarian assignment step. This implementation uses 1.0 as
the discard threshold (below 1.0 = not a real match, description stays
unassigned / falls through to the leftover pass) and 2.0 as the
CONFIRMED/MISLABELED vs WEAK boundary, since that is the only reading
under which every documented status is reachable.
"""
import re
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common

try:
    import numpy as np
    from scipy.optimize import linear_sum_assignment
except ImportError as exc:  # refuse in this script's JSON contract, not as a traceback
    common.emit({"success": False, "error": "missing_dependency", "detail": (
        f"{exc.name or exc} is not installed. This script runs on the PC, in a Claude Code "
        "session in the desktop app's Code tab, where the Probanda plugin is installed "
        "-- not in a Cowork cloud sandbox, which has no scipy and blocks pypi. "
        "On the PC, install it: "
        "pip install numpy scipy")}, False)

_DATE_TERM_RE = re.compile(
    r'^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$',
    re.IGNORECASE,
)
_MONEY_RE = re.compile(r'\$[\d,]+(?:\.\d{2})?')

DISCARD_THRESHOLD = 1.0
CONFIRM_THRESHOLD = 2.0


def term_matches(term, text):
    """Case-insensitive substring match; dates match with/without comma;
    dollar amounts match with/without cents/commas."""
    if not term or not text:
        return False
    term_l = term.lower().strip()
    text_l = text.lower()

    if term_l in text_l:
        return True

    if _DATE_TERM_RE.match(term_l):
        norm_term = term_l.replace(",", "")
        norm_text = text_l.replace(",", "")
        if norm_term in norm_text:
            return True

    if term_l.startswith("$"):
        num_str = term_l.lstrip("$").replace(",", "")
        try:
            val = float(num_str)
        except ValueError:
            val = None
        if val is not None:
            for m in _MONEY_RE.finditer(text):
                t_num = m.group(0).lstrip("$").replace(",", "")
                try:
                    t_val = float(t_num)
                except ValueError:
                    continue
                if abs(t_val - val) < 0.005:
                    return True

    return False


def compute_doc_freq(descriptions):
    """Number of descriptions whose key_terms contain each (lowercased) term."""
    doc_count = {}
    for desc in descriptions:
        terms_seen = {t.lower() for t in desc.get("key_terms", [])}
        for t in terms_seen:
            doc_count[t] = doc_count.get(t, 0) + 1
    return doc_count


def score_file_description(file, desc, doc_freq):
    if file.get("classification") not in ("TEXT", "TEXT_OCR"):
        return 0.0

    text = file.get("page1_text") or ""
    identity_terms = {t.lower() for t in desc.get("identity_terms", [])}
    score = 0.0

    for term in desc.get("key_terms", []):
        if term_matches(term, text):
            weight = 1.5 if term.lower() in identity_terms else 1.0
            idf = 1.0 / doc_freq.get(term.lower(), 1)
            score += weight * idf

    file_date = file.get("file_own_date")
    identity_date = desc.get("identity_date")
    if file_date and identity_date:
        if term_matches(identity_date, file_date) or term_matches(file_date, identity_date):
            score += 5.0
        else:
            score -= 3.0

    if file.get("letter") == desc.get("letter"):
        score += 1.5

    return score


def build_score_matrix(files, descriptions, doc_freq):
    matrix = np.zeros((len(files), len(descriptions)))
    for i, f in enumerate(files):
        for j, d in enumerate(descriptions):
            matrix[i, j] = score_file_description(f, d, doc_freq)
    return matrix


def solve_assignment(matrix):
    """Pad to square with zero rows/cols, negate, solve. Returns list of
    (file_idx, desc_idx) pairs restricted to real (non-padding) indices."""
    n_files, n_desc = matrix.shape
    size = max(n_files, n_desc)
    padded = np.zeros((size, size))
    padded[:n_files, :n_desc] = matrix

    cost = -padded
    row_ind, col_ind = linear_sum_assignment(cost)

    pairs = []
    for r, c in zip(row_ind, col_ind):
        if r < n_files and c < n_desc:
            pairs.append((r, c))
    return pairs


def classify_status(score, file_letter, desc_letter, classification):
    if score >= CONFIRM_THRESHOLD:
        if file_letter in (desc_letter, None):
            return "CONFIRMED (OCR)" if classification == "TEXT_OCR" else "CONFIRMED"
        return "MISLABELED"
    return "WEAK"  # 1.0 <= score < 2.0


def main():
    data = common.read_input_json()
    descriptions = data["descriptions"]
    files = data["files"]

    doc_freq = compute_doc_freq(descriptions)
    matrix = build_score_matrix(files, descriptions, doc_freq)
    pairs = solve_assignment(matrix)

    assigned_file_idx = set()
    assigned_desc_idx = set()
    assignments_by_desc = {}

    for file_idx, desc_idx in pairs:
        score = matrix[file_idx, desc_idx]
        if score < DISCARD_THRESHOLD:
            continue  # not a real match; description stays unassigned for now
        f = files[file_idx]
        d = descriptions[desc_idx]
        status = classify_status(score, f.get("letter"), d.get("letter"), f.get("classification"))
        assignments_by_desc[desc_idx] = {
            "exhibit_letter": d["letter"],
            "file_path": f["path"],
            "file_letter": f.get("letter"),
            "score": round(float(score), 3),
            "status": status,
        }
        assigned_file_idx.add(file_idx)
        assigned_desc_idx.add(desc_idx)

    # Leftover pass: assign leftover SCANNED/UNVERIFIABLE files to leftover
    # descriptions by letter order (unscored, marked UNVERIFIED).
    leftover_file_idxs = [
        i for i in range(len(files))
        if i not in assigned_file_idx and files[i].get("letter") and files[i].get("classification") in ("SCANNED", "UNVERIFIABLE")
    ]
    leftover_desc_idxs = [i for i in range(len(descriptions)) if i not in assigned_desc_idx]

    leftover_file_idxs.sort(key=lambda i: files[i]["letter"])
    leftover_desc_idxs.sort(key=lambda i: descriptions[i].get("letter") or "")

    for file_idx, desc_idx in zip(leftover_file_idxs, leftover_desc_idxs):
        f = files[file_idx]
        d = descriptions[desc_idx]
        assignments_by_desc[desc_idx] = {
            "exhibit_letter": d["letter"],
            "file_path": f["path"],
            "file_letter": f.get("letter"),
            "score": 0.0,
            "status": "UNVERIFIED",
        }
        assigned_file_idx.add(file_idx)
        assigned_desc_idx.add(desc_idx)

    # Anything still unassigned is MISSING.
    for desc_idx, d in enumerate(descriptions):
        if desc_idx not in assignments_by_desc:
            assignments_by_desc[desc_idx] = {
                "exhibit_letter": d["letter"],
                "file_path": None,
                "file_letter": None,
                "score": None,
                "status": "MISSING",
            }

    assignments = [assignments_by_desc[i] for i in range(len(descriptions))]

    rename_mapping = []
    for a in assignments:
        if a["status"] == "MISLABELED":
            current_name = Path(a["file_path"]).name
            rename_mapping.append({
                "from": current_name,
                "to": f"Exhibit {a['exhibit_letter']}.pdf",
            })

    return {
        "success": True,
        "assignments": assignments,
        "rename_mapping": rename_mapping,
        "score_matrix": matrix.tolist(),
    }


if __name__ == "__main__":
    try:
        result = main()
        common.emit(result, result["success"])
    except Exception:
        common.emit(
            {"success": False, "error": "unexpected_exception", "detail": traceback.format_exc()},
            False,
        )
