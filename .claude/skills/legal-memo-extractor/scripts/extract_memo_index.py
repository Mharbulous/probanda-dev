#!/usr/bin/env python3
"""Index AI legal research memos (Westlaw AI-Assisted Research, Alexi) into a
single research_memos_index.md.

Stdlib only (zipfile, zlib, xml.etree, re). Sources:
  westlaw  - .docx: non-standard OPC (root document.xml, w:wordDocument root),
             with a legacy pipe-delimited plain-text fallback
  alexi    - .docx: standard OPC with named paragraph styles
             .pdf:  wkhtmltopdf 1.4 output (ToUnicode CMaps present)

Every input file is accounted for: parsed, skipped (with reason), or errored
(reported by name). Nothing fails silently.
"""

import argparse
import json
import re
import sys
import zipfile
import zlib
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path, PureWindowsPath

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

DISCLAIMER_PREFIX = "The above response is AI-generated"
SUMMARY_LIMIT = 499
ROLLUP_MIN_CITATIONS = 5

# ---------------------------------------------------------------- shared

def p_text(p):
    return "".join(t.text or "" for t in p.iter(W + "t"))


def p_style(p):
    ppr = p.find(W + "pPr")
    if ppr is not None:
        ps = ppr.find(W + "pStyle")
        if ps is not None:
            return (ps.get(W + "val") or "").replace("_", "").lower()
    return ""


def collapse_ws(s):
    return re.sub(r"\s+", " ", s).strip()


def clean_text(s):
    """Strip and drop newlines but preserve interior spacing (source memos use
    meaningful double spaces after sentences; the index reproduces them)."""
    return s.replace("\r", " ").replace("\n", " ").strip()


def truncate_summary(text, limit=SUMMARY_LIMIT):
    text = clean_text(text)
    if len(text) <= limit:
        return text, False
    cut = text.rfind(" ", 0, limit + 1)
    if cut <= 0:
        cut = limit
    return text[:cut], True

# ---------------------------------------------------------------- detection

ALEXI_NON_MEMO_RE = re.compile(r"weekly|accounting", re.IGNORECASE)


def detect(path):
    """Return (source, container, reason). source None => not indexable."""
    name = path.name.lower()
    named_alexi = "alexi" in name
    named_westlaw = "westlaw" in name
    if named_alexi and ALEXI_NON_MEMO_RE.search(name):
        return None, None, "Alexi weekly/accounting report, not a research memo"
    if path.suffix.lower() not in (".docx", ".pdf", ".doc"):
        return None, None, f"unsupported extension {path.suffix}"

    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names = set(z.namelist())
            if "document.xml" in names and "word/document.xml" not in names:
                return "westlaw", "opc", "non-standard OPC (root document.xml)"
            if "word/document.xml" in names:
                xml_bytes = z.read("word/document.xml")
                alexi_marks = (b"badgestyle" in xml_bytes or b"badge_style" in xml_bytes)
                if named_alexi or alexi_marks:
                    return "alexi", "docx", "standard OPC with Alexi badge styles"
                if named_westlaw:
                    return "westlaw", "opc-standard", "named Westlaw but standard OPC layout"
                return None, None, "Word file with no recognized memo markers"
    elif path.suffix.lower() == ".pdf":
        head = path.read_bytes()[:4096]
        alexi_title = b"\xfe\xff\x00A\x00l\x00e\x00x\x00i" in head or b"/Title (Alexi)" in head
        if named_alexi or alexi_title:
            return "alexi", "pdf", "wkhtmltopdf PDF with Alexi title"
        return None, None, "PDF with no recognized memo markers"
    else:
        # not a ZIP: possibly the legacy Westlaw plain-text export
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            return None, None, f"unreadable: {exc}"
        if named_westlaw or re.search(r"^\|\s*\d+\\\.", text, re.MULTILINE):
            return "westlaw", "text", "legacy pipe-delimited plain text"
    return None, None, "no recognized memo markers (filename or content)"

# ---------------------------------------------------------------- westlaw OPC

