#!/usr/bin/env python3
"""extract_outline.py -- read a PDF's bookmark outline as 1-based page ranges.

Not a database tool: takes one explicit input file, touches no case-data
database, and resolves no matter pointer. It therefore does NOT import
resolve_paths or fuse_safe_io, and it is exempt from the "E1 only" execution
rule in ../scripts.md on the same footing as render_document.py: that rule
protects sqlite binaries and staged copies from stale-mount corruption, and
this script opens no database. It reads one matter document the same way the
ingest gate's inline hash step already does in-session on every path.

Output contract:

  python3 extract_outline.py <pdf_path>

One line of JSON on stdout, exit 0:

  {"pages": N,
   "entries": [{"level": 1, "title": "...", "page": 9, "range": [9, 245]}, ...],
   "anomalies": [{"code": "...", "entry_index": 9, "title": "...", "detail": "..."}]}

entries are in outline (document) order; level 1 is a child of the outline
root; page is 1-based or null; range is a closed [start, end] pair and is null
iff page is null. No outline gives entries: []. Range rule: end is one less
than the smallest page of any entry with level <= this entry's level and a
page strictly greater than this entry's page, else the page count. Anomaly
codes are a closed vocabulary: missing_title, missing_dest, dest_and_action,
unresolved_dest, action_not_goto, page_out_of_order, page_count_mismatch,
stream_length_mismatch. entry_index and title are null for the last two.

On failure prints {"error": "<reason>"} on stdout and exits 1, never a
partial outline. Wrong argument count prints usage to stderr and exits 2.

Object loading is xref-driven and strictly validated with no brute-force
reconstruction fallback: a scan for "N 0 obj" silently returns whatever
survives a truncated or stale-mounted file and resurrects freed objects.
Supported: classic xref tables, /Type /XRef streams (/W, /Index, /Size),
/XRefStm before /Prev with newest section winning, object streams, and
/FlateDecode with PNG predictors 10-15. Anything else (encryption, other
filters, /Predictor 2, offsets out of range, xref loops, header mismatches at
an offset, outline cycles, depth over 64, trailing bytes after the final
%%EOF) is an error. Imports only the Python standard library.
"""

import json
import re
import sys
import zlib
from collections import namedtuple

WHITESPACE = b"\x00\t\n\x0c\r "
DELIMITERS = b"()<>[]{}/%"
MAX_DEPTH = 64
_NUMBER_RE = re.compile(rb"^[+-]?(\d+\.?\d*|\.\d+)$")
_ESCAPES = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}

# PDFDocEncoding code points that differ from Latin-1 (0x80-0xAD).
_PDFDOC = {
    0x80: "•", 0x81: "†", 0x82: "‡", 0x83: "…", 0x84: "—",
    0x85: "–", 0x86: "ƒ", 0x87: "⁄", 0x88: "‹", 0x89: "›",
    0x8A: "−", 0x8B: "‰", 0x8C: "„", 0x8D: "“", 0x8E: "”",
    0x8F: "‘", 0x90: "’", 0x91: "‚", 0x92: "™", 0x93: "ﬁ",
    0x94: "ﬂ", 0x95: "Ł", 0x96: "Œ", 0x97: "Š", 0x98: "Ÿ",
    0x99: "Ž", 0x9A: "ı", 0x9B: "ł", 0x9C: "œ", 0x9D: "š",
    0x9E: "ž", 0xA0: "€",
}


class PDFError(Exception):
    pass


# --------------------------------------------------------------------------
# Object model
# --------------------------------------------------------------------------

class Name(str):
    __slots__ = ()


class Keyword(str):
    __slots__ = ()


Ref = namedtuple("Ref", "num gen")
PageMap = namedtuple("PageMap", "index count")


class Stream:
    def __init__(self, dict_, raw, doc):
        self.dict = dict_
        self.raw = raw
        self.doc = doc
        self._decoded = None

    def decoded(self):
        if self._decoded is None:
            self._decoded = _decode_stream(self)
        return self._decoded


