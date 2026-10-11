"""Renumber an unfiled Form 109 affidavit draft by writing a new .docx copy.

CLI: python renumber_affidavit.py <input.json path>
     python renumber_affidavit.py   (reads JSON from stdin)

Input JSON:
  {"mode": "probe", "source": "<abs .docx>"}
  {"mode": "write", "source": "<abs .docx>", "out_path": "<abs .docx>",
   "old_number": 1, "new_number": 2}

Finds the Rule 22-2(3) identifier ("This is the 1st affidavit of ...") in
word/document.xml and every word/header*.xml. Probe reports what it finds and
writes nothing. Write changes only the number and suffix text in their own w:t
nodes, keeps every other zip member byte for byte, verifies the result in
memory, and creates out_path exclusively. It never edits, renames or deletes
the source and never overwrites a file. Prints one JSON object; exit 0 on
success, 1 on any refusal or error.
"""
import io
import json
import os
import re
import sys
import traceback
import zipfile
from pathlib import Path

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from ordinal_date import _ordinal_suffix  # noqa: E402

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
IDENTIFIER = re.compile(r"this is the\s+(\d+)\s*(st|nd|rd|th)\s+affidavit", re.IGNORECASE)
COUNTED = ("ins", "del", "commentRangeStart", "commentReference", "sdt")


class Refusal(Exception):
    def __init__(self, error, detail):
        super().__init__(detail)
        self.error = error
        self.detail = detail


def open_docx(source):
    """The source's bytes and a ZipFile over them."""
    try:
        data = Path(source).read_bytes()
        zf = zipfile.ZipFile(io.BytesIO(data))
        zf.getinfo("word/document.xml")
    except (OSError, zipfile.BadZipFile, KeyError) as exc:
        raise Refusal("not_a_docx", "not a .docx with word/document.xml: %s (%s)" % (source, exc))
    return data, zf


def paragraphs(root):
    """Each w:p's own text, with the (w:t, start, end) spans that build it."""
    out = []
    for p in root.iter(W + "p"):
        text, spans = "", []
        for t in p.iter(W + "t"):
            if next(t.iterancestors(W + "p")) is p:
                spans.append((t, len(text), len(text) + len(t.text or "")))
                text += t.text or ""
        out.append((text, spans))
    return out


def under(node, *tags):
    return any(a.tag in tags for a in node.iterancestors())


def locate(zf):
    """(parts searched, parsed roots by part, identifier matches)."""
    parts = sorted(n for n in zf.namelist() if n == "word/document.xml"
                   or (n.startswith("word/header") and n.endswith(".xml") and "/" not in n[5:]))
    roots = {part: etree.fromstring(zf.read(part)) for part in parts}
    matches = []
    for part in parts:
        for index, (text, spans) in enumerate(paragraphs(roots[part])):
            for m in IDENTIFIER.finditer(text):
                digit = [s for s in spans if s[1] < m.end(1) and s[2] > m.start(1)]
                suffix = [s for s in spans if s[1] < m.end(2) and s[2] > m.start(2)]
                nodes = [s[0] for s in digit + suffix]
                if any(under(n, W + "sdtContent") for n in nodes):
                    location = "sdt"
                elif digit != suffix:
                    location = "split_runs"
                else:
                    location = "plain_run"
                matches.append({
                    "part": part, "number": int(m.group(1)), "location": location,
                    "in_tracked_change": any(under(n, W + "ins", W + "del") for n in nodes),
                    "split": len(digit) > 1 or len(suffix) > 1, "paragraph": index,
                    "text": text, "spans": (m.span(1), m.span(2)), "suffix_text": m.group(2),
                    "digit_node": digit[0], "suffix_node": suffix[0]})
    return parts, roots, matches


def flags(zf, roots):
    return {
        "tracked_changes_present": any(next(r.iter(W + "ins", W + "del"), None) is not None
                                       for r in roots.values()),
        "comments_present": "word/comments.xml" in zf.namelist(),
    }


def public(match):
    return {k: match[k] for k in ("part", "number", "location", "in_tracked_change", "text")}


def probe(req):
    _, zf = open_docx(req["source"])
    parts, roots, matches = locate(zf)
    return {"success": True, "parts_searched": parts,
            "matches": [public(m) for m in matches], **flags(zf, roots)}


def positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def substitute(match, new):
    """Rewrite the digit and suffix inside their own w:t nodes. Returns the
    paragraph's expected new text."""
    (d0, d1), (s0, s1) = match["spans"]
    suffix = _ordinal_suffix(new)
    if match["suffix_text"].isupper():
        suffix = suffix.upper()
    # Suffix first: when both tokens share a node, the digit's offsets still hold.
    for (node, start, _), a, b, value in ((match["suffix_node"], s0, s1, suffix),
                                          (match["digit_node"], d0, d1, str(new))):
        node.text = node.text[:a - start] + value + node.text[b - start:]
    text = match["text"]
    return text[:d0] + str(new) + text[d1:s0] + suffix + text[s1:]


def rebuild(source_bytes, part, part_bytes):
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(source_bytes)) as zin, zipfile.ZipFile(buf, "w") as zout:
        for info in zin.infolist():
            data = part_bytes if info.filename == part else zin.read(info.filename)
            zout.writestr(info, data)
    return buf.getvalue()


def verify(source_bytes, new_bytes, match, new, expected_text):
    def fail(detail):
        raise Refusal("verify_failed", detail)

    part = match["part"]
    src = zipfile.ZipFile(io.BytesIO(source_bytes))
    dst = zipfile.ZipFile(io.BytesIO(new_bytes))
    if src.namelist() != dst.namelist():
        fail("zip member names or order changed")
    for name in src.namelist():
        if name != part and src.read(name) != dst.read(name):
            fail("member changed that should not have: " + name)
    parts, src_roots, _ = locate(src)
    _, dst_roots, found = locate(dst)
    if len(found) != 1 or found[0]["number"] != new:
        fail("new copy does not hold exactly one identifier reading %d" % new)
    for p in parts:
        before = [text for text, _ in paragraphs(src_roots[p])]
        after = [text for text, _ in paragraphs(dst_roots[p])]
        if p == part:
            before[match["paragraph"]] = expected_text
        if before != after:
            fail("paragraph text changed beyond the identifier in " + p)
    for tag in COUNTED:
        if (len(list(src_roots[part].iter(W + tag)))
                != len(list(dst_roots[part].iter(W + tag)))):
            fail("count of w:%s changed in %s" % (tag, part))


def write(req):
    source, out_path = req["source"], req["out_path"]
    old, new = req.get("old_number"), req.get("new_number")
    if os.path.exists(out_path):
        raise Refusal("output_exists", "not overwriting " + out_path)
    if not (positive_int(old) and positive_int(new)) or old == new:
        raise Refusal("invalid_number", "old_number and new_number must be different "
                      "positive integers, got %r and %r" % (old, new))
    source_bytes, zf = open_docx(source)
    _, roots, matches = locate(zf)
    if not matches:
        raise Refusal("identifier_not_found", "no 'This is the Nth affidavit' identifier in "
                      + source)
    if len(matches) > 1:
        raise Refusal("identifier_ambiguous", "; ".join(
            "%s: %s" % (m["part"], m["text"]) for m in matches))
    match = matches[0]
    if match["number"] != old:
        raise Refusal("ordinal_mismatch", "expected %d, found %d in %s: %s"
                      % (old, match["number"], match["part"], match["text"]))
    if match["in_tracked_change"]:
        raise Refusal("ordinal_in_tracked_change", "the number sits in a tracked revision in "
                      "%s; accept or reject that revision in Word first" % match["part"])
    if match["split"]:
        raise Refusal("identifier_split", "the number or its suffix spans more than one text "
                      "node in %s: %s" % (match["part"], match["text"]))
    result_flags = flags(zf, roots)
    expected_text = substitute(match, new)
    part_bytes = etree.tostring(roots[match["part"]], xml_declaration=True,
                                encoding="UTF-8", standalone=True)
    new_bytes = rebuild(source_bytes, match["part"], part_bytes)
    verify(source_bytes, new_bytes, match, new, expected_text)
    try:
        with open(out_path, "xb") as fh:
            fh.write(new_bytes)
    except FileExistsError:
        raise Refusal("output_exists", "not overwriting " + out_path)
    return {"success": True, "source": source, "out_path": out_path, "part": match["part"],
            "location": match["location"], "old_number": old, "new_number": new,
            **result_flags}


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as fh:
            req = json.load(fh)
    else:
        req = json.loads(sys.stdin.read())
    try:
        return {"probe": probe, "write": write}[req["mode"]](req)
    except Refusal as exc:
        return {"success": False, "error": exc.error, "detail": exc.detail}


if __name__ == "__main__":
    try:
        result = main()
    except Exception:
        result = {"success": False, "error": "unexpected_exception",
                  "detail": traceback.format_exc()}
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["success"] else 1)