def parse_westlaw_opc(path):
    with zipfile.ZipFile(path) as z:
        entry = "document.xml" if "document.xml" in z.namelist() else "word/document.xml"
        root = ET.fromstring(z.read(entry))
    body = root.find(W + "body")
    if body is None:
        raise ValueError("no w:body element")

    memo = {
        "file_name": path.name,
        "file_size": path.stat().st_size,
        "source": "westlaw",
        "jurisdiction": "Unknown",
        "meta": {},
        "questions": [],
    }
    current_q = None
    for tbl in body.findall(W + "tbl"):
        texts = [t for t in (p_text(p).strip() for p in tbl.findall(".//" + W + "p")) if t]
        if not texts:
            continue
        marker = next((i for i, t in enumerate(texts)
                       if t in ("Question", "Follow-up question")), None)
        if marker is not None:
            for t in texts[:marker]:
                m = re.match(r"Jurisdictions?:\s*(.+)", t)
                if m:
                    memo["jurisdiction"] = collapse_ws(m.group(1))
            q_num = q_text = None
            answer_parts = []
            for t in texts[marker + 1:]:
                if q_num is None:
                    m = re.match(r"(\d+)\.\s*(.+)", t, re.DOTALL)
                    if m:
                        q_num, q_text = int(m.group(1)), clean_text(m.group(2))
                    continue
                if t.startswith(DISCLAIMER_PREFIX):
                    break
                answer_parts.append(t)
            if q_num is not None:
                current_q = {
                    "number": q_num,
                    "text": q_text,
                    "answer": " ".join(answer_parts),
                    "authorities": [],
                }
                memo["questions"].append(current_q)
            continue
        if texts[0] in ("Supporting materials", "Additional Research on This Topic"):
            continue
        m = re.match(r"(\d+)\.\s+(.+)", texts[0], re.DOTALL)
        if m and current_q is not None:
            current_q["authorities"].append({
                "name": collapse_ws(m.group(2)),
                "detail": texts[1] if len(texts) > 1 else "",
            })
    if not memo["questions"]:
        raise ValueError("no Question blocks found")
    return memo

# ---------------------------------------------------------------- westlaw legacy text

HEADING_KEYWORDS = [
    "Procedural Requirements", "Authorization", "Case Law", "Mandatory Duty",
    "Reasonable Enforcement", "Legal Consequences", "Duty of the Strata",
    "Owner's Rights and Remedies", "Implied Covenants", "Misrepresentation",
    "Lease Provisions", "Actionable Nuisance", "Duty of", "Rights and",
    "Requirements",
]


def _is_answer_heading(text):
    if ":" in text:
        before = text.split(":")[0]
        if len(before) < 100 and any(k.lower() in before.lower() for k in HEADING_KEYWORDS):
            return True
    if text.startswith("..]()") or text[:20].count("..]()") > 0:
        return True
    if text.count("](()") > 2 or text.count("..]()") > 1:
        return True
    if len(text) < 30:
        return True
    if text.strip().endswith(":"):
        return True
    return False


def parse_westlaw_text(path):
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    jurisdiction = "Unknown"
    for line in lines[:10]:
        if "**Jurisdictions:**" in line:
            jurisdiction = line.split("**Jurisdictions:**")[1].strip()
            break
    numbered = re.compile(r"^\|\s*(\d+)\\\.\s+(.+?)\s*\|$")
    questions = []
    i = 0
    while i < len(lines):
        m = numbered.match(lines[i].strip())
        if not m:
            i += 1
            continue
        parts = [m.group(2)]
        j = i + 1
        while j < len(lines):
            line = lines[j].strip()
            if line.startswith("+---") or line.startswith("|---"):
                break
            if any(line.startswith(p) for p in
                   ("| To ", "| Under ", "| Yes", "| The ", "| A ", "| In ")):
                break
            if "..]()" in line or line.count("](()") > 1:
                break
            if line.startswith("|") and line.endswith("|"):
                parts.append(line.strip("| "))
                j += 1
            else:
                break
        text = collapse_ws(" ".join(parts))
        if not _is_answer_heading(text) and "esearch option" not in text:
            questions.append({"number": int(m.group(1)), "text": text,
                              "answer": "", "authorities": []})
        i = j
    if not questions:
        raise ValueError("no questions found in legacy pipe-text format")
    return {
        "file_name": path.name, "file_size": path.stat().st_size,
        "source": "westlaw", "jurisdiction": jurisdiction, "meta": {},
        "questions": questions,
    }

# ---------------------------------------------------------------- alexi shared

ALEXI_LABELS = {"memo to": "Memo To", "file": "File", "research id": "Research ID",
                "jurisdiction": "Jurisdiction",
                "province/territory": "Jurisdiction",   # 2025+ label
                "date": "Date", "regarding": "Regarding"}
ALEXI_HEADER_RE = re.compile(
    r"^(Memo To|File|Research ID|Jurisdiction|Province/Territory|Date|Regarding)"
    r":\s*(.*)$", re.IGNORECASE)
