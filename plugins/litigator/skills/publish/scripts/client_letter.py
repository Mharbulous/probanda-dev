#!/usr/bin/env python3
"""A client letter's Word review draft (/draft letters.md section 10): fill it, or lift its hold.

drafting_forms__draft_harness runs this host-side, one JSON request on stdin, one JSON line out.
Every request carries `out_dir` (the matter's 0. DRAFT folder), `output_name` (a stem, any " vN"
ignored) and `profile` (the firm profile as the server read it). No database is opened.

action fill: `letter` is render_letterhead.py's payload. Only the profile's registered letterhead
is filled, the signing space stays blank, and the first paragraph is the hold line. A Word or PDF
deliverable is never overwritten, so a revision is the next " vN", naming the copy it revises in
`revises` (a stem), which must be the newest. The earlier copy is read by nothing here and stays as
it is, Word edits included: it may be the practitioner's own file (Commandment 7).

action approve: this machine's `person` must be an active roster lawyer. Removes the hold line and
the blank after it from the newest copy. Every other paragraph and part stays as it stands, Word
edits included, because the file is rewritten around them and never rendered again.

Refusals: {"success": false, "error", "detail"}: copy_exists, newer_copy, letterhead_refused,
not_a_roster_lawyer, no_hold, open_in_word, not_found. Each writes nothing.

Stdlib only.
"""
import html
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_letterhead  # noqa: E402

fill_general = render_letterhead.fill_general

HOLD = "Counsel's review: pending"
HOLD_LINE = re.compile(r"^Counsel['’]s review:\s*pending\b")
VERSION = re.compile(r" v\d+$")
# A paragraph as Word or build_body writes it. <w:pPr> and <w:proofErr> do not match: the name must end at the "p".
PARAGRAPH = re.compile(r"<w:p(?:\s[^>]*?)?(?:/>|>.*?</w:p>)", re.S)
RUN = re.compile(r"<w:r\b")
BODY_OPEN = re.compile(r"<w:body[^>]*>")


class Refusal(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def text_of(paragraph):
    return html.unescape(re.sub(r"<[^>]+>", "", paragraph)).strip()


def read_document(path):
    with zipfile.ZipFile(path) as docx:
        return docx.read(render_letterhead.DOCUMENT).decode("utf-8")


def hold_span(document):
    """Where the hold line and the blank after it sit, or None. Blank paragraphs above it are passed
    over, as the Work Board's reader does, so a blank typed above the line never reads as approved."""
    for match in PARAGRAPH.finditer(document, BODY_OPEN.search(document).end()):
        text = text_of(match.group(0))
        if not text:
            continue
        if not HOLD_LINE.match(text):
            return None
        after = PARAGRAPH.match(document, match.end())
        blank = after and not text_of(after.group(0)) and not RUN.search(after.group(0))
        return match.start(), after.end() if blank else match.end()
    return None


def check_closed(path):
    name = os.path.basename(path)
    if os.path.exists(os.path.join(os.path.dirname(path), "~$" + name[2:])):
        raise Refusal("open_in_word", name + " is open in Word. Ask the practitioner to save and close it, then call again. Nothing was written.")


def rewrite_document(path, document):
    """Replace word/document.xml, every other part copied through. A '~' temp file, then a rename."""
    tmp = os.path.join(os.path.dirname(path), "~%s.%d.tmp" % (os.path.basename(path), os.getpid()))
    try:
        with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, "w") as out:
            for info in src.infolist():
                data = document.encode("utf-8") if info.filename == render_letterhead.DOCUMENT else src.read(info.filename)
                out.writestr(info, data, compress_type=info.compress_type)
        os.replace(tmp, path)
    except PermissionError as err:
        raise Refusal("open_in_word", "%s could not be written, most likely because it is open in Word. "
                      "Ask the practitioner to save and close it, then call again. (%s)" % (os.path.basename(path), err))
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def series(req):
    """The next copy's path and the newest existing copy, or None."""
    stem = VERSION.sub("", req["output_name"])
    return fill_general.next_version(req["out_dir"], stem, "")


def same_file(a, b):
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def fill(req):
    render_letterhead.check_profile(req["profile"], "from the server")
    path, newest = series(req)
    revises = req.get("revises")
    if newest and not revises:
        raise Refusal("copy_exists", "%s already exists. A revision names the copy it revises in revises. Nothing was written." % os.path.basename(newest))
    prior = None
    if revises:
        prior = os.path.join(req["out_dir"], revises + ".docx")
        if not newest or not same_file(prior, newest):
            raise Refusal("newer_copy", "revises names %s, but the newest copy is %s. Ask the practitioner which text stands. Nothing was written."
                          % (os.path.basename(prior), os.path.basename(newest) if newest else "none"))
    letter = {**req["letter"], "warning": HOLD}
    render_letterhead.render(letter, req["profile"], path, scan=False)
    result = {"success": True, "path": os.path.abspath(path)}
    if prior:
        result["versioned_from"] = os.path.abspath(prior)
    return result


def approve(req):
    profile = req["profile"]
    person = profile.get("person")
    entry = next((e for e in profile.get("roster") or [] if e.get("key") == person), None)
    if entry is None or entry.get("role") != "lawyer" or entry.get("active") is False:
        raise Refusal("not_a_roster_lawyer", "Only an active roster lawyer, the person on this machine, approves a client letter. "
                      "Name the lawyer who must review it. Nothing was written.")
    path = os.path.join(req["out_dir"], req["output_name"] + ".docx")
    _, newest = series(req)
    if not os.path.isfile(path):
        raise Refusal("not_found", "no file at " + path)
    if not same_file(path, newest):
        raise Refusal("newer_copy", "%s is not the newest copy: %s is. Nothing was written." % (os.path.basename(path), os.path.basename(newest)))
    document = read_document(path)
    span = hold_span(document)
    if span is None:
        raise Refusal("no_hold", os.path.basename(path) + " has no hold line, so it is already approved. Nothing was written.")
    check_closed(path)
    rewrite_document(path, document[:span[0]] + document[span[1]:])
    return {"success": True, "path": os.path.abspath(path), "approved_by": entry.get("name")}


def main():
    req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    try:
        result = {"fill": fill, "approve": approve}[req["action"]](req)
    except Refusal as err:
        result = {"success": False, "error": err.code, "detail": err.detail}
    except SystemExit as err:  # render_letterhead stops by naming the problem
        result = {"success": False, "error": "letterhead_refused", "detail": str(err.code)}
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