def _anomaly(code, entry_index, title, detail):
    return {"code": code, "entry_index": entry_index, "title": title, "detail": detail}


def _refstr(ref):
    return f"{ref.num} {ref.gen} R" if isinstance(ref, Ref) else repr(ref)


# --------------------------------------------------------------------------
# Lexer / Parser
# --------------------------------------------------------------------------

class Lexer:
    def __init__(self, data, pos=0):
        self.data = data
        self.pos = pos

    def skip_ws(self):
        data, n = self.data, len(self.data)
        while self.pos < n:
            c = data[self.pos]
            if c in WHITESPACE:
                self.pos += 1
            elif c == 0x25:  # % comment to end of line
                while self.pos < n and data[self.pos] not in b"\r\n":
                    self.pos += 1
            else:
                break

    def token(self):
        """Return (kind, value): num, name, str, delim, kw, or eof."""
        self.skip_ws()
        data, n = self.data, len(self.data)
        if self.pos >= n:
            return ("eof", None)
        c = data[self.pos]
        if c == 0x2F:
            return ("name", self._name())
        if c == 0x28:
            return ("str", self._literal())
        if c == 0x3C:
            if data[self.pos + 1:self.pos + 2] == b"<":
                self.pos += 2
                return ("delim", "<<")
            return ("str", self._hex())
        if c == 0x3E:
            if data[self.pos + 1:self.pos + 2] == b">":
                self.pos += 2
                return ("delim", ">>")
            raise PDFError(f"unexpected '>' at offset {self.pos}")
        if c in b"[]{}":
            self.pos += 1
            return ("delim", chr(c))
        if c == 0x29:
            raise PDFError(f"unexpected ')' at offset {self.pos}")
        start = self.pos
        while self.pos < n and data[self.pos] not in WHITESPACE and data[self.pos] not in DELIMITERS:
            self.pos += 1
        word = data[start:self.pos]
        if _NUMBER_RE.match(word):
            return ("num", float(word) if b"." in word else int(word))
        return ("kw", word.decode("latin-1"))

    def _name(self):
        data, n = self.data, len(self.data)
        self.pos += 1
        start = self.pos
        while self.pos < n and data[self.pos] not in WHITESPACE and data[self.pos] not in DELIMITERS:
            self.pos += 1
        raw = data[start:self.pos]
        if b"#" in raw:
            raw = re.sub(rb"#([0-9A-Fa-f]{2})", lambda m: bytes([int(m.group(1), 16)]), raw)
        return Name(raw.decode("latin-1"))

    def _literal(self):
        data, n = self.data, len(self.data)
        start = self.pos
        self.pos += 1
        depth = 1
        out = bytearray()
        while True:
            if self.pos >= n:
                raise PDFError(f"unterminated literal string at offset {start}")
            c = data[self.pos]
            self.pos += 1
            if c == 0x5C:
                if self.pos >= n:
                    raise PDFError(f"unterminated literal string at offset {start}")
                e = data[self.pos]
                self.pos += 1
                if e in b"01234567":
                    digits = bytes([e])
                    while len(digits) < 3 and self.pos < n and data[self.pos] in b"01234567":
                        digits += bytes([data[self.pos]])
                        self.pos += 1
                    out.append(int(digits, 8) & 0xFF)
                elif e == 0x0D:
                    if data[self.pos:self.pos + 1] == b"\n":
                        self.pos += 1
                elif e == 0x0A:
                    pass
                else:
                    out.append(_ESCAPES.get(e, e))
            elif c == 0x28:
                depth += 1
                out.append(c)
            elif c == 0x29:
                depth -= 1
                if depth == 0:
                    return bytes(out)
                out.append(c)
            elif c == 0x0D:
                if data[self.pos:self.pos + 1] == b"\n":
                    self.pos += 1
                out.append(0x0A)
            else:
                out.append(c)

    def _hex(self):
        start = self.pos
        self.pos += 1
        end = self.data.find(b">", self.pos)
        if end < 0:
            raise PDFError(f"unterminated hex string at offset {start}")
        body = re.sub(rb"\s+", b"", self.data[self.pos:end])
        self.pos = end + 1
        if re.search(rb"[^0-9A-Fa-f]", body):
            raise PDFError(f"invalid hex string at offset {start}")
        if len(body) % 2:
            body += b"0"
        return bytes.fromhex(body.decode("ascii"))