ALEXI_ANSWER_HEADINGS = ("answer", "executive summary", "conclusion")
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], 1)}


def _alexi_iso_date(raw):
    m = re.match(r"([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})", collapse_ws(raw or ""))
    if m and m.group(1) in MONTHS:
        return f"{int(m.group(3)):04d}-{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"
    return None


def _alexi_assemble(path, meta, badge, sections):
    """sections: list of (heading, [paragraph texts], [authority texts])."""
    question = answer = None
    authorities = []
    for heading, paras, auths in sections:
        h = heading.strip().lower()
        # first Issue/Question section only -- 2025+ Case Summaries reuse
        # "Issue"/"Conclusion" as per-case sub-headings further down
        if question is None and h in ("issue", "question"):
            question = clean_text(" ".join(paras))
        elif question is not None and answer is None and h in ALEXI_ANSWER_HEADINGS:
            answer = " ".join(paras)
        if "authorities" in h:
            additional = "additional" in h
            for a in auths:
                a = collapse_ws(a)
                if a:
                    authorities.append({"name": a, "detail": "",
                                        "additional": additional})
    if question is None:
        raise ValueError("no Issue section found")
    jurisdiction = collapse_ws(meta.get("Jurisdiction", "Unknown")) or "Unknown"
    return {
        "file_name": path.name, "file_size": path.stat().st_size,
        "source": "alexi", "jurisdiction": jurisdiction,
        "meta": {
            "memo_type": badge or "Alexi memo",
            "date": _alexi_iso_date(meta.get("Date")),
            "date_raw": collapse_ws(meta.get("Date", "")),
            "regarding": collapse_ws(meta.get("Regarding", "")),
            "research_id": collapse_ws(meta.get("Research ID", "")).lstrip("#"),
        },
        "questions": [{
            "number": 1, "text": question, "answer": answer or "",
            "authorities": authorities,
        }],
    }

# ---------------------------------------------------------------- alexi docx

def parse_alexi_docx(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    body = root.find(W + "body")
    if body is None:
        raise ValueError("no w:body element")
    meta, badge = {}, None
    sections = []          # (heading, paras, authorities)
    current = None
    for p in body.iter(W + "p"):
        text = p_text(p).strip()
        if not text:
            continue
        style = p_style(p)
        if style == "headerstyle":
            m = ALEXI_HEADER_RE.match(text)
            if m:
                meta[ALEXI_LABELS[m.group(1).lower()]] = m.group(2)
            continue
        if style == "badgestyle":
            badge = text
            continue
        if style == "headingstyle":
            current = (text, [], [])
            sections.append(current)
            continue
        if current is None:
            continue
        if style == "authoritiesstyle":
            current[2].append(text)
        elif style in ("paragraphstyle", "blockquotestyle"):
            current[1].append(text)
    return _alexi_assemble(path, meta, badge, sections)

# ---------------------------------------------------------------- alexi pdf

def _pdf_objects(data):
    objs = {}
    for m in re.finditer(rb"(\d+)\s+0\s+obj(.*?)endobj", data, re.DOTALL):
        objs[int(m.group(1))] = m.group(2)
    return objs


def _pdf_stream(body):
    m = re.search(rb"stream\r?\n(.*?)\r?\nendstream", body, re.DOTALL)
    if not m:
        return None
    raw = m.group(1)
    if b"/FlateDecode" in body:
        try:
            return zlib.decompress(raw)
        except zlib.error:
            return raw
    return raw


def _parse_cmap(cmap_bytes):
    text = cmap_bytes.decode("latin-1", errors="replace")
    mapping = {}
    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.DOTALL):
        for src, dst in re.findall(r"<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]+)>", block):
            mapping[int(src, 16)] = "".join(
                chr(int(dst[i:i + 4], 16)) for i in range(0, len(dst), 4))
    for block in re.findall(r"beginbfrange(.*?)endbfrange", text, re.DOTALL):
        for entry in re.finditer(
                r"<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>\s*(?:<([0-9A-Fa-f]+)>|\[(.*?)\])",
                block, re.DOTALL):
            lo, hi = int(entry.group(1), 16), int(entry.group(2), 16)
            if entry.group(4) is not None:
                dests = re.findall(r"<([0-9A-Fa-f]+)>", entry.group(4))
                for offset, dst in enumerate(dests):
                    if lo + offset <= hi:
                        mapping[lo + offset] = "".join(
                            chr(int(dst[i:i + 4], 16)) for i in range(0, len(dst), 4))
            else:
                base = int(entry.group(3), 16)
                for cid in range(lo, hi + 1):
                    mapping[cid] = chr(base + (cid - lo))
    return mapping


