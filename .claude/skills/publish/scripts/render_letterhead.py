"""Render a letter on the firm's registered letterhead: /publish's letterhead step.

Clones the registered letterhead and replaces only the content of `<w:body>` that precedes
the trailing `<w:sectPr>`, with the body fill_general.build_body builds. The tokens
{{AUTHOR_NAME}}, {{AUTHOR_EMAIL}}, {{DIRECT_LINE}} and {{FILE_NUMBER}} are substituted in
every header and footer part, and a part may omit any of them. Every other part is copied
through byte-for-byte and verified unchanged, apart from the additions a scanned signature
needs: its media part, its relationship, and the png content-type default when absent.

Inputs:
    --profile     the firm profile as a JSON file, exactly what practice_data__firm_profile
                  returns: {firm_name, roster, letterhead}. The template is `letterhead`.
    probanda.json  this machine's Roaming Coclerk/probanda.json (legacy coclerk.json): `person` (this machine's
                  roster key, required) and `signature` (optional, a scanned PNG's path).
    payload       a JSON object: `signer` (a roster key) and `file_number` are required,
                  plus the letter fields fill_general.build_body reads (`date`, `recipient`
                  or `recipients`, `salutation`, `re` and `body` required; `attention`,
                  `delivery`, `recipient_email`, `enclosures` and `cc` optional). Give
                  `attention`, `re`, `cc` and `enclosures` without the "Attention:",
                  "Re:", "cc." or "Encl." label: the body builder prints it. `enclosures`
                  and `cc` must be lists, never a bare string.

The signer's name, email, direct line and closing come from the signer's roster entry, and
the firm name from `firm_name`. The initials line reads <signer initials>/<preparer
initials>, the preparer being this machine's `person`. The scanned signature goes into the
signing space only when `person` is the signer and `signature` is set. Otherwise the block
keeps a blank signing space. The last body paragraph and the closing block keep together,
so the signature block never opens a page alone.

Each of these stops the render, naming the problem: a missing template file; a signer key
not in the roster; a signer who is not a `lawyer` or is `active: false`; an unset `person`
or one not in the roster; a `signature` whose file is absent. The render also refuses to
overwrite an existing file.

Usage:
    python render_letterhead.py payload.json --profile profile.json --out letter.docx

Stdlib only.
"""

import argparse
import json
import os
import re
import shutil
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "subskills", "publish-general", "scripts"))
import fill_general  # noqa: E402

REQUIRED = ("file_number", "date", "salutation", "re", "body", "signer")

# Payload keys that used to override the author's details. They come from the roster now.
REMOVED = ("author_name", "author_email", "direct_line", "firm", "closing", "initials")

SIGNER_FIELDS = ("name", "email", "direct_line", "closing", "initials")

TOKENS = ("{{AUTHOR_NAME}}", "{{AUTHOR_EMAIL}}", "{{DIRECT_LINE}}", "{{FILE_NUMBER}}")
HEADER_FOOTER_PART = re.compile(r"^word/(header|footer)\d*\.xml$")

IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
DOCUMENT = "word/document.xml"
DOCUMENT_RELS = "word/_rels/document.xml.rels"
CONTENT_TYPES = "[Content_Types].xml"
RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"

SIGNATURE_PART = "word/media/signature.png"
SIGNATURE_TARGET = "media/signature.png"
SIGNATURE_RID = "rIdSignature"
SIGNATURE_WIDTH = 1371600  # EMU, 1.5 inches; the height keeps the scan's aspect ratio
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PNG_DEFAULT = '<Default Extension="png" ContentType="image/png"/>'


def config_path():
    """The settings file the MCP runtime reads (mcp/src/config-path.ts): the file
    COCLERK_CONFIG_PATH names when set, which must exist, else the first that
    exists of Probanda\\probanda.json and the legacy Coclerk\\probanda.json and
    Coclerk\\coclerk.json under Roaming."""
    override = os.environ.get("COCLERK_CONFIG_PATH")
    if override:
        if not os.path.isfile(override):
            sys.exit("COCLERK_CONFIG_PATH names %s, which does not exist. Create it, "
                     "or unset the variable to read the live probanda.json." % override)
        return override
    app_data = os.environ.get("APPDATA") or os.path.join(
        os.path.expanduser("~"), "AppData", "Roaming")
    candidates = [os.path.join(app_data, "Probanda", "probanda.json"),
                  os.path.join(app_data, "Coclerk", "probanda.json"),
                  os.path.join(app_data, "Coclerk", "coclerk.json")]
    return next((path for path in candidates if os.path.isfile(path)), candidates[0])


def load_json(path, what):
    with open(path, encoding="utf-8") as fh:
        try:
            return json.load(fh)
        except ValueError as err:
            sys.exit("%s %s is not valid JSON: %s" % (what, path, err))


def load_profile(path):
    profile = load_json(path, "firm profile")
    missing = [k for k in ("firm_name", "roster") if not profile.get(k)]
    if missing:
        sys.exit("firm profile %s has no %s: save practice_data__firm_profile's response "
                 "as it is" % (path, ", ".join(missing)))
    if not profile.get("letterhead"):
        sys.exit("no letterhead is registered: register one with "
                 "practice_data__upsert_firm_profile's letterhead input")
    return profile


