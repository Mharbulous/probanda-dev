"""Build a general Writing's .docx: publish-general's fill, and the letter body builder.

Two halves. The library half, build_body(), builds a letter's body as WordprocessingML for
splicing into a letterhead. It reads no config file and no firm profile: everything arrives
in the data it is given. publish/scripts/render_letterhead.py resolves the signer, the
preparer and the signature, then calls build_body(). The CLI half, main(), is
publish-general's fill; its contract is under "The CLI" below.

build_body(data) reads:
    warning         str            optional, a review copy's format warning, printed bold as
                                   the body's first paragraph
    date            str            required
    recipient       [str]          address block lines, unless recipients is given
    attention       str            optional, bolded under the address after "Attention: "
    delivery        str            optional, e.g. "VIA EMAIL ONLY"
    recipient_email str or [str]   optional, italic under the delivery line
    recipients      [obj]          one address block per entry, in order, each
                                   {recipient, attention?, delivery?, recipient_email?}
    salutation      str            required
    re              [str]          required, RE: lines, printed after "Re:"
    body            [str]          required, paragraphs (see markup below)
    closing         str            required, e.g. "Yours very truly,"
    firm_name       str            required
    signer_name     str            required
    initials        str            required, the initials line
    signature       obj or None    {rid, cx, cy}: an inline image in the signing space,
                                   `rid` its relationship id and cx/cy its size in EMU.
                                   None leaves a blank signing space of three empty lines.
    enclosures      [str]          optional, non-empty adds an "Encl." block
    cc              [str or obj]   optional. A non-empty string renders "cc. <string>". An
                                   object {name, email?}, `name` a non-empty string and
                                   `email` a string, renders "cc. <name>, " plus the email
                                   italicized in the same small size.
    `enclosures` or `cc` that is present, not null and not a list of that shape is refused
    (list_fields_problem): a string would print one line per character.

Body paragraph markup: **bold**, *italic*, __underline__. A paragraph starting with
"- ", "* " or "1. " is rendered as a hanging-indent list item; the marker prints
verbatim, not incremented.

The CLI (publish-general):

    python fill_general.py --filed filed.json --format format.json --out-dir DIR --out-name STEM
        [--letter letter.json --profile profile.json] [--tokens tokens.json]

--filed    drafting_forms__render's filed-mode response, saved as it came. It must carry
           exactly one `General_writing` document, whose `markdown` is the filed face, and
           `stored_layout`, the Writing's stored layout as storedLayout() returns it, whose
           `layout` block gives `renderer` (general) and `letterhead`.
--format   knowledge__read's response for the venue's format.md, saved as it came: `path`,
           `learned` (false for a vetted file), `format` (the block's properties, the firm's
           corrections substituted) and `items` (each with its effective `status` and
           `freshness`, and `pdf_page` when it was transcribed from a PDF).
--out-dir  the matter's draft folder, an existing folder the .docx files are written to at
           its root (else no_out_dir).
--out-name the deliverable's base name, composed by the caller under the firm's file-naming
           convention: the deliverable is `<stem>.docx` and the review copy
           `<stem> (format unverified).docx`. A stem that is empty, carries \\ / : * ? " < > |,
           ends in a file extension or ends in " v<n>" is refused (bad_input).

Versioning: each series, deliverable and review copy, is versioned on its own. The unsuffixed
name counts as v1 and `<stem> vN.docx` (`<stem> vN (format unverified).docx`) as vN. With none
present the unsuffixed name is written, else v(highest + 1), and the result reports the highest
existing copy as `versioned_from` (`review_copy_versioned_from` for the review copy). Each copy
is written to a `~`-prefixed temporary file in the same folder and then renamed, so an existing
file is never overwritten and a killed fill leaves no partial deliverable.
--letter, --profile   a `letterhead: true` Writing only: render_letterhead.py's payload and
           practice_data__firm_profile's response. The payload is checked against the filed
           face: each `body` paragraph must be a paragraph of it (else
           letter_body_not_in_filed_face); `salutation`, each `re` line and each `attention`
           (top-level and in `recipients`) must be a line of it, a face line's leading "Re:",
           "Attention:" or "Attn:" set aside (else letter_field_not_in_filed_face);
           no `attention`, `re`, `cc` or `enclosures` value may carry the label build_body
           prints before it (else letter_field_carries_label);
           and `body` must hold, in order, every paragraph of the face that is not a
           signature-block or recipient line and that no other payload field prints (else
           letter_body_incomplete). The letter is rendered by
           render_letterhead.render(). The registered letterhead's own styles govern: every
           property the format file sets is ignored and reported under
           `overridden_by_letterhead`.
--tokens   a JSON object giving the value of each letterhead token that the format file's
           `header` or `footer` carries. A token with no value fails.

The format block is validated again here (shared/declared-format.md section 1): an unknown
property, a value of the wrong type or a malformed length fails hard, naming the file, the
property and the rule. A property the file omits takes the generic template's default and
is reported under `defaulted`:

    paper                     letter
    margins                   1 in on every side
    typeface                  Times New Roman
    font_size                 12 pt
    line_spacing              1 (single)
    page_numbering            none
    header, footer            none
    filing_stamp_reservation  none

The generic template reads `page_numbering` as `position` (top-left, top-center, top-right,
bottom-left, bottom-center or bottom-right), `format` (arabic, lower-roman or upper-roman)
and `first_page` (true or false: whether page one shows its number). A
`filing_stamp_reservation` is blank space above the first paragraph of page one.

The confirmation loop (shared/declared-format.md; #970): while any item the block cites
reads `unconfirmed`, which includes a stale confirmation, only the review copy
`<stem> (format unverified).docx` is written, and the deliverable is refused: the script
exits non-zero naming each such rule_ref. A vetted file (`learned: false`) never blocks the
deliverable, whatever its items read: a cited item whose source the session's check found
missing is warned of in a review copy written beside the deliverable. The warning is the body's first paragraph, `Format unverified:
<rule_ref>[, transcribed from PDF p. <n>]` or `Source changed: <rule_ref>`, joined by "; ".
It is never in a header or footer part, and no document property carries it.

The signature block keeps with the paragraph before it. On the letterhead, build_body()
chains it. Otherwise the last three paragraphs of the body, before the recipient lines,
keep with the next: the signature-block projection prints at most two paragraphs, the
closing and then the signing lines, so the chain always reaches the paragraph before it.
That paragraph keeps its lines together unless it is longer than LONG_LAST_PARAGRAPH.

Prints one JSON line: {"success": true, "deliverable": ..., "versioned_from"?: ...,
"review_copy"?: ..., "review_copy_versioned_from"?: ..., "defaulted": [...], "overridden_by_letterhead"?: [...], "not_rendered"?: [...]}, or
{"success": false, "error": "<code>", "detail": "...", ...}. `not_rendered` names any other
document the filed render returned, such as a declared companion, which this fill does not
render. A `deliverable_refused` refusal carries `review_copy` and `unconfirmed`, each item's
`rule_ref`, `property` and the `value` the file records, which is the value applied unless the
item also carries `overridden_by_letterhead: true`: on a letterhead Writing the letterhead
replaces every property, so its value is not applied, and the item still blocks. Exit 0 on success, 1 on a refusal, never a
traceback.

Stdlib only.
"""