def _pdf_lines(path):
    """Extract (line_text, font_size) tuples from a wkhtmltopdf PDF."""
    data = path.read_bytes()
    objs = _pdf_objects(data)

    # ToUnicode CMap per Type0 font object
    cmap_of_font = {}
    for num, body in objs.items():
        if b"/Subtype /Type0" in body or b"/Subtype/Type0" in body:
            m = re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", body)
            if m and int(m.group(1)) in objs:
                stream = _pdf_stream(objs[int(m.group(1))])
                if stream:
                    cmap_of_font[num] = _parse_cmap(stream)

    # Pages: font resource name -> font object, plus content stream refs
    pages = []
    for num, body in objs.items():
        if re.search(rb"/Type\s*/Page[^s]", body):
            fonts = {name.decode(): int(ref) for name, ref in
                     re.findall(rb"/(F\d+)\s+(\d+)\s+0\s+R", body)}
            if not fonts:
                rm = re.search(rb"/Resources\s+(\d+)\s+0\s+R", body)
                if rm and int(rm.group(1)) in objs:
                    fonts = {name.decode(): int(ref) for name, ref in
                             re.findall(rb"/(F\d+)\s+(\d+)\s+0\s+R",
                                        objs[int(rm.group(1))])}
            contents = [int(x) for x in re.findall(rb"/Contents\s+(\d+)\s+0\s+R", body)]
            pages.append((num, fonts, contents))
    if not pages:
        raise ValueError("no /Page objects found")
    pages.sort(key=lambda t: t[0])

    lines = []
    for _, fonts, contents in pages:
        for ref in contents:
            stream = _pdf_stream(objs.get(ref, b""))
            if not stream:
                continue
            cur_cmap, cur_size = {}, 0.0
            ty = None
            cur_line, cur_line_size = [], 0.0
            for tok in re.finditer(
                    rb"/(F\d+)\s+([\d.]+)\s+Tf"
                    rb"|([-\d.]+)\s+([-\d.]+)\s+Td"
                    rb"|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm"
                    rb"|<([0-9A-Fa-f]+)>\s*Tj"
                    rb"|BT|ET", stream):
                if tok.group(1):
                    fnum = fonts.get(tok.group(1).decode())
                    cur_cmap = cmap_of_font.get(fnum, {})
                    cur_size = float(tok.group(2))
                elif tok.group(3) is not None:
                    new_ty = round(float(tok.group(4)), 1)
                    if new_ty != 0 and (ty is None or abs(new_ty) > 0.01):
                        # vertical move => new line
                        if cur_line:
                            lines.append(("".join(cur_line), cur_line_size))
                            cur_line, cur_line_size = [], 0.0
                        ty = new_ty
                elif tok.group(5) is not None:
                    if cur_line:
                        lines.append(("".join(cur_line), cur_line_size))
                        cur_line, cur_line_size = [], 0.0
                elif tok.group(7) is not None:
                    hexes = tok.group(7).decode()
                    for i in range(0, len(hexes) - 3, 4):
                        cid = int(hexes[i:i + 4], 16)
                        cur_line.append(cur_cmap.get(cid, "�"))
                    cur_line_size = max(cur_line_size, cur_size)
            if cur_line:
                lines.append(("".join(cur_line), cur_line_size))
    return [(t.strip(), s) for t, s in lines if t.strip()]


ALEXI_PDF_HEADINGS = {"issue", "question", "research description", "facts",
                      "answer", "executive summary", "conclusion", "law",
                      "legal principles", "discussion of law", "legislation",
                      "case summaries", "application",
                      "authorities", "cited authorities", "additional authorities"}


