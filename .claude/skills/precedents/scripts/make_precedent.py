#!/usr/bin/env python3
"""Turn a practitioner's saved Word file into a precedent, as a new file (/precedents).

Usage: python make_precedent.py <request.json>
Request: {"source", "out_dir", "name", "replacements": [{"value", "placeholder"}]}
Prints one JSON line. {"success": true, "path", "replaced": {placeholder: count}}, or
{"success": false, "error", "detail"} with error one of bad_request, not_a_docx, no_folder,
value_not_found, leftover or write_failed. A refusal writes nothing.

Each value in word/document.xml, the headers, the footers, the footnotes and the endnotes becomes
one run holding its placeholder, with the properties of the run the value starts in plus a yellow
highlight. A value may span runs of one paragraph. A match is exact in case and whole-word.
A bracketed, highlighted placeholder already in the file is left alone, so an edited copy of a
precedent can be run again.

The XML is spliced as text, because ElementTree rewrites namespace prefixes. A paragraph with no
match stays byte-identical, and every other part is copied as it is.

The leftover check is deliberately wider than the replacing: any case, inside longer words, every
XML part of the file and the output name. The source is never changed and an existing file is never
overwritten: the name takes " (2)", " (3)" and so on. Stdlib only.
"""
import html
import io
import json
import os
import re
import sys
import zipfile
from collections import namedtuple
from xml.sax.saxutils import escape

SCANNED = re.compile(r"word/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$")
TOKEN = re.compile(
    r"(?P<p><w:p(?:\s[^>]*?)?(?<!/)>)|(?P<p_end></w:p>)"
    r"|(?P<r><w:r(?:\s[^>]*?)?(?<!/)>)|(?P<r_end></w:r>)"
    r"|<w:t(?:\s[^>]*?)?(?<!/)>(?P<t>[^<]*)</w:t>"
    r"|(?P<gap><w:(?:tab|ptab|br|cr|sym|noBreakHyphen|softHyphen|fldChar)\b[^>]*/>)"
)
RPR = re.compile(r"<w:rPr(?:\s[^>]*?)?(?:/>|>.*?</w:rPr>)", re.S)
RPR_BODY = re.compile(r"<w:rPr(?:\s[^>]*)?>(.*)</w:rPr>$", re.S)
# What CT_RPr orders after w:highlight, extensions included.
AFTER_HIGHLIGHT = re.compile(r"<(?:w:(?:u|effect|bdr|shd|fitText|vertAlign|rtl|cs|em|lang|eastAsianLayout|specVanish|oMath)\b|w\d+:)")
BRACKETED = re.compile(r"\[[^\[\]]+\]")
PLACEHOLDER = re.compile(r"\[[^\[\]]+\]$")
TEXT_ATTRIBUTE = re.compile(r'\b(?:descr|title|alias|tag|tooltip|Target)="([^"]*)"')
GAP = "￿"  # stands for a tab, break or field mark in a paragraph's text, so no value matches across one
MARK = ""  # marks each splice until the runs it emptied are removed
EMPTIED_RUN = re.compile(
    r"<w:r(?:\s[^>]*)?>(?:<w:rPr(?:\s[^>]*?)?(?:/>|>(?:(?!</w:rPr>).)*</w:rPr>))?" + MARK + r"+</w:r>", re.S
)
# Same-length, so an offset into the folded text is an offset into the original.
FOLD = str.maketrans({" ": " ", "‘": "'", "’": "'"})

Run = namedtuple("Run", "open rpr")
Piece = namedtuple("Piece", "first last el_start el_end text run")
Paragraph = namedtuple("Paragraph", "text pieces")