import argparse
import json
import math
import os
import re
import sys
import traceback
import zipfile

# Run properties lifted verbatim from the template, so output inherits the theme fonts
# rather than naming a typeface the theme may not use.
MINOR = ('<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorHAnsi"/>')

# No run here names a proofing language: every run inherits the template's docDefaults.
# Adding <w:lang> to a call site would give this file a second, silently divergent copy of
# the answer. Fix the template instead.

# CT_RPr (ECMA-376 17.3.2.28) fixes the order of a run's property children. Call sites here
# concatenate fragments -- MINOR + emphasis, small + emphasis -- and concatenation order is
# not schema order, so every <w:rPr> is sorted at serialisation rather than trusted to the
# order a caller happened to build. Word tolerates an out-of-order rPr; a validator or
# another OOXML library need not.
RPR_ORDER = (
    "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike",
    "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden",
    "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect",
    "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout",
    "specVanish", "oMath",
)
RPR_ELEMENT = re.compile(r"<w:([A-Za-z]+)\b[^>]*/>")


def rpr(fragment):
    """Serialise concatenated run-property elements as a schema-ordered <w:rPr>."""
    elements = []
    pos = 0
    for m in RPR_ELEMENT.finditer(fragment):
        if m.start() != pos:
            raise ValueError("not a run-property element: " + fragment[pos:m.start()])
        if m.group(1) not in RPR_ORDER:
            raise ValueError("not a CT_RPr child: w:" + m.group(1))
        elements.append((RPR_ORDER.index(m.group(1)), m.group(0)))
        pos = m.end()
    if pos != len(fragment):
        raise ValueError("not a run-property element: " + fragment[pos:])
    elements.sort(key=lambda pair: pair[0])  # stable: duplicates keep their order
    return "<w:rPr>" + "".join(xml for _, xml in elements) + "</w:rPr>"

# Table properties and grid copied from the template's recipient block.
TBL_PR = (
    '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10348" w:type="dxa"/>'
    '<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
    '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
    '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
    '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
    '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
    '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>'
    '<w:tblLayout w:type="fixed"/>'
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>'
    '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0"'
    ' w:noHBand="0" w:noVBand="1"/></w:tblPr>'
    '<w:tblGrid><w:gridCol w:w="6096"/><w:gridCol w:w="4252"/></w:tblGrid>'
)

# Three empty lines between "per" and the signer's name, left for the signer's own hand.
SIGNING_SPACE_LINES = 3

# A last body paragraph longer than this is allowed to split across a page break rather
# than be kept whole (see build_body). At 12 pt on the letterhead's 7.2-inch measure a
# line holds about 95 characters and a page about 40 lines, so 1,800 characters is
# roughly half a page. Kept whole, a paragraph that long would leave half a page blank.
LONG_LAST_PARAGRAPH = 1800

LIST_MARKER = re.compile(r"^\s*(-|\*|\d+\.)\s+")
EMPHASIS = re.compile(r"\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*")