def parse_alexi_pdf(path):
    lines = _pdf_lines(path)
    if not lines:
        raise ValueError("no text extracted from PDF")
    meta, badge = {}, None
    sections = []
    current = None
    last_key = None  # header field awaiting wrapped continuation lines
    for text, _size in lines:
        stripped = collapse_ws(text)
        # running page furniture interleaves with body text
        if re.fullmatch(r"Alexi \| Page( \d{1,4})?", stripped) or \
                re.fullmatch(r"\d{1,4}", stripped):
            continue
        low = stripped.lower()
        if current is None:
            if stripped in ("Instant Memo", "Pro Memo"):
                badge = stripped
                last_key = None
                continue
            m = ALEXI_HEADER_RE.match(stripped)
            if m:
                key = ALEXI_LABELS[m.group(1).lower()]
                meta[key] = m.group(2)
                last_key = key
                continue
            if low in ALEXI_LABELS:  # 2025+ layout: bare label, value follows
                key = ALEXI_LABELS[low]
                meta.setdefault(key, "")
                last_key = key
                continue
            if low in ALEXI_PDF_HEADINGS:
                current = (stripped, [], [])
                sections.append(current)
                continue
            if last_key:  # wrapped continuation of the previous header value
                val = stripped[1:].strip() if stripped.startswith(":") else stripped
                meta[last_key] = collapse_ws(meta[last_key] + " " + val)
            continue
        if stripped.lower() in ALEXI_PDF_HEADINGS:
            current = (stripped, [], [])
            sections.append(current)
            continue
        if "authorities" in current[0].lower():
            current[2].append(stripped)
        else:
            current[1].append(stripped)
    # authority sections: wrapped lines -> entries. Entries end with a
    # parenthesized citation token: "(CanLII)", "(ON SC)", "(NS CA)", ...
    terminator = re.compile(r"\([^()]*\)\s*$")
    fixed = []
    for heading, paras, raw_auth in sections:
        if "authorities" in heading.lower() and raw_auth:
            entries, buf = [], []
            for line in raw_auth:
                buf.append(line)
                if terminator.search(line):
                    entries.append(" ".join(buf))
                    buf = []
            if buf:
                if entries:
                    entries.append(" ".join(buf))
                else:
                    entries = raw_auth  # no terminators at all: one entry per line
            entries = [re.sub(r"\s+,", ",", e) for e in entries]
            fixed.append((heading, paras, entries))
        else:
            fixed.append((heading, paras, raw_auth))
    memo = _alexi_assemble(path, meta, badge, fixed)
    memo["meta"]["pdf_extraction"] = True
    return memo

# ---------------------------------------------------------------- verified cross-check

def load_verified(path):
    cites = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = collapse_ws(line)
        if line and not line.startswith("#"):
            cites.append(line)
    return cites


def mark_verified(memos, citations):
    patterns = [(c, re.compile(re.escape(c) + r"(?!\d)", re.IGNORECASE))
                for c in citations]
    for memo in memos:
        for q in memo["questions"]:
            for a in q["authorities"]:
                hay = collapse_ws(f"{a['name']} {a['detail']}")
                for cite, pat in patterns:
                    if pat.search(hay):
                        a["verified"] = cite
                        break

# ---------------------------------------------------------------- output

SOURCE_LABELS = {"westlaw": "Westlaw AI-Assisted Research", "alexi": "Alexi"}

CAVEAT = (
    "> **Caveat -- read before relying on anything below.** These are "
    "AI-generated research memos. Every extracted question, answer summary, "
    "and citation is an **unverified lead**: useful for spotting candidate "
    "questions and candidate authorities, not the authority's own text, and not "
    "reliable until independently verified against the actual case, statute, "
    "or secondary authority. Authorities whose text is already on file in this "
    "matter's law database are marked ✅ Text on file; that mark does not "
    "make them verified.\n"
)


def esc(s):
    return s.replace("|", "\\|")


def auth_line(a):
    name, detail = esc(a["name"]), esc(a["detail"])
    tail = f" -- {detail}" if detail else ""
    extra = " *(additional authorities section)*" if a.get("additional") else ""
    if a.get("verified"):
        return (f"- **{name}**{tail} -- ✅ Text on file ({a['verified']}) -- "
                f"ingested in this matter's law database, not verified.{extra}")
    return f"- {name}{tail}{extra}"