def load_machine():
    """This machine's `person` and `signature`, from probanda.json."""
    path = config_path()
    config = load_json(path, "config") if os.path.isfile(path) else {}
    person = config.get("person")
    if not person:
        sys.exit('no "person" in %s: set this machine\'s roster key with '
                 'practice_data__upsert_firm_profile' % path)
    signature = config.get("signature")
    if signature and not os.path.isfile(signature):
        sys.exit('signature file not found: %s (the "signature" key in %s)'
                 % (signature, path))
    return person, signature


def check_payload(data):
    if data.get("recipient") and data.get("recipients"):
        sys.exit('payload supplies both "recipient" and "recipients" -- use exactly one')
    if data.get("recipients"):
        recipients = data["recipients"]
        if not isinstance(recipients, list):
            sys.exit("recipients must be a list")
        for i, entry in enumerate(recipients):
            if not isinstance(entry, dict) or not entry.get("recipient"):
                sys.exit("recipients[%d] must be an object with a non-empty 'recipient' list" % i)
    missing = [k for k in REQUIRED if not data.get(k)]
    if not (data.get("recipient") or data.get("recipients")):
        missing.append("recipient (or recipients)")
    if missing:
        sys.exit("payload is missing required field(s): " + ", ".join(missing))
    problem = fill_general.list_fields_problem(data)
    if problem:
        sys.exit(problem)
    stale = [k for k in REMOVED if k in data]
    if stale:
        sys.exit("payload carries %s, which now come from the signer's roster entry and the "
                 "firm profile: remove them" % ", ".join(stale))


def roster_entry(profile, key, what):
    for entry in profile["roster"]:
        if entry.get("key") == key:
            return entry
    sys.exit('%s "%s" is not a key in the firm roster' % (what, key))


def signer_entry(profile, key):
    entry = roster_entry(profile, key, "signer")
    if entry.get("role") != "lawyer":
        sys.exit('signer "%s" has role "%s": only a roster lawyer signs a letter'
                 % (key, entry.get("role")))
    if entry.get("active") is False:
        sys.exit('signer "%s" is inactive (active: false in the roster)' % key)
    missing = [f for f in SIGNER_FIELDS if not entry.get(f)]
    if missing:
        sys.exit('roster entry "%s" has no %s' % (key, ", ".join(missing)))
    return entry