class Parser:
    def __init__(self, data, pos=0, doc=None):
        self.lex = Lexer(data, pos)
        self.doc = doc

    def parse(self):
        kind, val = self.lex.token()
        return self._object(kind, val)

    def _object(self, kind, val):
        if kind == "eof":
            raise PDFError(f"unexpected end of data at offset {self.lex.pos}")
        if kind == "num":
            if isinstance(val, int) and val >= 0:
                save = self.lex.pos
                k2, v2 = self.lex.token()
                if k2 == "num" and isinstance(v2, int) and v2 >= 0:
                    k3, v3 = self.lex.token()
                    if k3 == "kw" and v3 == "R":
                        return Ref(val, v2)
                self.lex.pos = save
            return val
        if kind in ("name", "str"):
            return val
        if kind == "kw":
            if val == "true":
                return True
            if val == "false":
                return False
            if val == "null":
                return None
            return Keyword(val)
        if val == "[":
            items = []
            while True:
                k, v = self.lex.token()
                if k == "delim" and v == "]":
                    return items
                items.append(self._object(k, v))
        if val == "<<":
            d = {}
            while True:
                k, v = self.lex.token()
                if k == "delim" and v == ">>":
                    break
                if k != "name":
                    raise PDFError(f"expected a name key in dictionary at offset {self.lex.pos}, got {v!r}")
                d[v] = self.parse()
            return self._maybe_stream(d)
        raise PDFError(f"unexpected token {val!r} at offset {self.lex.pos}")

    def _maybe_stream(self, d):
        save = self.lex.pos
        k, v = self.lex.token()
        if not (k == "kw" and v == "stream"):
            self.lex.pos = save
            return d
        data = self.lex.data
        p = self.lex.pos
        if data[p:p + 2] == b"\r\n":
            p += 2
        elif data[p:p + 1] in (b"\n", b"\r"):
            p += 1
        start = p
        length = d.get("Length")
        if isinstance(length, Ref):
            if self.doc is None:
                raise PDFError(f"stream at offset {start} has an indirect /Length and no document context")
            length = self.doc.get(length)
        end = None
        if isinstance(length, int) and not isinstance(length, bool) and 0 <= length <= len(data) - start:
            probe = Lexer(data, start + length)
            probe.skip_ws()
            if data.startswith(b"endstream", probe.pos):
                end = start + length
                after = probe.pos + 9
        if end is None:
            idx = data.find(b"endstream", start)
            if idx < 0:
                raise PDFError(f"unterminated stream at offset {start}")
            end = idx
            for eol in (b"\r\n", b"\n", b"\r"):
                if data.endswith(eol, start, end):
                    end -= len(eol)
                    break
            after = idx + 9
            if self.doc is not None:
                self.doc.anomalies.append(_anomaly(
                    "stream_length_mismatch", None, None,
                    f"stream at offset {start}: /Length {length!r} is not followed by endstream; "
                    f"used {end - start} bytes up to the endstream keyword"))
        self.lex.pos = after
        return Stream(d, data[start:end], self.doc)


# --------------------------------------------------------------------------
# Filters
# --------------------------------------------------------------------------

def _flate(data, where):
    try:
        return zlib.decompress(data)
    except zlib.error as exc:
        raise PDFError(f"corrupt Flate data in {where}: {exc}") from exc