def generate_index(memos, unparsed, label=None, source_folders=None):
    by_source = {}
    for m in memos:
        by_source.setdefault(m["source"], []).append(m)
    sources = [s for s in ("westlaw", "alexi") if s in by_source]
    multi = len(sources) > 1

    numbered = []          # (memo_no, memo)
    n = 0
    for s in sources:
        for m in sorted(by_source[s], key=lambda m: m["file_name"]):
            n += 1
            numbered.append((n, m))

    total_q = sum(len(m["questions"]) for _, m in numbered)

    # cross-reference duplicate questions across memos
    seen = {}
    for no, m in numbered:
        for qi, q in enumerate(m["questions"], 1):
            key = collapse_ws(q["text"]).lower()
            if key in seen:
                q["also_asked"] = seen[key]
            else:
                seen[key] = f"{no}.{qi}"

    out = []
    title = "# AI Research Memo Index" if multi or "westlaw" not in by_source \
        else "# Westlaw AI Research Memo Index"
    if len(sources) == 1 and sources[0] == "alexi":
        title = "# Alexi Research Memo Index"
    if label:
        title += f" -- {label}"
    out.append(title + "\n\n")
    out.append(f"**Generated:** {date.today().isoformat()}  \n")
    if source_folders:
        out.append(f"**Source folder:** `{source_folders}`  \n")
    counts = ", ".join(f"{SOURCE_LABELS[s]}: {len(by_source[s])}" for s in sources)
    out.append(f"**Memos processed:** {len(memos)}"
               + (f" ({counts})" if multi else "") + "  \n")
    out.append(f"**Questions indexed:** {total_q}\n\n")
    out.append(CAVEAT + "\n")

    out.append("## Summary index\n\n")
    for s in sources:
        if multi:
            out.append(f"### {SOURCE_LABELS[s]}\n\n")
        out.append("| Memo.Q | Jurisdiction | Research question | # Cited authorities | Memo file |\n")
        out.append("|---|---|---|---|---|\n")
        for no, m in numbered:
            if m["source"] != s:
                continue
            for qi, q in enumerate(m["questions"], 1):
                also = f" *(also asked in memo {q['also_asked']})*" if q.get("also_asked") else ""
                out.append(f"| {no}.{qi} | {m['jurisdiction']} | {esc(q['text'])}{also} | "
                           f"{len(q['authorities'])} | {esc(m['file_name'])} |\n")
        out.append("\n")

    out.append("## Questions and cited authorities (detail)\n\n")
    for no, m in numbered:
        out.append(f"### Memo {no} -- `{m['file_name']}`\n")
        if m["source"] == "alexi":
            mt = m["meta"].get("memo_type", "Alexi memo")
            d = m["meta"].get("date") or m["meta"].get("date_raw") or "unknown date"
            out.append(f"Source: Alexi ({mt})  \n")
            out.append(f"Memo date: {d}  \n")
            if m["meta"].get("regarding"):
                out.append(f"Regarding: {m['meta']['regarding']}  \n")
        out.append(f"Jurisdiction: {m['jurisdiction']}  \n")
        out.append(f"File size: {m['file_size'] / 1024:.1f} KB\n\n")
        for qi, q in enumerate(m["questions"], 1):
            out.append(f"**{no}.{qi}. {q['text']}**\n\n")
            if q.get("also_asked"):
                out.append(f"*Also asked in memo {q['also_asked']}.*\n\n")
            if q["answer"]:
                summary, cut = truncate_summary(q["answer"])
                out.append(f"*AI-generated summary (unverified):* {summary}"
                           + (" [...]" if cut else "") + "\n\n")
            if q["authorities"]:
                out.append("Cited authorities (leads -- unverified):\n\n")
                for a in q["authorities"]:
                    out.append(auth_line(a) + "\n")
            else:
                out.append("*(no authorities extracted"
                           + (" -- legacy text format)*" if m["source"] == "westlaw"
                              else ")*") + "\n")
            out.append("\n")

    out.append("## Most frequently cited authorities across all memos\n\n")
    out.append("Ranked by number of question-answers that cited them. High-frequency, "
               "uncited-elsewhere authorities are the best candidates for the next "
               "round of ingestion and research-agent review. Distinct decisions sharing a style "
               "of cause (e.g. a BCSC decision and its appeal) are listed "
               "separately.\n\n")
    rollup = {}
    for _, m in numbered:
        for q in m["questions"]:
            for a in q["authorities"]:
                key = (a["name"], a["detail"])
                entry = rollup.setdefault(key, {"count": 0, "verified": None})
                entry["count"] += 1
                if a.get("verified"):
                    entry["verified"] = a["verified"]
    out.append("| Times cited | Authority | Detail | Status |\n|---|---|---|---|\n")
    shown = 0
    for (name, detail), entry in sorted(
            rollup.items(), key=lambda kv: (-kv[1]["count"], kv[0][0].lower())):
        if entry["count"] < ROLLUP_MIN_CITATIONS:
            continue
        shown += 1
        status = (f"✅ Text on file ({entry['verified']})"
                  if entry["verified"] else "Unverified lead")
        out.append(f"| {entry['count']} | {esc(name)} | {esc(detail)} | {status} |\n")
    omitted = len(rollup) - shown
    if omitted > 0:
        out.append(f"\n*{len(rollup)} distinct authorities cited in total; "
                   f"{omitted} cited fewer than {ROLLUP_MIN_CITATIONS} times are "
                   f"omitted from this table (they remain listed under their "
                   f"questions above).*\n")

    if unparsed:
        out.append("\n## Files not indexed\n\n")
        out.append("Files in the source folder that were skipped or could not be "
                   "parsed. Nothing is dropped silently.\n\n")
        for name, reason in unparsed:
            out.append(f"- `{name}` -- {reason}\n")
    return "".join(out)

