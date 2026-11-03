#!/usr/bin/env python3
"""render_document.py -- render a .docx, .eml, .msg or RTF (.doc/.rtf) to deterministic plain text.

Not a database tool: takes an explicit input file and output directory, touches
no matter-data database, and resolves no matter pointer. It therefore does NOT
import resolve_paths or fuse_safe_io, and it is exempt from the "E1 only"
execution rule in ../scripts.md: that rule protects sqlite binaries and staged
copies from stale-mount corruption, and this script opens no database. It reads
one matter document the same way the ingest gate's inline hash step already
does in-session on every path (../../operations/ingest.md Step 2).

Output contract:

  python3 render_document.py <input_path> <output_dir> [--head-chars N] [--strip-quoted]

Writes "<output_dir>/<original_basename>.txt" (the original extension is kept
in the stem, e.g. "Letter.docx.txt", so same-stem/different-extension inputs
sharing one output dir never collide). Prints one line of JSON to stdout:

  {"format": "docx"|"eml"|"msg"|"rtf", "output_path": "...", "paragraph_count": N,
   "attachments": [{"name": "...", "sha256": "..."}]}

With --head-chars N (a positive integer), it also writes the rendering's first
N characters to "<output_dir>/<original_basename>.head.txt" ("Letter.docx.head.txt")
and adds "head_path" to the JSON: a page-1 read of a rendered file.

The JSON for an .eml also carries "message_id", "in_reply_to" (each without its
angle brackets, or null), "references" (a list), "x_unsent" (true on X-Unsent: 1)
and "auto_submitted" (the Auto-Submitted value unless it is "no", else the name of
an X-Autoreply, X-Autorespond or Precedence: auto_reply header, else null). They
are JSON only: the rendered text does not change.

--strip-quoted (.eml only) writes a stripped rendering: a filter of the full one,
never renumbered, so each kept line equals the full rendering's line and a ¶N
cited from it is valid against the full rendering. It drops the trailing quoted
block of the body: everything from the first paragraph that opens with a line
"On ... wrote:", "-----Original Message-----", a "From:" line followed by "Sent:"
or "Date:" and "To:" lines, or a "____" rule followed by such a block; or a run of
paragraphs whose every line begins ">". "On ... wrote:" or ">" paragraphs with new
text after them are not trailing and stay, and a paragraph that holds a marker only
after its first line stays whole, so no new text is ever dropped. The block becomes
one line, "quoted\\t<In-Reply-To Message-ID or unknown>\\t<n lines>", and the JSON
gains "quoted_blocks": [{"after_paragraph", "in_reply_to", "lines"}].
paragraph_count stays the full rendering's. Any other file kind is refused.

For an .eml or .msg, each attachments entry also carries "size",
"content_type" and "path", and the attachment bytes are written to
"<output_dir>/<original_basename>.attachments/<index>_<name>". An embedded
Outlook message has no bytes of its own: its size, sha256 and path are null
and a "note" says so. The msg hdr block is From, To, Cc, Bcc, Date, Subject,
Message-ID, In-Reply-To; Date is the transport header's (with its zone) when
Outlook kept one, otherwise the submit time in UTC, labelled as such. The
body is the plain-text body, else the HTML body stripped to text; a .msg
with neither is refused. Each msg Attachment line reads
"Attachment: <filename> (<size> bytes, <content type>)".

paragraph_count counts only ¶-marked body paragraphs (the hdr block and
Attachment lines are excluded), or for rtf every rendered line. attachments
is always [] for docx and rtf. A .doc or .rtf whose bytes are not RTF (a
binary Word .doc) is refused. Exit 0 on
success. On an unreadable or unsupported file, prints a message to stderr,
exits non-zero, and leaves no output file behind. Imports only the Python
standard library. No network, no database.

Rendered-text layout (the byte-determinism contract -- do not change casually,
every stored ¶N/hdr locator depends on it staying byte-identical across
re-renders of identical input):

  One rendered unit per line, "<marker>\\t<text>", no blank lines between units.

  - Email header block first (eml only): up to five lines, each
    "hdr\\t<Header-Name>: <decoded value>", in the fixed order From, To, Cc,
    Date, Subject -- only headers actually present are emitted.
  - Body paragraphs: "¶1\\t<text>", "¶2\\t<text>", ... Internal
    whitespace runs (including embedded newlines) collapse to single spaces;
    leading/trailing whitespace stripped; empty paragraphs are skipped and
    never numbered.
  - Eml attachments (if any), after the last body paragraph: one line per
    attachment, "Attachment: <filename>" -- unmarked, informational only,
    filenames only, no hashes (the hashes are in the stdout metadata block).
  - RTF: one paragraph per line, whitespace collapsed, with NO ¶N marker.
    An RTF here is a judgment, which numbers its own paragraphs, and those
    numbers are the pinpoints cited; a second numbering invites a wrong
    "para. N" (decision #40's reasoning) and would put marker tokens inside
    excerpts that span paragraphs.

Numbering limitation (deliberate, v1): only literal run text (w:t) is
rendered. Word automatic numbering (w:numPr, resolved through numbering.xml
with abstract definitions, level overrides, and restarts) is NOT resolved --
a hand-rolled resolver risks emitting a WRONG paragraph number, and a wrong
"para. N" cited to the court is strictly worse than a stable "¶N". See
../../CLAUDE.md decision #40.
"""