def _png_predictor(data, colors, bpc, columns):
    bpp = max(1, (colors * bpc + 7) // 8)
    rowlen = (colors * bpc * columns + 7) // 8
    if rowlen <= 0 or len(data) % (rowlen + 1):
        raise PDFError(f"PNG-predicted data of {len(data)} bytes is not a multiple of row length {rowlen + 1}")
    prev = bytearray(rowlen)
    out = bytearray()
    for r in range(0, len(data), rowlen + 1):
        ft = data[r]
        row = bytearray(data[r + 1:r + 1 + rowlen])
        if ft == 0:
            pass
        elif ft == 1:
            for i in range(bpp, rowlen):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif ft == 2:
            for i in range(rowlen):
                row[i] = (row[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(rowlen):
                left = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + (left + prev[i]) // 2) & 0xFF
        elif ft == 4:
            for i in range(rowlen):
                a = row[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    pred = a
                elif pb <= pc:
                    pred = b
                else:
                    pred = c
                row[i] = (row[i] + pred) & 0xFF
        else:
            raise PDFError(f"unsupported PNG filter type {ft} in predicted row {r // (rowlen + 1)}")
        out += row
        prev = row
    return bytes(out)


def _decode_stream(stream):
    d = stream.dict
    deref = stream.doc.deref if stream.doc is not None else (lambda x: x)
    filters = deref(d.get("Filter"))
    if filters is None:
        filters = []
    elif isinstance(filters, Name):
        filters = [filters]
    if not isinstance(filters, list):
        raise PDFError(f"/Filter is not a name or array: {filters!r}")
    parms = deref(d.get("DecodeParms"))
    if parms is None:
        parms = []
    elif isinstance(parms, dict):
        parms = [parms]
    parms = list(parms) + [None] * (len(filters) - len(parms))
    data = stream.raw
    for f, p in zip(filters, parms):
        f = deref(f)
        if f != "FlateDecode":
            raise PDFError(f"unsupported stream filter /{f}")
        data = _flate(data, "stream")
        p = deref(p) or {}
        pred = deref(p.get("Predictor", 1))
        if pred == 1:
            continue
        if isinstance(pred, int) and pred >= 10:
            data = _png_predictor(data, deref(p.get("Colors", 1)), deref(p.get("BitsPerComponent", 8)),
                                  deref(p.get("Columns", 1)))
        else:
            raise PDFError(f"unsupported /Predictor {pred!r}")
    return data


# --------------------------------------------------------------------------
# Document: xref-driven object access
# --------------------------------------------------------------------------

class Document:
    def __init__(self, data):
        self.data = data
        self.anomalies = []
        self.xref = {}
        self.trailer = {}
        self._cache = {}
        self._objstms = {}
        self._loading = set()
        if not data.startswith(b"%PDF-"):
            raise PDFError("no %PDF- header at offset 0")
        self._load_xref_chain(self._find_startxref())
        if "Encrypt" in self.trailer:
            raise PDFError("encrypted PDF (/Encrypt in trailer) is not supported")

    def _find_startxref(self):
        data = self.data
        tail = data.rstrip(WHITESPACE)
        if not tail.endswith(b"%%EOF"):
            raise PDFError("file does not end with %%EOF (truncated file or torn incremental update)")
        idx = data.rfind(b"startxref", 0, len(tail))
        if idx < 0:
            raise PDFError("no startxref keyword")
        k, v = Lexer(data, idx + 9).token()
        if k != "num" or not isinstance(v, int):
            raise PDFError(f"startxref at offset {idx} is not followed by an integer offset")
        return v

    def _load_xref_chain(self, start):
        seen = set()
        stack = [start]
        while stack:
            off = stack.pop()
            if off in seen:
                raise PDFError(f"xref chain loop at offset {off}")
            seen.add(off)
            if not 0 <= off < len(self.data):
                raise PDFError(f"xref offset {off} out of range (file is {len(self.data)} bytes)")
            trailer = self._parse_xref_section(off)
            for k, v in trailer.items():
                self.trailer.setdefault(k, v)
            for key in ("Prev", "XRefStm"):  # XRefStm pushed last so it is processed before Prev
                v = trailer.get(key)
                if v is not None:
                    if not isinstance(v, int) or isinstance(v, bool):
                        raise PDFError(f"/{key} at xref offset {off} is not an integer")
                    stack.append(v)

    def _parse_xref_section(self, off):
        lex = Lexer(self.data, off)
        lex.skip_ws()
        if self.data.startswith(b"xref", lex.pos):
            return self._parse_xref_table(lex.pos + 4)
        return self._parse_xref_stream(lex.pos)

    def _parse_xref_table(self, pos):
        lex = Lexer(self.data, pos)
        while True:
            lex.skip_ws()
            if self.data.startswith(b"trailer", lex.pos):
                trailer = Parser(self.data, lex.pos + 7, self).parse()
                if not isinstance(trailer, dict):
                    raise PDFError(f"trailer at offset {lex.pos} is not a dictionary")
                return trailer
            k1, start = lex.token()
            k2, count = lex.token()
            if k1 != "num" or k2 != "num" or not isinstance(start, int) or not isinstance(count, int):
                raise PDFError(f"malformed xref subsection header at offset {lex.pos}")
            for i in range(count):
                ko, o = lex.token()
                kg, g = lex.token()
                kt, t = lex.token()
                if ko != "num" or kg != "num" or kt != "kw" or t not in ("n", "f"):
                    raise PDFError(f"malformed xref entry for object {start + i} at offset {lex.pos}")
                if t == "n":
                    self.xref.setdefault(start + i, ("offset", o, g))
                else:
                    self.xref.setdefault(start + i, ("free",))

    def _parse_xref_stream(self, pos):
        parser = Parser(self.data, pos, self)
        k1, num = parser.lex.token()
        k2, gen = parser.lex.token()
        k3, kw = parser.lex.token()
        if k1 != "num" or k2 != "num" or k3 != "kw" or kw != "obj":
            raise PDFError(f"no xref table or xref stream at offset {pos}")
        obj = parser.parse()
        if not isinstance(obj, Stream) or obj.dict.get("Type") != "XRef":
            raise PDFError(f"object at offset {pos} is not an xref table or /Type /XRef stream")
        d = obj.dict
        w = d.get("W")
        size = d.get("Size")
        if not isinstance(w, list) or len(w) < 2 or not all(isinstance(x, int) and x >= 0 for x in w):
            raise PDFError(f"xref stream at offset {pos}: invalid /W {w!r}")
        if not isinstance(size, int):
            raise PDFError(f"xref stream at offset {pos}: invalid /Size {size!r}")
        index = d.get("Index", [0, size])
        if not isinstance(index, list) or len(index) % 2 or not all(isinstance(x, int) for x in index):
            raise PDFError(f"xref stream at offset {pos}: invalid /Index {index!r}")
        w = list(w) + [0] * (3 - len(w))
        rowlen = sum(w)
        data = obj.decoded()
        pairs = list(zip(index[0::2], index[1::2]))
        needed = sum(c for _, c in pairs) * rowlen
        if len(data) < needed:
            raise PDFError(f"xref stream at offset {pos}: {len(data)} bytes decoded, {needed} needed")
        p = 0
        for start, count in pairs:
            for i in range(count):
                fields = []
                for width in w:
                    fields.append(int.from_bytes(data[p:p + width], "big") if width else None)
                    p += width
                typ = 1 if fields[0] is None else fields[0]
                f2 = fields[1] or 0
                f3 = fields[2] or 0
                if typ == 1:
                    self.xref.setdefault(start + i, ("offset", f2, f3))
                elif typ == 2:
                    self.xref.setdefault(start + i, ("compressed", f2, f3))
                else:
                    self.xref.setdefault(start + i, ("free",))
        return d

    def deref(self, obj):
        return self.get(obj) if isinstance(obj, Ref) else obj

    def get(self, ref):
        key = ref.num
        if key in self._cache:
            return self._cache[key]
        entry = self.xref.get(key)
        if entry is None or entry[0] == "free":
            return None
        if key in self._loading:
            raise PDFError(f"reference cycle while loading object {key}")
        self._loading.add(key)
        try:
            if entry[0] == "offset":
                obj = self._load_at(key, entry[1])
            else:
                obj = self._load_compressed(key, entry[1])
        finally:
            self._loading.discard(key)
        self._cache[key] = obj
        return obj

    def _load_at(self, num, off):
        if not isinstance(off, int) or not 0 <= off < len(self.data):
            raise PDFError(f"object {num}: xref offset {off!r} out of range (file is {len(self.data)} bytes)")
        parser = Parser(self.data, off, self)
        k1, n = parser.lex.token()
        k2, _gen = parser.lex.token()
        k3, kw = parser.lex.token()
        if k1 != "num" or n != num or k2 != "num" or k3 != "kw" or kw != "obj":
            raise PDFError(f"object {num}: no '{num} <gen> obj' header at xref offset {off}")
        obj = parser.parse()
        if isinstance(obj, Keyword) and obj == "endobj":
            return None
        return obj

    def _load_compressed(self, num, stmnum):
        data, offsets, first = self._objstm(stmnum)
        if num not in offsets:
            raise PDFError(f"object {num}: not listed in the header of object stream {stmnum}")
        return Parser(data, first + offsets[num], self).parse()

    def _objstm(self, stmnum):
        if stmnum in self._objstms:
            return self._objstms[stmnum]
        stm = self.get(Ref(stmnum, 0))
        if not isinstance(stm, Stream) or stm.dict.get("Type") != "ObjStm":
            raise PDFError(f"object {stmnum} is not a /Type /ObjStm stream")
        n = self.deref(stm.dict.get("N"))
        first = self.deref(stm.dict.get("First"))
        if not isinstance(n, int) or not isinstance(first, int) or n < 0 or first < 0:
            raise PDFError(f"object stream {stmnum}: invalid /N {n!r} or /First {first!r}")
        data = stm.decoded()
        lex = Lexer(data, 0)
        offsets = {}
        for i in range(n):
            ka, a = lex.token()
            kb, b = lex.token()
            if ka != "num" or kb != "num" or not isinstance(a, int) or not isinstance(b, int):
                raise PDFError(f"object stream {stmnum}: malformed header pair {i}")
            if first + b >= len(data):
                raise PDFError(f"object stream {stmnum}: object {a} offset {b} beyond stream data")
            offsets[a] = b
        if lex.pos > first:
            raise PDFError(f"object stream {stmnum}: header runs past /First {first}")
        self._objstms[stmnum] = (data, offsets, first)
        return self._objstms[stmnum]

    def catalog(self):
        root = self.deref(self.trailer.get("Root"))
        if not isinstance(root, dict):
            raise PDFError("trailer /Root missing or not a dictionary")
        return root


# --------------------------------------------------------------------------
# Semantic layer
# --------------------------------------------------------------------------

def flatten_pages(doc):
    """Return (page refs in order, {ref: 0-based index}, anomalies)."""
    catalog = doc.catalog()
    root_ref = catalog.get("Pages")
    root = doc.deref(root_ref)
    if not isinstance(root, dict):
        raise PDFError("catalog /Pages missing or not a dictionary")
    pages = []
    index = {}
    visited = set()

    def walk(node_ref, node, depth):
        if depth > MAX_DEPTH:
            raise PDFError(f"page tree deeper than {MAX_DEPTH} levels")
        kids = doc.deref(node.get("Kids"))
        if kids is None:
            if isinstance(node_ref, Ref):
                index[node_ref] = len(pages)
            pages.append(node_ref)
            return
        if not isinstance(kids, list):
            raise PDFError(f"page tree node {_refstr(node_ref)}: /Kids is not an array")
        for kid_ref in kids:
            if isinstance(kid_ref, Ref):
                if kid_ref in visited:
                    raise PDFError(f"page tree cycle at {_refstr(kid_ref)}")
                visited.add(kid_ref)
            kid = doc.deref(kid_ref)
            if not isinstance(kid, dict):
                raise PDFError(f"page tree kid {_refstr(kid_ref)} is not a dictionary")
            walk(kid_ref, kid, depth + 1)

    if isinstance(root_ref, Ref):
        visited.add(root_ref)
    walk(root_ref, root, 0)
    anomalies = []
    count = doc.deref(root.get("Count"))
    if count != len(pages):
        anomalies.append(_anomaly("page_count_mismatch", None, None,
                                  f"/Pages /Count is {count!r} but {len(pages)} pages were found"))
    return pages, index, anomalies


def _key_bytes(key):
    return key.encode("latin-1") if isinstance(key, Name) else key


def build_named_dests(doc):
    """Map name bytes -> destination object from /Root /Dests and /Root /Names /Dests."""
    catalog = doc.catalog()
    dests = {}
    legacy = doc.deref(catalog.get("Dests"))
    if isinstance(legacy, dict):
        for k, v in legacy.items():
            dests[_key_bytes(k)] = v
    names = doc.deref(catalog.get("Names"))
    tree = doc.deref(names.get("Dests")) if isinstance(names, dict) else None
    if isinstance(tree, dict):
        visited = set()

        def walk(node, depth):
            if depth > MAX_DEPTH:
                raise PDFError(f"name tree deeper than {MAX_DEPTH} levels")
            kids = doc.deref(node.get("Kids"))
            if isinstance(kids, list):
                for kid_ref in kids:
                    if isinstance(kid_ref, Ref):
                        if kid_ref in visited:
                            raise PDFError(f"name tree cycle at {_refstr(kid_ref)}")
                        visited.add(kid_ref)
                    kid = doc.deref(kid_ref)
                    if isinstance(kid, dict):
                        walk(kid, depth + 1)
            pairs = doc.deref(node.get("Names"))
            if isinstance(pairs, list):
                for i in range(0, len(pairs) - 1, 2):
                    key = doc.deref(pairs[i])
                    if isinstance(key, (bytes, Name)):
                        dests.setdefault(_key_bytes(key), pairs[i + 1])

        walk(tree, 0)
    return dests


def resolve_dest(dest, doc, pagemap, named, depth=0):
    """Return (1-based page or None, anomaly code or None, detail or None)."""
    if depth > 8:
        return None, "unresolved_dest", "destination chain deeper than 8 levels"
    dest = doc.deref(dest)
    if isinstance(dest, (bytes, Name)):
        target = named.get(_key_bytes(dest))
        if target is None:
            shown = _key_bytes(dest).decode("latin-1")
            return None, "unresolved_dest", f"named destination {shown!r} not found"
        return resolve_dest(target, doc, pagemap, named, depth + 1)
    if isinstance(dest, dict):
        if "D" not in dest:
            return None, "unresolved_dest", "destination dictionary has no /D"
        return resolve_dest(dest["D"], doc, pagemap, named, depth + 1)
    if isinstance(dest, list):
        if not dest:
            return None, "unresolved_dest", "empty destination array"
        target = dest[0]
        if isinstance(target, Ref):
            if target in pagemap.index:
                return pagemap.index[target] + 1, None, None
            return None, "unresolved_dest", f"destination page {_refstr(target)} is not in the page tree"
        if isinstance(target, int) and not isinstance(target, bool):
            if 0 <= target < pagemap.count:
                return target + 1, None, None
            return None, "unresolved_dest", (
                f"destination page index {target} out of range (document has {pagemap.count} pages)")
        return None, "unresolved_dest", f"destination array starts with {type(target).__name__}, not a page"
    return None, "unresolved_dest", f"unsupported destination type {type(dest).__name__}"


def walk_outline(doc):
    """Return [(level, item dict)] in document order; level 1 = children of the root."""
    catalog = doc.catalog()
    outlines = doc.deref(catalog.get("Outlines"))
    if not isinstance(outlines, dict):
        return []
    items = []
    seen = set()

    def walk(ref, level):
        if level > MAX_DEPTH:
            raise PDFError(f"outline deeper than {MAX_DEPTH} levels")
        while ref is not None:
            node = doc.deref(ref)
            if not isinstance(node, dict):
                raise PDFError(f"outline item {_refstr(ref)} is not a dictionary")
            key = ref if isinstance(ref, Ref) else id(node)
            if key in seen:
                raise PDFError(f"outline cycle at {_refstr(ref)}")
            seen.add(key)
            items.append((level, node))
            if node.get("First") is not None:
                walk(node["First"], level + 1)
            ref = node.get("Next")

    walk(outlines.get("First"), 1)
    return items


def decode_title(raw):
    if raw.startswith(b"\xfe\xff"):
        text = raw[2:].decode("utf-16-be", errors="replace")
    elif raw.startswith(b"\xef\xbb\xbf"):
        text = raw[3:].decode("utf-8", errors="replace")
    else:
        text = "".join(_PDFDOC.get(b, chr(b)) for b in raw)
    return re.sub(r"\s+", " ", text).strip()


def compute_ranges(entries, page_count):
    """Fill each entry's range in place; return page_out_of_order anomalies."""
    anomalies = []
    paged = [e for e in entries if e["page"] is not None]
    high = None
    for i, e in enumerate(entries):
        p = e["page"]
        if p is None:
            e["range"] = None
            continue
        later = [o["page"] for o in paged if o["level"] <= e["level"] and o["page"] > p]
        e["range"] = [p, min(later) - 1 if later else page_count]
        if high is not None and p < high[0]:
            anomalies.append(_anomaly("page_out_of_order", i, e["title"],
                                      f"page {p} precedes page {high[0]} of earlier entry {high[1]!r}"))
        if high is None or p > high[0]:
            high = (p, e["title"])
    return anomalies


def extract_outline(path):
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        raise PDFError(f"cannot read {path}: {exc}") from exc
    doc = Document(data)
    pages, index, doc_anomalies = flatten_pages(doc)
    pagemap = PageMap(index, len(pages))
    named = build_named_dests(doc)
    entries = []
    entry_anomalies = []
    for level, node in walk_outline(doc):
        i = len(entries)
        raw_title = doc.deref(node.get("Title"))
        if isinstance(raw_title, bytes):
            title = decode_title(raw_title)
        else:
            title = ""
            entry_anomalies.append(_anomaly("missing_title", i, title, "outline item has no string /Title"))
        dest = node.get("Dest")
        action = node.get("A")
        page = None
        if dest is not None and action is not None:
            entry_anomalies.append(_anomaly("dest_and_action", i, title,
                                            "outline item has both /Dest and /A; /Dest used"))
        if dest is not None:
            page, code, detail = resolve_dest(dest, doc, pagemap, named)
            if code:
                entry_anomalies.append(_anomaly(code, i, title, detail))
        elif action is not None:
            act = doc.deref(action)
            if isinstance(act, dict) and act.get("S") == "GoTo":
                if "D" in act:
                    page, code, detail = resolve_dest(act["D"], doc, pagemap, named)
                else:
                    code, detail = "unresolved_dest", "GoTo action has no /D"
                if code:
                    entry_anomalies.append(_anomaly(code, i, title, detail))
            else:
                s = act.get("S") if isinstance(act, dict) else None
                entry_anomalies.append(_anomaly("action_not_goto", i, title,
                                                f"action /S is /{s}" if s is not None else "action is not a GoTo"))
        else:
            entry_anomalies.append(_anomaly("missing_dest", i, title, "outline item has neither /Dest nor /A"))
        entries.append({"level": level, "title": title, "page": page, "range": None})
    entry_anomalies += compute_ranges(entries, len(pages))
    entry_anomalies.sort(key=lambda a: a["entry_index"])
    return {"pages": len(pages), "entries": entries,
            "anomalies": doc.anomalies + doc_anomalies + entry_anomalies}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: extract_outline.py <pdf_path>", file=sys.stderr)
        return 2
    try:
        result = extract_outline(argv[0])
    except PDFError as exc:
        print(json.dumps({"error": str(exc)}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