# ---------------------------------------------------------------- validation

def validate(memo, warnings):
    fname = memo["file_name"]
    nums = [q["number"] for q in memo["questions"]]
    if len(nums) != len(set(nums)):
        warnings.append(f"{fname}: duplicate question numbers {nums}")
    if memo["source"] == "westlaw" and not 1 <= len(nums) <= 6:
        warnings.append(f"{fname}: unusual question count {len(nums)} (expected 1-6)")
    if memo["source"] == "alexi" and len(nums) != 1:
        warnings.append(f"{fname}: Alexi memo with {len(nums)} questions (expected 1)")
    for q in memo["questions"]:
        if not q["text"] or len(q["text"]) < 10:
            warnings.append(f"{fname}: suspiciously short question text: {q['text']!r}")

# ---------------------------------------------------------------- output dir

def standard_output_dir(workspace, case_data_folder):
    """{case-data folder}/legal-memo-extractor.

    case_data_folder is the folder probanda.json's case_data_dir names, passed
    by the caller. It must be an existing directory whose name is the last
    segment of case_data_dir in the matter's pointer, probanda.json or the
    legacy coclerk.json (parsed as a Windows path, since this may run in a
    Linux sandbox). Never created here."""
    matter = Path(workspace)
    if not matter.is_dir():
        raise FileNotFoundError(f"Not an existing matter workspace: {workspace}")
    folder = Path(case_data_folder)
    if not folder.is_dir():
        raise FileNotFoundError(
            f"Case-data folder not found: {case_data_folder}. Initialize the "
            "matter with /matter-data initialize, then pass the folder that "
            "probanda.json's case_data_dir names.")
    candidates = [matter / name for name in ("probanda.json", "coclerk.json")]
    pointer = next((p for p in candidates if p.is_file()), None)
    if pointer is None:
        raise FileNotFoundError(f"probanda.json not found in {matter}. Initialize "
                                "the matter with /matter-data initialize.")
    raw = pointer.read_bytes()
    stored = json.loads(raw.replace(b"\x00", b"").decode("utf-8")).get("case_data_dir")
    if not stored:
        raise ValueError(f"{pointer} has no case_data_dir. Initialize the matter "
                         "with /matter-data initialize.")
    if folder.resolve().name.casefold() != PureWindowsPath(stored).name.casefold():
        raise ValueError(f"Case-data folder {case_data_folder} does not match "
                         f"{pointer.name}'s case_data_dir ({stored}). Pass the "
                         "folder case_data_dir names.")
    return folder / "legal-memo-extractor"


def find_matter_root(input_dir):
    for candidate in [input_dir, *input_dir.parents]:
        if any(p.is_dir() for p in candidate.glob("4*LAWYER BRIEF")):
            return candidate
    return None

# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--input-dir", required=True)
    ap.add_argument("--source", choices=["westlaw", "alexi", "auto"], default="auto")
    ap.add_argument("--matter-root", help="matter workspace whose probanda.json "
                    "names the case-data folder (derived from --input-dir if omitted)")
    ap.add_argument("--case-data-folder", help="the matter's case-data folder, as "
                    "probanda.json's case_data_dir names it; the standard output "
                    "location is its legal-memo-extractor subfolder")
    ap.add_argument("--output", help="explicit output file path (overrides the "
                    "standard output location)")
    ap.add_argument("--verified-citations", help="file with one citation string "
                    "per line (produced by delegating to the /matter-data skill); "
                    "matching authorities are marked Text on file")
    ap.add_argument("--label", help="title suffix, e.g. 'Corvo Smoke Complaints (L8145)'")
    args = ap.parse_args(argv)

    input_dir = Path(args.input_dir)
    if not input_dir.is_dir():
        ap.error(f"--input-dir not a directory: {input_dir}")

    if args.output:
        out_path = Path(args.output)
    else:
        matter = Path(args.matter_root) if args.matter_root else find_matter_root(input_dir)
        if matter is None:
            print("Cannot locate the matter root (no '4. LAWYER BRIEF' found in any "
                  "parent of --input-dir). Pass --matter-root or --output.",
                  file=sys.stderr)
            return 2
        if not args.case_data_folder:
            print("Pass --case-data-folder (the folder probanda.json's case_data_dir "
                  "names) or --output.", file=sys.stderr)
            return 2
        try:
            out_dir = standard_output_dir(matter, args.case_data_folder)
        except (FileNotFoundError, ValueError) as exc:
            print(exc, file=sys.stderr)
            return 2
        out_path = out_dir / "research_memos_index.md"

    files = sorted(p for p in input_dir.iterdir()
                   if p.is_file() and p.suffix.lower() in (".docx", ".pdf", ".doc"))
    if not files:
        print(f"No .docx/.pdf files in {input_dir}", file=sys.stderr)
        return 1

    memos, unparsed, warnings = [], [], []
    docx_stems = {p.stem for p in files if p.suffix.lower() == ".docx"}

    for path in files:
        source, container, reason = detect(path)
        if args.source != "auto" and source is not None and source != args.source:
            unparsed.append((path.name, f"detected as {source}, but --source "
                            f"{args.source} was forced"))
            continue
        if source is None:
            unparsed.append((path.name, reason))
            print(f"  SKIP  {path.name}: {reason}")
            continue
        if source == "alexi" and container == "pdf" and path.stem in docx_stems:
            unparsed.append((path.name, "skipped: .docx sibling of the same memo "
                            "was indexed instead"))
            print(f"  SKIP  {path.name}: docx sibling preferred")
            continue
        try:
            if source == "westlaw" and container in ("opc", "opc-standard"):
                memo = parse_westlaw_opc(path)
            elif source == "westlaw" and container == "text":
                memo = parse_westlaw_text(path)
            elif source == "alexi" and container == "docx":
                memo = parse_alexi_docx(path)
            elif source == "alexi" and container == "pdf":
                memo = parse_alexi_pdf(path)
            else:
                raise ValueError(f"no parser for {source}/{container}")
        except Exception as exc:
            unparsed.append((path.name, f"parse error ({container}): {exc}"))
            print(f"  ERROR {path.name}: {exc}")
            continue
        validate(memo, warnings)
        memos.append(memo)
        qn = len(memo["questions"])
        print(f"  OK    {path.name}: {memo['source']}/{container}, "
              f"{qn} question{'s' if qn != 1 else ''}, "
              f"{sum(len(q['authorities']) for q in memo['questions'])} authorities")

    # same Research ID exported twice (e.g. an Instant Memo later upgraded to a
    # Pro Memo, or email-export " - N" duplicates): keep the best copy
    def rank(m):
        return (m["meta"].get("memo_type") == "Pro Memo",
                m["file_name"].lower().endswith(".docx"))
    by_rid = {}
    for memo in memos:
        rid = memo.get("meta", {}).get("research_id")
        key = rid or id(memo)
        if key not in by_rid or rank(memo) > rank(by_rid[key]):
            if key in by_rid:
                loser = by_rid[key]
                unparsed.append((loser["file_name"],
                                 f"superseded by {memo['file_name']} "
                                 f"(same Research ID {rid}, Pro Memo/docx preferred)"))
                print(f"  SKIP  {loser['file_name']}: superseded by {memo['file_name']}")
            by_rid[key] = memo
        else:
            unparsed.append((memo["file_name"],
                             f"duplicate of {by_rid[key]['file_name']} "
                             f"(same Research ID {rid})"))
            print(f"  SKIP  {memo['file_name']}: duplicate Research ID")
    memos = [m for m in memos if any(m is v for v in by_rid.values())]

    if not memos:
        print("No memos parsed.", file=sys.stderr)
        return 2

    if args.verified_citations:
        mark_verified(memos, load_verified(args.verified_citations))

    content = generate_index(memos, unparsed, label=args.label,
                             source_folders=input_dir.name)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding="utf-8")

    total_q = sum(len(m["questions"]) for m in memos)
    print(f"\nIndexed {len(memos)} memos / {total_q} questions -> {out_path}")
    if warnings:
        print("\nValidation warnings:")
        for w in warnings:
            print(f"  WARN  {w}")
    if unparsed:
        print(f"\n{len(unparsed)} file(s) not indexed (listed in the index and above).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