import email
import email.policy
import hashlib
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
HEADER_ORDER = ("From", "To", "Cc", "Date", "Subject")
_ON_WROTE = re.compile(r"^On .+ wrote:$")
_ORIGINAL_MESSAGE = re.compile(r"^-----Original Message-----$", re.I)
_UNDERSCORE_RULE = re.compile(r"^_{10,}$")
_MESSAGE_ID = re.compile(r"<[^<>\s]+>")


class RenderError(Exception):
    pass


def _collapse_ws(text):
    return re.sub(r"\s+", " ", text or "").strip()


def render_docx(input_path):
    try:
        with zipfile.ZipFile(input_path) as zf:
            xml_bytes = zf.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError, OSError) as exc:
        raise RenderError(f"unreadable .docx: {exc}") from exc

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise RenderError(f"malformed word/document.xml: {exc}") from exc

    paragraphs = []
    for p in root.iter(f"{WORD_NS}p"):
        runs = [t.text or "" for t in p.iter(f"{WORD_NS}t")]
        text = _collapse_ws("".join(runs))
        if text:
            paragraphs.append(text)

    lines = [f"¶{i}\t{text}" for i, text in enumerate(paragraphs, start=1)]
    return "\n".join(lines) + ("\n" if lines else ""), len(paragraphs), []


def _strip_html(html_text):
    html_text = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", html_text)
    html_text = re.sub(r"(?s)<!--.*?-->", " ", html_text)
    html_text = re.sub(r"(?s)<[^>]+>", " ", html_text)
    return html.unescape(html_text)


def _eml_body_text(msg):
    plain = msg.get_body(preferencelist=("plain",))
    if plain is not None:
        return plain.get_content()
    htm = msg.get_body(preferencelist=("html",))
    if htm is not None:
        return _strip_html(htm.get_content())
    return ""


def _write_attachment(attachment_dir, idx, name, payload):
    os.makedirs(attachment_dir, exist_ok=True)
    safe = re.sub(r"[^\w.\- ]", "_", name)
    out = os.path.join(attachment_dir, f"{idx}_{safe}")
    with open(out, "wb") as fh:
        fh.write(payload)
    return out


def _lines_of(block):
    return [line.strip() for line in block.splitlines() if line.strip()]


def _is_header_block(lines):
    """A From: line followed, within its next four lines, by Sent:/Date: and To:."""
    if not lines or not re.match(r"^From: .+$", lines[0]):
        return False
    following = lines[1:5]
    return (any(re.match(r"^(Sent|Date): ", line) for line in following)
            and any(line.startswith("To: ") for line in following))