# The scanned signature, inline in the signing space. Namespaces are declared on the
# elements that use them, so the drawing parses whatever the template's root declares.
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def esc(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def runs(text, rpr_extra=""):
    """Split text on **bold** / __underline__ / *italic* into `<w:r>` elements."""
    out = []
    pos = 0
    for m in EMPHASIS.finditer(text):
        if m.start() > pos:
            out.append(run(text[pos:m.start()], rpr_extra))
        bold, under, italic = m.group(1), m.group(2), m.group(3)
        if bold is not None:
            out.append(run(bold, rpr_extra + "<w:b/><w:bCs/>"))
        elif under is not None:
            out.append(run(under, rpr_extra + '<w:u w:val="single"/>'))
        else:
            out.append(run(italic, rpr_extra + "<w:i/><w:iCs/>"))
        pos = m.end()
    if pos < len(text):
        out.append(run(text[pos:], rpr_extra))
    return "".join(out) or run("", rpr_extra)


def run(text, rpr_extra=""):
    return ('<w:r>' + rpr(rpr_extra)
            + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>')


def para(text, ppr="", rpr_extra="", markup=False):
    inner = runs(text, rpr_extra) if markup else run(text, rpr_extra)
    return '<w:p><w:pPr>' + ppr + rpr(rpr_extra) + '</w:pPr>' + inner + '</w:p>'


def blank(rpr_extra):
    return '<w:p><w:pPr>' + rpr(rpr_extra) + '</w:pPr></w:p>'


def body_paragraph(text, rpr_extra=MINOR):
    marker = LIST_MARKER.match(text)
    if not marker:
        ppr = '<w:ind w:right="0"/><w:jc w:val="both"/>'
        return para(text, ppr, rpr_extra, markup=True)
    label = marker.group(1)
    bullet = "•" if label in ("-", "*") else label
    rest = text[marker.end():]
    ppr = '<w:ind w:left="567" w:right="0" w:hanging="567"/><w:jc w:val="both"/>'
    return ('<w:p><w:pPr>' + ppr + rpr(rpr_extra) + '</w:pPr>'
            + run(bullet, rpr_extra)
            + '<w:r>' + rpr(rpr_extra) + '<w:tab/></w:r>'
            + runs(rest, rpr_extra) + '</w:p>')


def recipient_block(entry):
    left = "".join(para(line, "", MINOR) for line in entry["recipient"])
    if entry.get("attention"):
        left += para("Attention: " + entry["attention"], "", MINOR + "<w:b/><w:bCs/>")
    else:
        left += blank(MINOR)

    right = ""
    if entry.get("delivery"):
        right += para(entry["delivery"],
                      '<w:keepNext/><w:keepLines/><w:jc w:val="right"/>',
                      MINOR + '<w:b/><w:bCs/>')
    emails = entry.get("recipient_email") or []
    if isinstance(emails, str):
        emails = [emails]
    for address in emails:
        right += para(address, '<w:jc w:val="right"/>', MINOR + "<w:i/><w:iCs/>")
    right += blank(MINOR)

    return ('<w:tbl>' + TBL_PR
            + '<w:tr><w:trPr><w:trHeight w:val="1118"/></w:trPr>'
            + '<w:tc><w:tcPr><w:tcW w:w="6096" w:type="dxa"/></w:tcPr>' + left + '</w:tc>'
            + '<w:tc><w:tcPr><w:tcW w:w="4252" w:type="dxa"/></w:tcPr>' + right + '</w:tc>'
            + '</w:tr></w:tbl>')


def recipient_blocks(data):
    """One block per `recipients` entry, or a single block from the top-level
    recipient/attention/delivery/recipient_email keys. Blocks are separated by a
    blank paragraph -- adjacent <w:tbl> elements with no intervening <w:p> get
    merged into one table by Word, so this separator is structural, not cosmetic.
    """
    entries = data.get("recipients") or [data]
    parts = []
    for i, entry in enumerate(entries):
        if i:
            parts.append(blank(MINOR))
        parts.append(recipient_block(entry))
    return "".join(parts)


def re_block(lines):
    bold = MINOR + "<w:b/>"
    ppr = ('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>'
           '<w:ind w:left="567" w:right="0" w:hanging="567"/>')
    inner = run("Re:", bold) + '<w:r>' + rpr(bold) + '<w:tab/></w:r>'
    for i, line in enumerate(lines):
        if i:
            inner += '<w:r>' + rpr(bold) + '<w:br/></w:r>'
        inner += runs(line, bold)
    return '<w:p><w:pPr>' + ppr + rpr(bold) + '</w:pPr>' + inner + '</w:p>'


def signature_paragraph(signature, rpr_extra):
    """One paragraph holding the scanned signature as an inline image."""
    size = '<wp:extent cx="%d" cy="%d"/>' % (signature["cx"], signature["cy"])
    ext = '<a:ext cx="%d" cy="%d"/>' % (signature["cx"], signature["cy"])
    return (
        '<w:p><w:pPr><w:ind w:right="0"/>' + rpr(rpr_extra) + '</w:pPr>'
        '<w:r>' + rpr(rpr_extra + '<w:noProof/>') + '<w:drawing>'
        '<wp:inline xmlns:wp="' + WP + '" distT="0" distB="0" distL="0" distR="0">'
        + size + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
        '<wp:docPr id="874205146" name="signature"/>'
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="' + A + '" noChangeAspect="1"/>'
        '</wp:cNvGraphicFramePr>'
        '<a:graphic xmlns:a="' + A + '"><a:graphicData uri="' + PIC + '">'
        '<pic:pic xmlns:pic="' + PIC + '">'
        '<pic:nvPicPr><pic:cNvPr id="397844086" name="signature"/>'
        '<pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr>'
        '</pic:nvPicPr>'
        '<pic:blipFill><a:blip xmlns:r="' + R + '" r:embed="' + signature["rid"] + '"/>'
        '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        '<pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/>' + ext + '</a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>'
        '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    )


def keep_together(paragraph, keep_lines=True, widow_control=False, keep_next=True):
    """Add keepNext, and keepLines / widowControl, to a paragraph built here.

    CT_PPrBase fixes the order pStyle, keepNext, keepLines, pageBreakBefore, framePr,
    widowControl, ...; no paragraph here carries pageBreakBefore or framePr, so all three
    go straight after pStyle, or first when there is none. One already present is kept.
    """
    head = "<w:p><w:pPr>"
    if not paragraph.startswith(head):
        raise ValueError("not a paragraph with properties: " + paragraph[:40])
    at = len(head)
    style = re.match(r"<w:pStyle\b[^>]*/>", paragraph[at:])
    if style:
        at += style.end()
    ppr = paragraph[:paragraph.index("</w:pPr>")]
    names = ["keepNext"] * keep_next + ["keepLines"] * keep_lines + ["widowControl"] * widow_control
    add = "".join("<w:%s/>" % n for n in names if "<w:%s/>" % n not in ppr)
    return paragraph[:at] + add + paragraph[at:]


def list_fields_problem(data):
    """What is wrong with the payload's `attention`, `enclosures` or `cc`, or None. Absent or
    null `attention` means no Attention line. Absent, null and [] `enclosures` or `cc` mean no
    Encl. block and no cc lines. Every route to build_body checks this first."""
    entries = [("attention", data)]
    entries += [("recipients[%d].attention" % i, entry)
                for i, entry in enumerate(data.get("recipients") or []) if isinstance(entry, dict)]
    for path, holder in entries:
        attention = holder.get("attention")
        if attention is not None and not isinstance(attention, str):
            return "`%s` must be a string, not %r" % (path, attention)
    enclosures = data.get("enclosures")
    if enclosures is not None and not (isinstance(enclosures, list)
                                       and all(isinstance(e, str) for e in enclosures)):
        return "`enclosures` must be a list of strings, not %r" % (enclosures,)
    cc = data.get("cc")
    if cc is None:
        return None
    if not isinstance(cc, list):
        return ("`cc` must be a list, each entry a non-empty string or an object "
                "{name, email?}, not %r" % (cc,))
    for i, entry in enumerate(cc):
        if isinstance(entry, str) and entry:
            continue
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not entry["name"]:
            return "cc[%d] must be a non-empty string or an object with a non-empty string `name`" % i
        if "email" in entry and not isinstance(entry["email"], str):
            return "cc[%d].email must be a string" % i
    return None


def build_body(data):
    small = MINOR + '<w:sz w:val="16"/><w:szCs w:val="16"/>'
    parts = []
    if data.get("warning"):
        parts += [para(data["warning"], "", MINOR + "<w:b/><w:bCs/>"), blank(MINOR)]
    parts += [
        para(data["date"], "", MINOR),
        blank(MINOR),
        recipient_blocks(data),
        blank(MINOR),
        para(data["salutation"], "", MINOR),
        blank(MINOR),
        re_block(data["re"]),
        blank(MINOR),
    ]
    for i, text in enumerate(data["body"][:-1]):
        if i:
            parts.append(blank(MINOR))
        parts.append(body_paragraph(text))
    if len(data["body"]) > 1:
        parts.append(blank(MINOR))
    # The signature block must never sit alone on a page. Every paragraph from the last
    # body paragraph to the signer's name keeps with the next, so the chain moves as one
    # unit anchored to the initials line. Enclosures and cc lines flow freely. A last
    # paragraph of up to LONG_LAST_PARAGRAPH characters is also kept whole, so all of it
    # lands on the signing page. A longer one may split: it keeps keepNext but not
    # keepLines, and widowControl carries its last lines over with the closing. Widow
    # control is on/off in OOXML and guarantees two lines, not three.
    last = data["body"][-1]
    long_last = len(last) > LONG_LAST_PARAGRAPH
    size = MINOR + '<w:szCs w:val="24"/>'
    if data.get("signature"):
        signing_space = [signature_paragraph(data["signature"], size)]
    else:
        signing_space = [blank(size)] * SIGNING_SPACE_LINES
    parts.append(keep_together(body_paragraph(last),
                               keep_lines=not long_last, widow_control=long_last))
    parts += [keep_together(p) for p in [
        blank(MINOR),
        para(data["closing"], '<w:ind w:right="0"/>', size),
        para(data["firm_name"], '<w:ind w:right="0"/>',
             MINOR + '<w:smallCaps/><w:sz w:val="28"/><w:szCs w:val="28"/>'),
        para("per", '<w:ind w:right="0"/>', size),
    ] + signing_space + [
        para(data["signer_name"], '<w:ind w:right="0"/>', size),
    ]]
    parts.append(para(data["initials"], '<w:ind w:right="0"/>', size))
    if data.get("enclosures"):
        ppr = '<w:ind w:left="851" w:right="0" w:hanging="851"/>'
        first = data["enclosures"][0]
        parts.append('<w:p><w:pPr>' + ppr + rpr(small) + '</w:pPr>'
                     + run("Encl.", small)
                     + '<w:r>' + rpr(small) + '<w:tab/></w:r>'
                     + run(first, small) + '</w:p>')
        for item in data["enclosures"][1:]:
            parts.append(para(item, '<w:ind w:left="851" w:right="0"/>', small))
    for entry in data.get("cc") or []:
        ppr = '<w:ind w:right="0"/>'
        if isinstance(entry, str):
            parts.append(para("cc. " + entry, ppr, small))
            continue
        name, email = entry["name"], entry.get("email")
        if email:
            parts.append('<w:p><w:pPr>' + ppr + rpr(small) + '</w:pPr>'
                         + run("cc. " + name + ", ", small)
                         + run(email, small + "<w:i/><w:iCs/>") + '</w:p>')
        else:
            parts.append(para("cc. " + name, ppr, small))
    return "".join(parts)


# ---------------------------------------------------------------------------
# publish-general: the generic template and the CLI
# ---------------------------------------------------------------------------

PUBLISH_SCRIPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts")

FORMAT_PROPERTIES = ("paper", "margins", "typeface", "font_size", "line_spacing",
                     "page_numbering", "header", "footer", "filing_stamp_reservation")
PAPER = {"letter": (12240, 15840), "legal": (12240, 20160), "a4": (11906, 16838)}
SIDES = ("top", "bottom", "left", "right")
LENGTH = re.compile(r"^(\d+(?:\.\d+)?) (mm|cm|in|pt)$")
TWIPS = {"in": 1440.0, "cm": 1440 / 2.54, "mm": 1440 / 25.4, "pt": 20.0}
TOKEN = re.compile(r"\{\{[^{}]*\}\}")

# The generic template's default for each property a format file omits (documented above).
DEFAULTS = {
    "paper": "letter",
    "margins": {side: "1 in" for side in SIDES},
    "typeface": "Times New Roman",
    "font_size": "12 pt",
    "line_spacing": 1,
    "page_numbering": None,
    "header": "",
    "footer": "",
    "filing_stamp_reservation": None,
}
POSITIONS = {"top-left": ("header", "left"), "top-center": ("header", "center"),
             "top-right": ("header", "right"), "bottom-left": ("footer", "left"),
             "bottom-center": ("footer", "center"), "bottom-right": ("footer", "right")}
NUMBER_FORMATS = {"arabic": "decimal", "lower-roman": "lowerRoman", "upper-roman": "upperRoman"}

GENERAL_WRITING = "General_writing"
REVIEW_SUFFIX = " (format unverified)"
# What an --out-name stem may not carry: a character Windows forbids in a file name, a file
# extension, or the " v<n>" this fill appends itself.
BAD_STEM = re.compile(r'[\\/:*?"<>|]|\.(docx?|pdf)$| v\d+$', re.I)
# The paragraph before the signature block, the closing, and the signing lines.
SIGNATURE_CHAIN = 3
RECIPIENT_LINE = re.compile(r"^(To|cc): ")
SIGNING_RULE = re.compile(r"^\s*_{3,}\s*$")
# A face line's label, which the letterhead prints itself: "Re:" before the re lines, and
# "Attention:" before the attention line.
LINE_LABEL = re.compile(r"^\s*(re|attention|attn)\s*:\s*", re.I)
# The label build_body prints before each of these fields' values, so a payload value
# carrying it would print it twice.
PRINTED_LABEL = {
    "attention": re.compile(r"^\s*(attention|attn)\s*:", re.I),
    "re": re.compile(r"^\s*re\s*:", re.I),
    "cc": re.compile(r"^\s*cc\s*[.:]", re.I),
    "enclosures": re.compile(r"^\s*encl(osures?)?\s*[.:]", re.I),
}
# The payload fields that print a face line outside `body`.
LETTER_FIELDS = ("date", "salutation", "re", "recipient", "recipients", "attention", "delivery",
                 "recipient_email", "enclosures", "cc")
BOLD = "<w:b/><w:bCs/>"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
WML_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml."


class FillError(Exception):
    """A refusal: printed as one JSON line naming `code`, never a traceback."""

    def __init__(self, code, detail, **extra):
        super().__init__("%s: %s" % (code, detail))
        self.code, self.detail, self.extra = code, detail, extra


def _render_letterhead():
    """publish/scripts/render_letterhead.py, imported on first use, because it imports this module."""
    path = os.path.abspath(PUBLISH_SCRIPTS)
    if path not in sys.path:
        sys.path.insert(0, path)
    import render_letterhead
    return render_letterhead


def _letterhead_call(fn, *args):
    """render_letterhead stops with sys.exit(message); report that as a refusal."""
    try:
        return fn(*args)
    except SystemExit as err:
        raise FillError("letterhead_refused", str(err.code))


def load(path, what):
    try:
        with open(path, encoding="utf-8-sig") as fh:
            return json.load(fh)
    except OSError as err:
        raise FillError("missing_input", "%s %s: %s" % (what, path, err))
    except ValueError as err:
        raise FillError("bad_input", "%s %s is not valid JSON: %s" % (what, path, err))


def scalar(raw):
    """A layout scalar, bare or cited as {value, rule_ref}."""
    if isinstance(raw, dict) and "value" in raw and "rule_ref" in raw:
        return raw["value"]
    return raw


# ------------------------------------------------------------ the format block --

def is_length(value, unit=None):
    match = LENGTH.match(value) if isinstance(value, str) else None
    return match is not None and (unit is None or match.group(2) == unit)


def twips(length):
    number, unit = LENGTH.match(length).groups()
    return int(round(float(number) * TWIPS[unit]))


def check_value(prop, value, field, fail):
    length = 'must be a length "<number> <unit>", the unit one of mm, cm, in or pt, e.g. "25 mm"'
    if prop == "paper":
        if not isinstance(value, str) or value not in PAPER:
            fail(field, "must be one of letter, legal, a4")
    elif prop == "margins":
        if not isinstance(value, dict) or sorted(value) != sorted(SIDES):
            fail(field, "must hold exactly top, bottom, left, right")
        for side in SIDES:
            if not is_length(value[side]):
                fail(field + "." + side, length)
    elif prop == "typeface":
        if not isinstance(value, str) or not value.strip():
            fail(field, "must be a non-empty string")
    elif prop == "font_size":
        if not is_length(value, "pt"):
            fail(field, length if not is_length(value) else "must be a length in pt")
        if float(LENGTH.match(value).group(1)) <= 0:
            fail(field, "must be greater than zero")
    elif prop == "line_spacing":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            fail(field, "must be a number")
        if value <= 0:
            fail(field, "must be greater than zero")
    elif prop == "page_numbering":
        if not isinstance(value, dict) or sorted(value) != ["first_page", "format", "position"]:
            fail(field, "must hold exactly position, format, first_page")
        for key, allowed in (("position", POSITIONS), ("format", NUMBER_FORMATS)):
            if not isinstance(value[key], str) or value[key] not in allowed:
                fail(field + "." + key, "must be one of " + ", ".join(allowed))
        if not isinstance(value["first_page"], bool):
            fail(field + ".first_page", "must be true or false")
    elif prop in ("header", "footer"):
        if not isinstance(value, str):
            fail(field, "must be a string")
        tokens = _render_letterhead().TOKENS
        unknown = [t for t in TOKEN.findall(value) if t not in tokens]
        if unknown:
            fail(field, "carries %s, outside the letterhead token set (%s)"
                 % (", ".join(unknown), ", ".join(tokens)))
    elif prop == "filing_stamp_reservation":
        if not is_length(value):
            fail(field, length)


def validate_format(fmt, file):
    """shared/declared-format.md section 1, run again at render. Fails hard naming the file,
    the property and the rule. Returns {rule_ref: property}."""
    def fail(field, rule):
        raise FillError("invalid_format", "%s: %s: %s" % (file, field, rule))

    if not isinstance(fmt, dict):
        fail("format", "must be an object of properties")
    refs = {}
    for prop, entry in fmt.items():
        if prop not in FORMAT_PROPERTIES:
            fail("format." + prop, "is not a settable property (the closed vocabulary: %s); "
                 "signature placement is never settable" % ", ".join(FORMAT_PROPERTIES))
        if not isinstance(entry, dict) or sorted(entry) != ["rule_ref", "value"]:
            fail("format." + prop, "must hold exactly value, rule_ref")
        ref = entry["rule_ref"]
        if not isinstance(ref, str) or not ref.strip():
            fail("format.%s.rule_ref" % prop, "must be a non-empty string")
        if ref in refs:
            fail("format.%s.rule_ref" % prop, '"%s" is already cited by format.%s; a rule_ref is '
                 "unique within the file" % (ref, refs[ref]))
        refs[ref] = prop
        check_value(prop, entry["value"], "format.%s.value" % prop, fail)
    return refs


def template_settings(fmt):
    """Each property's value, the file's or the generic template's default."""
    return {prop: fmt[prop]["value"] if prop in fmt else DEFAULTS[prop] for prop in FORMAT_PROPERTIES}


# ------------------------------------------------------------ the filed face --

def filed_blocks(markdown, name):
    """The filed face as blocks: ("title" | "heading" | "cite", text), ("quote", [lines]) for a
    fenced excerpt, and ("para", [lines]) for lines up to a blank line."""
    blocks, lines, fence = [], [], None

    def close():
        if lines:
            blocks.append(("para", lines[:]))
            del lines[:]

    for raw in markdown.splitlines():
        line = raw.rstrip()
        if fence is not None:
            if line.strip().startswith("```"):
                blocks.append(("quote", fence))
                fence = None
            else:
                fence.append(line)
        elif not line.strip():
            close()
        elif line.strip().startswith("```"):
            close()
            fence = []
        elif line.startswith("# "):
            close()
            blocks.append(("title", line[2:].strip()))
        elif re.match(r"#{2,6} ", line):
            close()
            blocks.append(("heading", line.lstrip("#").strip()))
        elif line.startswith("> "):
            close()
            blocks.append(("cite", line[2:]))
        else:
            lines.append(line)
    if fence is not None:
        raise FillError("out_of_grammar", "%s: a quotation fence is never closed" % name)
    close()
    return blocks


def normalized(text):
    return " ".join(text.split())


def face_texts(blocks):
    """Every paragraph and line of the filed face, whitespace-normalized."""
    texts = set()
    for _kind, value in blocks:
        for text in ([value] if isinstance(value, str) else value + [" ".join(value)]):
            texts.add(normalized(text))
    return texts


def block_paragraphs(block):
    """One block's paragraphs, each as (xml, text). Runs carry no font: the template's
    docDefaults set it."""
    kind, value = block
    if kind == "title":
        return [(para(value, '<w:keepNext/><w:jc w:val="center"/>', BOLD, markup=True), value)]
    if kind == "heading":
        return [(para(value, "<w:keepNext/>", BOLD, markup=True), value)]
    if kind == "cite":
        return [(para(value, '<w:ind w:left="720"/>', "", markup=True), value)]
    if kind == "quote":
        return [(para(line, '<w:ind w:left="720" w:right="720"/>'), line) for line in value]
    if len(value) == 1 and not SIGNING_RULE.match(value[0]):
        return [(body_paragraph(value[0], ""), value[0])]
    # A signing rule prints as it is: read as markup, its underscores would turn into underlining.
    inner = "<w:r><w:br/></w:r>".join(run(line) if SIGNING_RULE.match(line) else runs(line)
                                        for line in value)
    return [("<w:p><w:pPr>" + rpr("") + "</w:pPr>" + inner + "</w:p>", "\n".join(value))]


def with_space_before(paragraph, before):
    """Space above a paragraph built here, after any keep elements, as CT_PPrBase orders them."""
    at = len("<w:p><w:pPr>")
    at += re.match(r"(?:<w:(?:keepNext|keepLines|widowControl)/>)*", paragraph[at:]).end()
    return paragraph[:at] + '<w:spacing w:before="%d"/>' % before + paragraph[at:]


def body_xml(blocks, warning, reservation):
    paras = [p for block in blocks for p in block_paragraphs(block)]
    tail = []
    # The recipient lines close the face and flow freely after the signature block.
    if blocks and blocks[-1][0] == "para" and all(RECIPIENT_LINE.match(l) for l in blocks[-1][1]):
        tail = [paras.pop()]
    chain = paras[-SIGNATURE_CHAIN:]
    start = len(paras) - len(chain)
    for i, (xml, text) in enumerate(chain):
        last = i == len(chain) - 1
        split = i == 0 and not last and len(text) > LONG_LAST_PARAGRAPH
        paras[start + i] = (keep_together(xml, keep_lines=not split, widow_control=split,
                                          keep_next=not last), text)
    if warning:
        paras.insert(0, (para(warning, "", BOLD), warning))
    if reservation and paras:
        paras[0] = (with_space_before(paras[0][0], twips(reservation)), paras[0][1])
    return "".join(xml for xml, _text in paras + tail)


# ------------------------------------------------------------ the generic template --

def attr(text):
    return esc(text).replace('"', "&quot;")


def fill_tokens(text, values, prop):
    def value(match):
        if match.group(0) not in values:
            raise FillError("missing_token", "format.%s carries %s, which --tokens gives no value"
                            % (prop, match.group(0)))
        return str(values[match.group(0)])
    return TOKEN.sub(value, text)


def header_footer(tag, text, numbered, jc):
    paras = "".join(para(line) for line in text.split("\n") if line) if text else ""
    if numbered:
        paras += ('<w:p><w:pPr><w:jc w:val="%s"/></w:pPr><w:fldSimple w:instr=" PAGE ">'
                  '<w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>' % jc)
    return (XML_HEAD + '<w:%s xmlns:w="%s" xmlns:r="%s">%s</w:%s>'
            % (tag, W_NS, R_NS, paras or "<w:p/>", tag))


def generic_parts(body, s, tokens):
    """The generic template's package, set by the format file's properties."""
    numbering = s["page_numbering"]
    title_page = numbering is not None and not numbering["first_page"]
    parts, refs = {}, ""
    rels = [("rIdStyles", "styles", "styles.xml")]
    overrides = [("/word/document.xml", "document.main+xml"), ("/word/styles.xml", "styles+xml")]
    for kind, tag in (("header", "hdr"), ("footer", "ftr")):
        text = fill_tokens(s[kind], tokens, kind)
        numbered = numbering is not None and POSITIONS[numbering["position"]][0] == kind
        if not text and not numbered:
            continue
        jc = POSITIONS[numbering["position"]][1] if numbered else None
        variants = [("default", numbered)] + [("first", False)] * title_page
        for n, (variant, with_number) in enumerate(variants, 1):
            name, rid = "%s%d.xml" % (kind, n), "rId%s%d" % (kind.title(), n)
            parts["word/" + name] = header_footer(tag, text, with_number, jc)
            rels.append((rid, kind, name))
            overrides.append(("/word/" + name, kind + "+xml"))
            refs += '<w:%sReference w:type="%s" r:id="%s"/>' % (kind, variant, rid)

    margins = tuple(twips(s["margins"][side]) for side in ("top", "right", "bottom", "left"))
    sect = ("<w:sectPr>" + refs + '<w:pgSz w:w="%d" w:h="%d"/>' % PAPER[s["paper"]]
            + ('<w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" w:header="720"'
               ' w:footer="720" w:gutter="0"/>' % margins)
            + ('<w:pgNumType w:fmt="%s"/>' % NUMBER_FORMATS[numbering["format"]] if numbering else "")
            + ("<w:titlePg/>" if title_page else "") + "</w:sectPr>")
    parts["word/document.xml"] = (XML_HEAD + '<w:document xmlns:w="%s" xmlns:r="%s"><w:body>%s%s'
                                  "</w:body></w:document>" % (W_NS, R_NS, body, sect))
    size = float(LENGTH.match(s["font_size"]).group(1))
    face = attr(s["typeface"])
    parts["word/styles.xml"] = (
        XML_HEAD + '<w:styles xmlns:w="%s"><w:docDefaults><w:rPrDefault><w:rPr>'
        '<w:rFonts w:ascii="%s" w:hAnsi="%s" w:eastAsia="%s" w:cs="%s"/>'
        '<w:sz w:val="%d"/><w:szCs w:val="%d"/></w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:after="%d" w:line="%d" w:lineRule="auto"/></w:pPr>'
        '</w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        '<w:name w:val="Normal"/></w:style></w:styles>'
        % (W_NS, face, face, face, face, round(size * 2), round(size * 2), round(size * 20),
           round(240 * s["line_spacing"])))
    parts["word/_rels/document.xml.rels"] = (
        XML_HEAD + '<Relationships xmlns="%s">%s</Relationships>'
        % (PKG_RELS_NS, "".join('<Relationship Id="%s" Type="%s/%s" Target="%s"/>'
                                % (rid, R_NS, kind, target) for rid, kind, target in rels)))
    parts["_rels/.rels"] = (XML_HEAD + '<Relationships xmlns="%s"><Relationship Id="rId1" '
                            'Type="%s/officeDocument" Target="word/document.xml"/></Relationships>'
                            % (PKG_RELS_NS, R_NS))
    parts["[Content_Types].xml"] = (
        XML_HEAD + '<Types xmlns="%s"><Default Extension="rels" ContentType="application/'
        'vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" '
        'ContentType="application/xml"/>%s</Types>'
        % (TYPES_NS, "".join('<Override PartName="%s" ContentType="%s%s"/>' % (name, WML_TYPE, kind)
                             for name, kind in overrides)))
    return parts


def write_generic(out, blocks, s, tokens, warning):
    parts = generic_parts(body_xml(blocks, warning, s["filing_stamp_reservation"]), s, tokens)
    with zipfile.ZipFile(out, "x", zipfile.ZIP_DEFLATED) as z:
        for name in ("[Content_Types].xml", "_rels/.rels", "word/document.xml",
                     "word/_rels/document.xml.rels", "word/styles.xml"):
            z.writestr(name, parts.pop(name))
        for name in sorted(parts):
            z.writestr(name, parts[name])


# ------------------------------------------------------------ the fill --

def strings(value):
    """Every string in a payload field, however nested."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [s for v in value for s in strings(v)]
    if isinstance(value, dict):
        return [s for v in value.values() for s in strings(v)]
    return []


def letter_inputs(args, blocks):
    """The letterhead payload and the firm profile. The filed face is the only source of the
    letter's text: each body paragraph must be a paragraph of it, `salutation`, each `re` line
    and each `attention` must be lines of it, and `body` must hold, in order, every paragraph
    of the face that no other payload field and no line of the signature block accounts for."""
    rl = _render_letterhead()
    payload = _letterhead_call(rl.load_json, args.letter, "letter payload")
    if not isinstance(payload, dict):
        raise FillError("bad_input", "--letter %s must be a JSON object" % args.letter)
    if "warning" in payload:
        raise FillError("bad_input", "--letter %s carries `warning`, which only this script sets"
                        % args.letter)
    for key, what in (("body", "paragraphs"), ("re", "RE: lines")):
        value = payload.get(key)
        if not isinstance(value, list) or not value or not all(isinstance(p, str) for p in value):
            raise FillError("bad_input", "--letter %s: `%s` must be a non-empty list of %s"
                            % (args.letter, key, what))
    problem = list_fields_problem(payload)
    if problem:
        raise FillError("bad_input", "--letter %s: %s" % (args.letter, problem))
    fields = [("attention", "attention", payload.get("attention"))]
    fields += [("recipients[%d].attention" % i, "attention", entry.get("attention"))
               for i, entry in enumerate(payload.get("recipients") or []) if isinstance(entry, dict)]
    fields += [("re[%d]" % i, "re", line) for i, line in enumerate(payload["re"])]
    fields += [("cc[%d]" % i, "cc", entry) if isinstance(entry, str)
               else ("cc[%d].name" % i, "cc", entry.get("name") if isinstance(entry, dict) else None)
               for i, entry in enumerate(payload.get("cc") or [])]
    fields += [("enclosures[%d]" % i, "enclosures", item)
               for i, item in enumerate(payload.get("enclosures") or [])]
    labelled = ["`%s` %r" % (path, value) for path, key, value in fields
                if isinstance(value, str) and PRINTED_LABEL[key].match(value)]
    if labelled:
        raise FillError("letter_field_carries_label", "the letterhead prints each of these fields' "
                        "label itself, so give the value without it: "
                        + "; ".join(labelled))
    body = payload["body"]
    texts = face_texts(blocks)
    missing = [p for p in body if normalized(p) not in texts]
    if missing:
        raise FillError("letter_body_not_in_filed_face", "each body paragraph must be a paragraph "
                        "of the filed face; not found: " + "; ".join(repr(p[:60]) for p in missing))
    unlabelled = texts | {normalized(LINE_LABEL.sub("", t)) for t in texts}
    unmatched = ["re line %r" % line for line in payload["re"] if normalized(line) not in unlabelled]
    unmatched += ["%s %r" % (path, value) for path, key, value in fields
                  if key == "attention" and isinstance(value, str) and value
                  and normalized(value) not in unlabelled]
    salutation = payload.get("salutation")
    if not isinstance(salutation, str) or normalized(salutation) not in texts:
        unmatched.insert(0, "salutation %r" % (salutation,))
    if unmatched:
        raise FillError("letter_field_not_in_filed_face", "`salutation`, each `re` line and each "
                        "`attention` must be a line of the filed face; not found: "
                        + "; ".join(unmatched))

    profile = _letterhead_call(rl.load_profile, args.profile)
    signer = _letterhead_call(rl.signer_entry, profile, payload.get("signer"))
    accounted = {normalized(s) for key in LETTER_FIELDS for s in strings(payload.get(key))}
    accounted |= {normalized(signer[key]) for key in ("closing", "name", "designation") if signer.get(key)}
    accounted.add(normalized(profile["firm_name"]))

    def other_field(line):
        return (SIGNING_RULE.match(line) or RECIPIENT_LINE.match(line)
                or normalized(LINE_LABEL.sub("", line)) in accounted or normalized(line) in accounted)

    face_body = [normalized(" ".join(lines)) for kind, lines in blocks
                 if kind == "para" and not all(other_field(line) for line in lines)]
    given = [normalized(p) for p in body]
    at, dropped = 0, []
    for paragraph in face_body:
        if paragraph in given[at:]:
            at = given.index(paragraph, at) + 1
        else:
            dropped.append(paragraph)
    if dropped:
        raise FillError("letter_body_incomplete", "`body` must hold every body paragraph of the "
                        "filed face, in order; missing or out of order: "
                        + "; ".join(repr(p[:60]) for p in dropped))
    return payload, profile


def next_version(out_dir, stem, suffix):
    """The path the next copy of a series takes, and the highest existing copy (None if none).
    `<stem><suffix>.docx` counts as v1 and `<stem> vN<suffix>.docx` as vN."""
    series = re.compile(r"^%s(?: v(\d+))?%s\.docx$" % (re.escape(stem), re.escape(suffix)), re.I)
    taken = {}
    for entry in os.listdir(out_dir):
        match = series.match(entry)
        if match:
            taken[int(match.group(1) or 1)] = os.path.join(out_dir, entry)
    if not taken:
        return os.path.join(out_dir, stem + suffix + ".docx"), None
    top = max(taken)
    return os.path.join(out_dir, "%s v%d%s.docx" % (stem, top + 1, suffix)), taken[top]


def fill(args):
    filed = load(args.filed, "--filed")
    read = load(args.format, "--format")
    stored = filed.get("stored_layout") if isinstance(filed, dict) else None
    if not isinstance(stored, dict) or not isinstance(stored.get("layout"), dict):
        raise FillError("no_stored_layout", "%s carries no stored_layout: publish-general needs the "
                        "filed render to return the Writing's stored layout with its filed face"
                        % args.filed)
    layout = stored["layout"]
    if scalar(layout.get("renderer")) != "general":
        raise FillError("not_general", "the Writing's renderer is %r: a bespoke kind is filled by "
                        "its own /publish subskill" % scalar(layout.get("renderer")))
    documents = filed.get("documents") or []
    faces = [d for d in documents if isinstance(d, dict) and d.get("document_type") == GENERAL_WRITING]
    if len(faces) != 1:
        raise FillError("no_filed_face", "%s holds %d %s documents; exactly one is needed"
                        % (args.filed, len(faces), GENERAL_WRITING))
    stem = args.out_name
    if not stem.strip() or BAD_STEM.search(stem):
        raise FillError("bad_input", "--out-name %r must be a bare file name stem: not empty, without "
                        '\\ / : * ? " < > |, a file extension or a trailing " v<n>"' % (stem,))
    letterhead = scalar(layout.get("letterhead")) is True
    if letterhead != bool(args.letter and args.profile) or (letterhead and args.tokens):
        raise FillError("bad_input", "a letterhead: true Writing takes --letter and --profile and "
                        "no --tokens; any other Writing takes neither --letter nor --profile")

    if (not isinstance(read, dict) or "format" not in read or not isinstance(read.get("items"), list)
            or not isinstance(read.get("learned"), bool)):
        raise FillError("bad_input", "--format %s is not a knowledge__read response for a format "
                        "file (it needs `format`, `items` and `learned`)" % args.format)
    file = read.get("path") or args.format
    fmt = read["format"]
    refs = validate_format(fmt, file)
    report = {"defaulted": [prop for prop in FORMAT_PROPERTIES if prop not in fmt]}
    if letterhead:
        report["overridden_by_letterhead"] = [prop for prop in FORMAT_PROPERTIES if prop in fmt]

    cited = [item for item in read["items"] if isinstance(item, dict) and item.get("rule_ref") in refs]
    # A vetted file (learned: false) never blocks the deliverable: an item of it can read
    # unconfirmed only because its source moved (a confirmation or correction on a missing source), which warns.
    vetted = read["learned"] is False
    unconfirmed = [] if vetted else [item for item in cited if item.get("status") == "unconfirmed"]
    changed = [item for item in cited if item.get("freshness") == "missing"
               and (vetted or item.get("status") == "vetted")]
    warnings = (["Format unverified: " + item["rule_ref"]
                 + (", transcribed from PDF p. %s" % item["pdf_page"] if item.get("pdf_page") else "")
                 for item in unconfirmed]
                + ["Source changed: " + item["rule_ref"] for item in changed])

    blocks = filed_blocks(faces[0].get("markdown") or "", faces[0].get("file_name") or GENERAL_WRITING)
    if letterhead:
        payload, profile = letter_inputs(args, blocks)
    else:
        s = template_settings(fmt)
        tokens = load(args.tokens, "--tokens") if args.tokens else {}

    def write(out, warning):
        if letterhead:
            data = dict(payload, warning=warning) if warning else payload
            _letterhead_call(_render_letterhead().render, data, profile, out)
        else:
            write_generic(out, blocks, s, tokens, warning)

    if not os.path.isdir(args.out_dir):
        raise FillError("no_out_dir", "--out-dir %s is not a folder" % args.out_dir)

    def publish(suffix, warning, key, versioned_key):
        """Writes one copy through a temporary file to the next free name in its series."""
        tmp = os.path.join(args.out_dir, "~%s.tmp-%d.docx" % (stem, os.getpid()))
        try:
            write(tmp, warning)
            path, prior = next_version(args.out_dir, stem, suffix)
            if os.path.exists(path):
                raise FillError("output_exists", "not overwriting " + path, **report)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        report[key] = path
        if prior:
            report[versioned_key] = prior

    if warnings:
        publish(REVIEW_SUFFIX, "; ".join(warnings), "review_copy", "review_copy_versioned_from")
    if unconfirmed:
        detail = [dict({"rule_ref": item["rule_ref"], "property": refs[item["rule_ref"]],
                        "value": fmt[refs[item["rule_ref"]]]["value"]},
                       **({"pdf_page": item["pdf_page"]} if item.get("pdf_page") else {}),
                       **({"overridden_by_letterhead": True} if letterhead else {}))
                  for item in unconfirmed]
        raise FillError("deliverable_refused", "the format file %s cites item(s) no roster lawyer "
                        "has confirmed: %s; only the review copy was written"
                        % (file, ", ".join(item["rule_ref"] for item in unconfirmed)),
                        unconfirmed=detail, **report)
    publish("", None, "deliverable", "versioned_from")
    others = [d.get("file_name") for d in documents if d is not faces[0]]
    if others:
        report["not_rendered"] = others
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description="publish-general's fill: a general Writing's .docx "
                                             "from its filed face and its venue's format file.")
    ap.add_argument("--filed", required=True, help="drafting_forms__render's filed response")
    ap.add_argument("--format", required=True, help="knowledge__read's response for format.md")
    ap.add_argument("--out-dir", required=True, help="the folder the .docx files go to")
    ap.add_argument("--out-name", required=True, help="the deliverable's file name stem, no extension")
    ap.add_argument("--letter", help="render_letterhead.py's payload (letterhead: true only)")
    ap.add_argument("--profile", help="practice_data__firm_profile's response (letterhead: true only)")
    ap.add_argument("--tokens", help="a JSON object of letterhead token values for header and footer")
    args = ap.parse_args(argv)
    try:
        result = fill(args)
    except FillError as err:
        print(json.dumps(dict({"success": False, "error": err.code, "detail": err.detail}, **err.extra)))
        return 1
    except Exception as err:  # a defect, reported as one JSON line rather than a traceback
        print(json.dumps({"success": False, "error": "internal_error", "detail": repr(err),
                          "trace": traceback.format_exc()}))
        return 1
    print(json.dumps(dict({"success": True}, **result)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