class Refusal(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def fold(text):
    return text.translate(FOLD)


def paragraphs(xml):
    """Every paragraph with its visible text and where each piece sits. A text box's paragraph
    nests inside another and is kept apart from it."""
    done, open_paragraphs, runs = [], [], []
    for m in TOKEN.finditer(xml):
        kind = m.lastgroup
        if kind == "p":
            open_paragraphs.append({"text": "", "pieces": []})
        elif kind == "p_end":
            if open_paragraphs:
                done.append(open_paragraphs.pop())
        elif kind == "r":
            rpr = RPR.match(xml, m.end())
            runs.append(Run(m.group(0), rpr.group(0) if rpr else ""))
        elif kind == "r_end":
            if runs:
                runs.pop()
        elif open_paragraphs and kind == "gap":
            open_paragraphs[-1]["text"] += GAP
        elif open_paragraphs and kind == "t" and runs:
            para = open_paragraphs[-1]
            text = html.unescape(m.group("t"))
            first = len(para["text"])
            para["text"] += text
            para["pieces"].append(Piece(first, len(para["text"]), m.start(), m.end(), text, runs[-1]))
    return [Paragraph(p["text"], p["pieces"]) for p in done]


def touching(pieces, a, b):
    return [p for p in pieces if p.first < b and a < p.last]


def kept_placeholders(para):
    """The spans of bracketed placeholders that are highlighted throughout."""
    spans = []
    for m in BRACKETED.finditer(para.text):
        held = touching(para.pieces, *m.span())
        if held and all("<w:highlight" in p.run.rpr for p in held):
            spans.append(m.span())
    return spans


def highlighted(rpr):
    body = RPR_BODY.match(rpr)
    body = body.group(1).partition("<w:rPrChange")[0] if body else ""
    body = re.sub(r"<w:highlight\b[^>]*/>", "", body)
    later = AFTER_HIGHLIGHT.search(body)
    at = later.start() if later else len(body)
    return '<w:rPr>%s<w:highlight w:val="yellow"/>%s</w:rPr>' % (body[:at], body[at:])


def text_element(text):
    return '<w:t xml:space="preserve">%s</w:t>' % escape(text) if text else ""


def placeholder_run(run, placeholder):
    return "%s%s%s</w:r>" % (run.open, highlighted(run.rpr), text_element(placeholder))


def spliced(piece, matches):
    """The piece's XML with its share of the matches cut out, each placeholder going where its match
    starts. A placeholder of None only cuts."""
    out, at = [MARK], piece.first
    for a, b, placeholder in matches:
        if b <= piece.first or a >= piece.last:
            continue
        out.append(text_element(piece.text[at - piece.first : max(a, at) - piece.first]))
        if a >= piece.first and placeholder is not None:
            out.append(MARK + "</w:r>" + placeholder_run(piece.run, placeholder) + piece.run.open + piece.run.rpr + MARK)
        at = max(at, min(b, piece.last))
    out.append(text_element(piece.text[at - piece.first :]))
    return "".join(out)


def apply_matches(xml, per_paragraph):
    """Splice each (paragraph, matches) into xml, then drop the runs the splices emptied."""
    edits = []
    for para, matches in per_paragraph:
        for piece in para.pieces:
            if any(a < piece.last and piece.first < b for a, b, _ in matches):
                edits.append((piece.el_start, piece.el_end, spliced(piece, matches)))
    out, at = [], 0
    for start, end, new in sorted(edits):
        out += [xml[at:start], new]
        at = end
    out.append(xml[at:])
    return EMPTIED_RUN.sub("", "".join(out)).replace(MARK, "")


def replace_values(xml, patterns, counts):
    """patterns runs longest value first, so a longer value keeps the words a shorter one shares."""
    per_paragraph = []
    for para in paragraphs(xml):
        text = fold(para.text)
        taken = kept_placeholders(para)
        matches = []
        for value, pattern, placeholder in patterns:
            for m in pattern.finditer(text):
                a, b = m.span()
                if all(b <= x or y <= a for x, y in taken):
                    taken.append((a, b))
                    matches.append((a, b, placeholder))
                    counts[value] += 1
        if matches:
            per_paragraph.append((para, sorted(matches)))
    return apply_matches(xml, per_paragraph)


def visible_text(xml):
    """What a part shows or stores as text, in folded lower case, less its kept placeholders."""
    per_paragraph = []
    for para in paragraphs(xml):
        spans = kept_placeholders(para)
        if spans:
            per_paragraph.append((para, [(a, b, None) for a, b in spans]))
    bare = apply_matches(xml, per_paragraph)
    words = re.sub(r"<[^>]+>", "", bare) + GAP + GAP.join(TEXT_ATTRIBUTE.findall(xml))
    return fold(html.unescape(words)).casefold()


def check_request(req):
    if not isinstance(req, dict):
        raise Refusal("bad_request", "The request must be a JSON object.")
    missing = [k for k in ("source", "out_dir", "name", "replacements") if k not in req]
    if missing:
        raise Refusal("bad_request", "The request lacks " + ", ".join(missing) + ".")
    name = req["name"]
    if not isinstance(name, str) or not name.strip() or re.search(r"[\\/]", name):
        raise Refusal("bad_request", "name must be a file name with no folder.")
    if not isinstance(req["replacements"], list):
        raise Refusal("bad_request", "replacements must be a list.")
    seen = set()
    for item in req["replacements"]:
        value = item.get("value") if isinstance(item, dict) else None
        placeholder = item.get("placeholder") if isinstance(item, dict) else None
        if not isinstance(value, str) or not value.strip():
            raise Refusal("bad_request", "Each replacement needs a non-empty value.")
        if not isinstance(placeholder, str) or not PLACEHOLDER.match(placeholder):
            raise Refusal("bad_request", "A placeholder must be one pair of square brackets around its name: %r." % placeholder)
        if value in seen:
            raise Refusal("bad_request", "A value appears twice: %r." % value)
        seen.add(value)


def read_parts(source):
    """The file's parts in order, as (ZipInfo, bytes)."""
    try:
        with zipfile.ZipFile(source) as docx:
            parts = [(info, docx.read(info.filename)) for info in docx.infolist()]
    except FileNotFoundError:
        raise Refusal("not_a_docx", "No file can be read at " + source + ".")
    except (zipfile.BadZipFile, OSError) as err:
        raise Refusal("not_a_docx", "%s is not a saved Word .docx file: %s." % (source, err))
    if not any(info.filename == "word/document.xml" for info, _ in parts):
        raise Refusal("not_a_docx", source + " is not a saved Word .docx file: it has no main document.")
    return parts


def word_text(info, data):
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as err:
        raise Refusal("not_a_docx", "%s could not be read as text: %s." % (info.filename, err))


def check_leftovers(parts, stem, values):
    hits = []
    needles = [(v, fold(v).casefold()) for v in values]
    for info, data in parts:
        if info.filename.endswith((".xml", ".rels")):
            text = visible_text(data.decode("utf-8", "replace"))
            hits += [{"value": v, "where": info.filename} for v, needle in needles if needle in text]
    name = fold(stem).casefold()
    hits += [{"value": v, "where": "the file name"} for v, needle in needles if needle in name]
    if hits:
        raise Refusal("leftover", json.dumps(hits, ensure_ascii=False))


def write_new(out_dir, stem, data):
    n = 1
    while True:
        path = os.path.join(out_dir, "%s.docx" % stem if n == 1 else "%s (%d).docx" % (stem, n))
        try:
            with open(path, "xb") as fh:
                fh.write(data)
            return path
        except FileExistsError:
            n += 1
        except OSError as err:
            raise Refusal("write_failed", "%s could not be written: %s." % (path, err))


def make(req):
    check_request(req)
    stem = re.sub(r"\.docx$", "", req["name"].strip(), flags=re.I)
    if not os.path.isdir(req["out_dir"]):
        raise Refusal("no_folder", "No folder can be reached at " + req["out_dir"] + ".")
    parts = read_parts(req["source"])

    wanted = sorted(req["replacements"], key=lambda r: -len(r["value"]))
    patterns = [
        (r["value"], re.compile(r"(?<!\w)" + re.escape(fold(r["value"])) + r"(?!\w)"), r["placeholder"]) for r in wanted
    ]
    values = [r["value"] for r in wanted]
    counts = dict.fromkeys(values, 0)
    new_parts = []
    for info, data in parts:
        if SCANNED.match(info.filename):
            data = replace_values(word_text(info, data), patterns, counts).encode("utf-8")
        new_parts.append((info, data))

    # A value found only inside a longer value's matches was still found.
    missing = [v for v in values if not counts[v] and not any(counts[o] and v in o for o in values if o != v)]
    if missing:
        raise Refusal("value_not_found", json.dumps(missing, ensure_ascii=False))
    check_leftovers(new_parts, stem, values)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as out:
        for info, data in new_parts:
            out.writestr(info, data, compress_type=info.compress_type)
    path = write_new(req["out_dir"], stem, buffer.getvalue())
    replaced = {}
    for r in wanted:
        replaced[r["placeholder"]] = replaced.get(r["placeholder"], 0) + counts[r["value"]]
    return {"success": True, "path": os.path.abspath(path), "replaced": replaced}


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"success": False, "error": "bad_request", "detail": "Pass one argument: the request file."}))
        return 0
    try:
        with open(sys.argv[1], encoding="utf-8-sig") as fh:
            req = json.load(fh)
        result = make(req)
    except Refusal as err:
        result = {"success": False, "error": err.code, "detail": err.detail}
    except (OSError, ValueError) as err:
        result = {"success": False, "error": "bad_request", "detail": "The request file could not be read: %s." % err}
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