def _is_quoted_only(lines):
    return bool(lines) and all(line.startswith(">") for line in lines)


def _quote_start(blocks):
    """The index of the first paragraph of the body's trailing quoted block, or
    None. Only whole paragraphs are dropped, and only when no new text follows."""
    parsed = [_lines_of(block) for block in blocks]
    for i, lines in enumerate(parsed):
        after = parsed[i + 1:]
        next_lines = after[0] if after else []
        if _ORIGINAL_MESSAGE.match(lines[0]) or _is_header_block(lines):
            return i
        if _UNDERSCORE_RULE.match(lines[0]) and (_is_header_block(lines[1:]) or _is_header_block(next_lines)):
            return i
        if _ON_WROTE.match(lines[0]) or (len(lines) > 1 and _ON_WROTE.match(f"{lines[0]} {lines[1]}")):
            prefixed = any(line.startswith(">") for line in lines[1:]) or _is_quoted_only(next_lines)
            if not prefixed or all(_is_quoted_only(rest) for rest in after):
                return i
        if _is_quoted_only(lines) and all(_is_quoted_only(rest) for rest in after):
            return i
    return None


def _bare_id(value):
    value = str(value).strip().strip("<>").strip() if value is not None else ""
    return value or None


def _auto_submitted(msg):
    value = str(msg.get("Auto-Submitted", "")).strip()
    if value and value.lower() != "no":
        return value
    for name in ("X-Autoreply", "X-Autorespond"):
        if msg.get(name) is not None:
            return name.lower()
    return "auto_reply" if str(msg.get("Precedence", "")).strip().lower() == "auto_reply" else None


def render_eml(input_path, attachment_dir=None, strip_quoted=False, meta=None):
    """Render an .eml. When attachment_dir is given, each attachment's bytes
    are written there as "<index>_<name>" and its path reported. When meta is a
    dict, it receives the JSON-only fields, so the rendering is unchanged."""
    try:
        with open(input_path, "rb") as fh:
            raw = fh.read()
    except OSError as exc:
        raise RenderError(f"unreadable .eml: {exc}") from exc

    try:
        msg = email.message_from_bytes(raw, policy=email.policy.default)
    except Exception as exc:  # email package raises assorted errors on garbage input
        raise RenderError(f"malformed .eml: {exc}") from exc

    lines = []
    for name in HEADER_ORDER:
        value = msg.get(name)
        if value is not None:
            lines.append(f"hdr\t{name}: {str(value).strip()}")

    body_text = _eml_body_text(msg)
    blocks = [block for block in re.split(r"\n\s*\n", body_text) if _collapse_ws(block)]
    paragraphs = [_collapse_ws(block) for block in blocks]
    in_reply_to = _bare_id(msg.get("In-Reply-To"))
    start = _quote_start(blocks) if strip_quoted else None
    kept = paragraphs if start is None else paragraphs[:start]
    for i, text in enumerate(kept, start=1):
        lines.append(f"¶{i}\t{text}")
    quoted_blocks = []
    if start is not None:
        count = sum(len(_lines_of(block)) for block in blocks[start:])
        lines.append(f"quoted\t{in_reply_to or 'unknown'}\t{count} lines")
        quoted_blocks.append({"after_paragraph": start, "in_reply_to": in_reply_to or "unknown", "lines": count})
    if meta is not None:
        meta.update({
            "message_id": _bare_id(msg.get("Message-ID")),
            "in_reply_to": in_reply_to,
            "references": [_bare_id(m) for m in _MESSAGE_ID.findall(str(msg.get("References", "")))],
            "x_unsent": str(msg.get("X-Unsent", "")).strip() == "1",
            "auto_submitted": _auto_submitted(msg),
        })
        if strip_quoted:
            meta["quoted_blocks"] = quoted_blocks

    attachments = []
    for part in msg.iter_attachments():
        name = part.get_filename() or "unnamed-attachment"
        payload = part.get_payload(decode=True) or b""
        sha256 = hashlib.sha256(payload).hexdigest()
        path = None
        if attachment_dir:
            path = _write_attachment(attachment_dir, len(attachments) + 1, name, payload)
        attachments.append({"name": name, "sha256": sha256, "size": len(payload),
                            "content_type": part.get_content_type(), "path": path})

    for att in attachments:
        lines.append(f"Attachment: {att['name']}")

    return "\n".join(lines) + ("\n" if lines else ""), len(paragraphs), attachments