def signature_image(path):
    """The scanned signature's bytes and its drawing: relationship id and size in EMU."""
    with open(path, "rb") as fh:
        blob = fh.read()
    if not blob.startswith(PNG_MAGIC) or blob[12:16] != b"IHDR":
        sys.exit("signature must be a PNG: " + path)
    width, height = struct.unpack(">II", blob[16:24])
    return blob, {"rid": SIGNATURE_RID, "cx": SIGNATURE_WIDTH,
                  "cy": SIGNATURE_WIDTH * height // width}


def check_template(parts):
    """Refuse a letterhead whose body still relates to an image: that is a scanned
    signature left in by the source template, and it would ship inside every letter."""
    rels = parts[DOCUMENT_RELS].decode("utf-8")
    for rel in re.findall(r"<Relationship\b[^>]*/>", rels):
        if 'Type="%s"' % IMAGE_REL in rel:
            sys.exit("letterhead template carries a body image relationship (%s) -- "
                     "register a letterhead without it" % rel)


def add_signature(parts, names, blob):
    """Add the signature image part, its relationship and, if absent, the png type."""
    if SIGNATURE_PART in parts:
        sys.exit("letterhead template already has a part named " + SIGNATURE_PART)
    rels = parts[DOCUMENT_RELS].decode("utf-8")
    if 'Id="%s"' % SIGNATURE_RID in rels:
        sys.exit("letterhead template already has a relationship " + SIGNATURE_RID)
    rels = rels.replace("</Relationships>", '<Relationship Id="%s" Type="%s" Target="%s"/>'
                        '</Relationships>' % (SIGNATURE_RID, IMAGE_REL, SIGNATURE_TARGET))
    parts[DOCUMENT_RELS] = rels.encode("utf-8")
    types = parts[CONTENT_TYPES].decode("utf-8")
    if not re.search(r'<Default Extension="png"', types, re.I):
        parts[CONTENT_TYPES] = types.replace("</Types>", PNG_DEFAULT + "</Types>").encode("utf-8")
    parts[SIGNATURE_PART] = blob
    names.append(SIGNATURE_PART)


def splice_body(document_xml, new_body):
    """Replace the body's content, keeping the trailing <w:sectPr> byte-identical."""
    start = document_xml.find("<w:body>")
    end = document_xml.find("</w:body>")
    if start < 0 or end < 0:
        sys.exit("template has no <w:body>")
    body = document_xml[start + len("<w:body>"):end]
    sect = re.search(r"<w:sectPr\b.*</w:sectPr>", body, re.S)
    if not sect:
        sys.exit("template body has no trailing <w:sectPr> — margins and headers would be lost")
    tail = body[sect.start():]
    return document_xml[:start] + "<w:body>" + new_body + tail + document_xml[end:]


def fill_tokens(part_xml, values):
    """Substitute each token a header or footer part carries; any may be omitted."""
    for token in TOKENS:
        part_xml = part_xml.replace(token, fill_general.esc(str(values[token])))
    return part_xml


def items(xml):
    return [(child.tag, child.attrib) for child in ET.fromstring(xml)]


def check_additions(name, template_xml, output_xml, allowed):
    """The output part is the template's, plus at most the one (tag, attrib) `allowed`."""
    before, after = items(template_xml), items(output_xml)
    if after[:len(before)] != before or after[len(before):] not in ([], [allowed]):
        sys.exit("output part %s was modified beyond the signature's addition" % name)


def verify(out_path, template_path, signed, values):
    """Fail loudly if the clone lost anything it was supposed to carry through."""
    added = [SIGNATURE_PART] if signed else []
    with zipfile.ZipFile(template_path) as tpl, zipfile.ZipFile(out_path) as out:
        if tpl.namelist() + added != out.namelist():
            sys.exit("output part list differs from the template")
        for name in out.namelist():
            data = out.read(name)
            if name.endswith(".xml") or name.endswith(".rels"):
                ET.fromstring(data)
            if name == DOCUMENT or name in added:
                continue
            if HEADER_FOOTER_PART.match(name):
                expected = fill_tokens(tpl.read(name).decode("utf-8"), values).encode("utf-8")
                if expected != data:
                    sys.exit("output part %s differs from the template with its tokens "
                             "filled" % name)
                continue
            if signed and name == DOCUMENT_RELS:
                check_additions(name, tpl.read(name), data, (
                    "{%s}Relationship" % RELS_NS,
                    {"Id": SIGNATURE_RID, "Type": IMAGE_REL, "Target": SIGNATURE_TARGET}))
                continue
            if signed and name == CONTENT_TYPES:
                check_additions(name, tpl.read(name), data, (
                    "{%s}Default" % TYPES_NS, {"Extension": "png", "ContentType": "image/png"}))
                continue
            if tpl.read(name) != data:
                sys.exit("output part %s was modified but should have been copied" % name)
        rels = out.read(DOCUMENT_RELS).decode("utf-8")
        doc = out.read(DOCUMENT).decode("utf-8")
        for rid in re.findall(r'r:embed="([^"]+)"', doc):
            if 'Id="%s"' % rid not in rels:
                sys.exit("output body embeds %s, which no relationship defines" % rid)
        tpl_doc = tpl.read(DOCUMENT).decode("utf-8")
        pat = re.compile(r"<w:sectPr\b.*</w:sectPr>", re.S)
        if pat.search(doc).group(0) != pat.search(tpl_doc).group(0):
            sys.exit("output sectPr differs from the template")


def render(payload, profile, out):
    """Write the letter to `out`, or stop naming what is wrong."""
    if os.path.exists(out):
        sys.exit("refusing to overwrite an existing file: " + out)
    check_payload(payload)
    template = profile["letterhead"]
    if not os.path.isfile(template):
        sys.exit("letterhead template not found: " + template)
    person, signature = load_machine()
    signer = signer_entry(profile, payload["signer"])
    preparer = roster_entry(profile, person, "person")
    if not preparer.get("initials"):
        sys.exit('roster entry "%s" has no initials' % person)

    with zipfile.ZipFile(template) as src:
        names = src.namelist()
        parts = {name: src.read(name) for name in names}
    check_template(parts)

    image = None
    if signature and person == payload["signer"]:
        blob, image = signature_image(signature)
        add_signature(parts, names, blob)

    body = {**payload,
            "firm_name": profile["firm_name"],
            "closing": signer["closing"],
            "signer_name": signer["name"],
            "initials": "%s/%s" % (signer["initials"], preparer["initials"]),
            "signature": image}
    parts[DOCUMENT] = splice_body(
        parts[DOCUMENT].decode("utf-8"), fill_general.build_body(body)).encode("utf-8")
    values = {"{{AUTHOR_NAME}}": signer["name"], "{{AUTHOR_EMAIL}}": signer["email"],
              "{{DIRECT_LINE}}": signer["direct_line"], "{{FILE_NUMBER}}": payload["file_number"]}
    for name in names:
        if HEADER_FOOTER_PART.match(name):
            parts[name] = fill_tokens(parts[name].decode("utf-8"), values).encode("utf-8")

    tmp = out + ".tmp"
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
            for name in names:
                zout.writestr(name, parts[name])
        verify(tmp, template, image is not None, values)
        shutil.move(tmp, out)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("payload", help="path to the JSON payload")
    ap.add_argument("--profile", required=True,
                    help="practice_data__firm_profile's response, saved as a .json file")
    ap.add_argument("--out", required=True, help="path of the .docx to write")
    args = ap.parse_args(argv)
    render(load_json(args.payload, "payload"), load_profile(args.profile), args.out)
    print("wrote " + args.out)


if __name__ == "__main__":
    main()