# ---------------------------------------------------------------------------
# .msg (Outlook) -- a compound file binary (CFB/OLE) container of MAPI
# property streams. Stdlib has no CFB reader, so a minimal one lives here.
# Layout per [MS-CFB]; property semantics per [MS-OXMSG]. Read-only.
# ---------------------------------------------------------------------------

CFB_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
CFB_END_OF_CHAIN = 0xFFFFFFFE
CFB_FREE = 0xFFFFFFFF
MSG_HEADER_ORDER = ("From", "To", "Cc", "Bcc", "Date", "Subject",
                    "Message-ID", "In-Reply-To")


class _Cfb:
    """Just enough of the compound file format to list and read streams."""

    def __init__(self, data):
        if len(data) < 512 or data[:8] != CFB_MAGIC:
            raise RenderError("not an OLE compound file")
        self.data = data
        sector_shift = int.from_bytes(data[30:32], "little")
        mini_shift = int.from_bytes(data[32:34], "little")
        self.sector_size = 1 << sector_shift
        self.mini_size = 1 << mini_shift
        self.mini_cutoff = int.from_bytes(data[56:60], "little")
        first_dir = int.from_bytes(data[48:52], "little")
        first_minifat = int.from_bytes(data[60:64], "little")
        n_minifat = int.from_bytes(data[64:68], "little")
        first_difat = int.from_bytes(data[68:72], "little")
        n_difat = int.from_bytes(data[72:76], "little")

        fat_sectors = list(self._u32s(data[76:76 + 109 * 4]))
        sect = first_difat
        for _ in range(n_difat):
            if sect >= CFB_END_OF_CHAIN:
                break
            block = self._sector(sect)
            entries = list(self._u32s(block))
            fat_sectors.extend(entries[:-1])
            sect = entries[-1]
        self.fat = []
        for s in fat_sectors:
            if s in (CFB_FREE, CFB_END_OF_CHAIN):
                continue
            self.fat.extend(self._u32s(self._sector(s)))

        self.minifat = list(self._u32s(self._read_chain(first_minifat)))[: n_minifat * self.sector_size // 4]

        dir_bytes = self._read_chain(first_dir)
        self.entries = [self._dir_entry(dir_bytes[i:i + 128])
                        for i in range(0, len(dir_bytes) - 127, 128)]
        if not self.entries or self.entries[0]["type"] != 5:
            raise RenderError("compound file has no root entry")
        root = self.entries[0]
        self.mini_stream = self._read_chain(root["start"])[: root["size"]]

        self.streams = {}
        self._walk(root["child"], "")

    @staticmethod
    def _u32s(buf):
        for i in range(0, len(buf) - 3, 4):
            yield int.from_bytes(buf[i:i + 4], "little")

    def _sector(self, n):
        off = (n + 1) * self.sector_size
        return self.data[off:off + self.sector_size]

    def _read_chain(self, start):
        out, sect, seen = [], start, set()
        while sect < CFB_END_OF_CHAIN:
            if sect in seen or sect >= len(self.fat):
                raise RenderError("corrupt FAT chain")
            seen.add(sect)
            out.append(self._sector(sect))
            sect = self.fat[sect]
        return b"".join(out)

    def _read_mini_chain(self, start, size):
        out, sect, seen = [], start, set()
        while sect < CFB_END_OF_CHAIN:
            if sect in seen or sect >= len(self.minifat):
                raise RenderError("corrupt mini-FAT chain")
            seen.add(sect)
            off = sect * self.mini_size
            out.append(self.mini_stream[off:off + self.mini_size])
            sect = self.minifat[sect]
        return b"".join(out)[:size]

    @staticmethod
    def _dir_entry(raw):
        name_len = int.from_bytes(raw[64:66], "little")
        name = raw[:max(name_len - 2, 0)].decode("utf-16-le", "replace")
        return {
            "name": name,
            "type": raw[66],
            "left": int.from_bytes(raw[68:72], "little"),
            "right": int.from_bytes(raw[72:76], "little"),
            "child": int.from_bytes(raw[76:80], "little"),
            "start": int.from_bytes(raw[116:120], "little"),
            "size": int.from_bytes(raw[120:124], "little"),
        }

    def _walk(self, idx, prefix):
        stack = [idx]
        while stack:
            i = stack.pop()
            if i == CFB_FREE or i >= len(self.entries):
                continue
            e = self.entries[i]
            stack.append(e["left"])
            stack.append(e["right"])
            path = f"{prefix}/{e['name']}"
            if e["type"] == 1:
                self.streams[path] = None
                self._walk(e["child"], path)
            elif e["type"] == 2:
                self.streams[path] = e

    def read(self, path):
        e = self.streams.get(path)
        if e is None:
            return None
        if e["size"] < self.mini_cutoff:
            return self._read_mini_chain(e["start"], e["size"])
        return self._read_chain(e["start"])[: e["size"]]

    def children(self, prefix):
        """Immediate child storage names under prefix (e.g. attachment dirs)."""
        depth = prefix.count("/") + 1
        return sorted({p for p, e in self.streams.items()
                       if e is None and p.startswith(prefix + "/")
                       and p.count("/") == depth})


def _filetime_to_iso(ft):
    # FILETIME: 100 ns ticks since 1601-01-01 UTC.
    import datetime
    epoch = datetime.datetime(1601, 1, 1, tzinfo=datetime.timezone.utc)
    return (epoch + datetime.timedelta(microseconds=ft // 10)).isoformat()


def _codec(codepage):
    return "utf-8" if codepage == 65001 else f"cp{codepage}"


class _MsgNode:
    """A message, embedded message, recipient or attachment storage."""

    def __init__(self, cfb, prefix, codepage):
        self.cfb, self.prefix = cfb, prefix
        self.fixed = {}
        raw = cfb.read(f"{prefix}/__properties_version1.0") or b""
        # Header is 32 bytes on the top-level message, 8 on a recipient or
        # attachment storage. Embedded messages (24) are never opened here.
        header = 32 if prefix == "" else 8
        for i in range(header, len(raw) - 15, 16):
            tag = int.from_bytes(raw[i:i + 4], "little")
            self.fixed[tag] = raw[i + 8:i + 16]
        cp = self.int(0x3FFD)
        self.codepage = _codec(cp) if cp else codepage

    def int(self, prop):
        v = self.fixed.get((prop << 16) | 0x0003)
        return int.from_bytes(v[:4], "little") if v else None

    def time(self, prop):
        v = self.fixed.get((prop << 16) | 0x0040)
        return _filetime_to_iso(int.from_bytes(v, "little")) if v else None

    def text(self, prop):
        raw = self.cfb.read(f"{self.prefix}/__substg1.0_{prop:04X}001F")
        if raw is not None:
            return raw.decode("utf-16-le", "replace")
        raw = self.cfb.read(f"{self.prefix}/__substg1.0_{prop:04X}001E")
        if raw is not None:
            try:
                return raw.decode(self.codepage, "replace")
            except LookupError:
                return raw.decode("cp1252", "replace")
        return None

    def binary(self, prop):
        return self.cfb.read(f"{self.prefix}/__substg1.0_{prop:04X}0102")

    def has_storage(self, prop):
        return f"{self.prefix}/__substg1.0_{prop:04X}000D" in self.cfb.streams


def _msg_address(node, name_prop, smtp_prop, addr_prop):
    name = _collapse_ws(node.text(name_prop))
    addr = _collapse_ws(node.text(smtp_prop) or node.text(addr_prop))
    if addr and "@" not in addr:  # an Exchange DN, not an address
        addr = ""
    if name and addr and name.lower() != addr.lower():
        return f"{name} <{addr}>"
    return addr or name


def _msg_headers(cfb, msg):
    """Transport headers, when Outlook kept them: Date with zone, Message-ID."""
    raw = msg.text(0x007D)
    if not raw:
        return {}
    parsed = email.message_from_string(raw, policy=email.policy.compat32)
    return {k: _collapse_ws(parsed.get(k)) for k in ("Date", "Message-ID", "In-Reply-To")
            if parsed.get(k)}


def render_msg(input_path, attachment_dir=None):
    """Render an Outlook .msg. When attachment_dir is given, each attachment's
    bytes are written there as "<index>_<name>" and its path reported."""
    try:
        with open(input_path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        raise RenderError(f"unreadable .msg: {exc}") from exc
    try:
        cfb = _Cfb(data)
    except RenderError as exc:
        raise RenderError(f"malformed .msg: {exc}") from exc
    if "/__properties_version1.0" not in cfb.streams:
        raise RenderError("malformed .msg: no top-level property stream")

    msg = _MsgNode(cfb, "", "cp1252")

    recipients = {1: [], 2: [], 3: []}
    for path in cfb.children(""):
        if not path.startswith("/__recip_version1.0_"):
            continue
        r = _MsgNode(cfb, path, msg.codepage)
        kind = r.int(0x0C15) or 1
        recipients.setdefault(kind, []).append(
            _msg_address(r, 0x3001, 0x39FE, 0x3003))

    transport = _msg_headers(cfb, msg)
    sent = transport.get("Date")
    if not sent:
        utc = msg.time(0x0039) or msg.time(0x0E06)
        sent = f"{utc} (UTC; original time zone not recorded)" if utc else None

    headers = {
        "From": _msg_address(msg, 0x0C1A, 0x5D01, 0x0C1F)
                or _msg_address(msg, 0x0042, 0x5D02, 0x0065),
        "To": "; ".join(a for a in recipients[1] if a) or _collapse_ws(msg.text(0x0E04)),
        "Cc": "; ".join(a for a in recipients[2] if a) or _collapse_ws(msg.text(0x0E03)),
        "Bcc": "; ".join(a for a in recipients[3] if a) or _collapse_ws(msg.text(0x0E02)),
        "Date": sent,
        "Subject": _collapse_ws(msg.text(0x0037)),
        "Message-ID": transport.get("Message-ID") or _collapse_ws(msg.text(0x1035)),
        "In-Reply-To": transport.get("In-Reply-To") or _collapse_ws(msg.text(0x1042)),
    }
    lines = [f"hdr\t{k}: {headers[k]}" for k in MSG_HEADER_ORDER if headers[k]]

    body_text = msg.text(0x1000)
    if not body_text:
        html_bytes = msg.binary(0x1013)
        if html_bytes:
            cp = msg.int(0x3FDE)
            try:
                body_text = _strip_html(html_bytes.decode(_codec(cp) if cp else msg.codepage, "replace"))
            except LookupError:
                body_text = _strip_html(html_bytes.decode("cp1252", "replace"))
    if not body_text:
        raise RenderError("no plain-text or HTML body in .msg (RTF-only body is not supported)")
    paragraphs = [
        _collapse_ws(block)
        for block in re.split(r"\n\s*\n", body_text.replace("\r\n", "\n"))
        if _collapse_ws(block)
    ]
    for i, text in enumerate(paragraphs, start=1):
        lines.append(f"¶{i}\t{text}")

    import mimetypes
    attachments = []
    for path in cfb.children(""):
        if not path.startswith("/__attach_version1.0_"):
            continue
        idx = len(attachments) + 1
        a = _MsgNode(cfb, path, msg.codepage)
        name = _collapse_ws(a.text(0x3707) or a.text(0x3704)) or f"unnamed-attachment-{idx}"
        entry = {"name": name}
        if a.has_storage(0x3701):
            entry.update({"size": None, "content_type": "application/vnd.ms-outlook",
                          "sha256": None, "path": None,
                          "note": "embedded Outlook message; not extracted"})
        else:
            payload = a.binary(0x3701) or b""
            ctype = _collapse_ws(a.text(0x370E)) or mimetypes.guess_type(name)[0] or "application/octet-stream"
            entry.update({"size": len(payload), "content_type": ctype,
                          "sha256": hashlib.sha256(payload).hexdigest(), "path": None})
            if attachment_dir:
                entry["path"] = _write_attachment(attachment_dir, idx, name, payload)
        attachments.append(entry)

    for att in attachments:
        size = "embedded message" if att["size"] is None else f"{att['size']:,} bytes"
        lines.append(f"Attachment: {att['name']} ({size}, {att['content_type']})")

    return "\n".join(lines) + ("\n" if lines else ""), len(paragraphs), attachments


# ---------------------------------------------------------------------------
# RTF -- Westlaw's .doc downloads are RTF bytes, and every case name in them
# sits in a HYPERLINK field whose instruction is not braced
# ({\*\fldinst HYPERLINK "u"}). pandoc drops the visible result of that form
# (../design-decisions.md #59). This reader keeps \fldrslt text and drops the
# instruction along with every other ignorable destination.
# ---------------------------------------------------------------------------

RTF_DROP = {"fonttbl", "colortbl", "stylesheet", "info", "pict", "fldinst",
            "header", "headerl", "headerr", "headerf",
            "footer", "footerl", "footerr", "footerf"}
RTF_BREAK = {"par", "sect", "page", "row"}
RTF_SPACE = {"line", "tab", "cell"}
RTF_CHAR = {"lquote": "\u2018", "rquote": "\u2019", "ldblquote": "\u201c",
            "rdblquote": "\u201d", "endash": "\u2013", "emdash": "\u2014",
            "bullet": "\u2022"}
RTF_SYMBOL = {"~": "\u00a0", "_": "-", "-": "", "\\": "\\", "{": "{", "}": "}"}
_RTF_TOKEN = re.compile(
    r"\\([a-zA-Z]{1,32})(-?\d{1,10})? ?"   # control word
    r"|\\'([0-9a-fA-F]{2})"                # hex byte in the document code page
    r"|\\(.)"                              # control symbol
    r"|([{}])"
    r"|([^\\{}\r\n]+)"                     # text
    r"|[\r\n]+", re.S)                     # raw line breaks carry no meaning


def render_rtf_bytes(data):
    text = data.decode("latin-1")
    if not text.lstrip().startswith("{\\rtf"):
        raise RenderError("not RTF (a binary Word .doc cannot be read)")
    codepage = "cp1252"
    paragraphs, buf, stack = [], [], []
    skip, uc, pending = False, 1, 0   # pending: \uN fallback units still to drop

    def flush():
        line = _collapse_ws("".join(buf))
        if line:
            paragraphs.append(line)
        buf.clear()

    i, n = 0, len(text)
    while i < n:
        m = _RTF_TOKEN.match(text, i)
        if m is None:
            raise RenderError(f"malformed RTF at byte {i}")
        i = m.end()
        word, arg, hexa, sym, brace, chars = m.groups()
        if brace == "{":
            stack.append((skip, uc))
            pending = 0
        elif brace == "}":
            if not stack:
                raise RenderError(f"unbalanced braces in RTF at byte {i - 1}")
            skip, uc = stack.pop()
            pending = 0
        elif word:
            if word == "bin":
                i += int(arg or 0)
            elif word == "uc":
                uc = int(arg or 1)
            elif word == "ansicpg":
                codepage = f"cp{arg}"
            elif word in RTF_DROP:
                skip = True
            elif skip:
                pass
            elif word == "u" and arg:
                buf.append(chr(int(arg) % 65536))
                pending = uc
            elif word in RTF_BREAK:
                flush()
            elif word in RTF_SPACE:
                buf.append(" ")
            elif word in RTF_CHAR:
                buf.append(RTF_CHAR[word])
        elif hexa:
            if skip:
                continue
            if pending:
                pending -= 1
                continue
            try:
                buf.append(bytes([int(hexa, 16)]).decode(codepage))
            except (LookupError, UnicodeDecodeError) as exc:
                raise RenderError(f"undecodable RTF byte \\'{hexa} in {codepage}: {exc}") from exc
        elif sym:
            if sym == "*":
                skip = True
            elif skip:
                pass
            elif sym in "\r\n":
                flush()
            elif sym in RTF_SYMBOL:
                buf.append(RTF_SYMBOL[sym])
        elif chars and not skip:
            dropped = min(pending, len(chars))
            pending -= dropped
            buf.append(chars[dropped:])
    if stack:
        raise RenderError("unbalanced braces in RTF: a group is never closed")
    flush()
    return "\n".join(paragraphs) + ("\n" if paragraphs else ""), len(paragraphs), []


def render_rtf(input_path):
    try:
        with open(input_path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        raise RenderError(f"unreadable RTF: {exc}") from exc
    return render_rtf_bytes(data)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    head_chars = None
    strip_quoted = "--strip-quoted" in argv
    if strip_quoted:
        argv = [arg for arg in argv if arg != "--strip-quoted"]
    if len(argv) == 4 and argv[2] == "--head-chars":
        head_chars = int(argv[3]) if argv[3].isdigit() else 0
        argv = argv[:2]
        if head_chars < 1:
            print("--head-chars takes a positive integer", file=sys.stderr)
            return 2
    if len(argv) != 2:
        print("usage: render_document.py <input_path> <output_dir> [--head-chars N] [--strip-quoted]", file=sys.stderr)
        return 2

    input_path, output_dir = argv
    ext = os.path.splitext(input_path)[1].lower()
    basename = os.path.basename(input_path)
    att_dir = os.path.join(output_dir, f"{basename}.attachments")
    if strip_quoted and ext != ".eml":
        print("--strip-quoted applies only to an .eml", file=sys.stderr)
        return 2
    meta = {}
    if ext == ".docx":
        renderer, fmt = render_docx, "docx"
    elif ext == ".eml":
        renderer, fmt = (lambda p: render_eml(p, att_dir, strip_quoted, meta)), "eml"
    elif ext == ".msg":
        renderer, fmt = (lambda p: render_msg(p, att_dir)), "msg"
    elif ext in (".doc", ".rtf"):
        renderer, fmt = render_rtf, "rtf"
    else:
        print(f"unsupported extension for rendering: {ext!r}", file=sys.stderr)
        return 1

    try:
        text, paragraph_count, attachments = renderer(input_path)
    except RenderError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{basename}.txt")
    head_path = os.path.join(output_dir, f"{basename}.head.txt")
    writes = [(output_path, text)]
    if head_chars is not None:
        writes.append((head_path, text[:head_chars]))
    for path, content in writes:
        tmp_path = path + ".tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(content)
            os.replace(tmp_path, path)
        except OSError as exc:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            print(f"failed to write rendering: {exc}", file=sys.stderr)
            return 1

    result = {
        "format": fmt,
        "output_path": output_path,
        "paragraph_count": paragraph_count,
        "attachments": attachments,
    }
    if head_chars is not None:
        result["head_path"] = head_path
    result.update(meta)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
