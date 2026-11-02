#!/usr/bin/env python3
"""Provider-neutral core of the deduping-email setup scripts.

A setup script (references/scripts/<setup-id>.py) supplies a way to connect to one
kind of mailbox and calls main() here. Everything else is here, so every setup
behaves the same way: the tier 1 and tier 2 rules, the modes, the JSON report, the
comparison file, the fail-closed move loop and the folder-name quoting.

Contract: references/script-contract.md. Standard library only; `keyring` is used
for credentials when it is installed.

Modes (see the contract):
  <setup>.py FOLDER [FOLDER ...] | --all          tier 1 dry run + tier 2 comparison file
  <setup>.py FOLDER ... --apply                   carry out the tier 1 moves
  <setup>.py --move-uids MOVES.json               carry out approved tier 2 moves

Helper (no network):
  python dedupe_core.py moves-from-verdicts --comparison C.json --verdicts V.json [--groups g1,g2]
      prints the --move-uids file for the approved groups, taking each UID's
      UIDVALIDITY and SHA-256 from the comparison file, never from the verdicts.

Nothing here ever issues EXPUNGE or CLOSE, or empties the trash. A "delete" is an
IMAP MOVE to the folder the server flags \\Trash, and nothing else: a server without
MOVE fails the run before anything is touched.
"""
import argparse
import base64
import datetime as _dt
import difflib
import email
import email.policy
import hashlib
import html
import json
import os
import re
import sys
import unicodedata
import urllib.parse

CORE_VERSION = 2
FETCH_CHUNK = 100
DIFF_CAP = 4000
HEADER_VALUE_CAP = 300
# The headers the sender wrote; a difference in any of them is the sender's content.
SENDER_HEADERS = ("from", "to", "cc", "subject", "date")
# Headers every copy has with its own value and that say nothing about content.
TRANSPORT_HEADERS = ("received", "x-received", "delivered-to", "return-path", "arc-seal",
                     "arc-message-signature", "arc-authentication-results",
                     "authentication-results", "dkim-signature", "x-apple-uuid")
TRASH_FALLBACK_NAMES = ("Deleted Messages", "Deleted Items", "Trash", "[Gmail]/Trash", "INBOX.Trash")
SKIP_FOLDER_FLAGS = ("\\trash", "\\noselect", "\\nonexistent", "\\all")

TIER1_RULE = ("identical: SHA-256 of the full raw message equal; keep the highest UID in the folder "
              "(with --across-folders, the highest UID in the first listed folder that holds a copy); "
              "move the others to the trash folder")
TIER2_RULE = ("duplicative: same Message-ID, different bytes; never moved by the script; listed in the "
              "comparison file for judgment, and moved only through --move-uids after approval")


class DedupeError(Exception):
    """A failure that stops the run. The report says what was already moved."""


# --- folder names -----------------------------------------------------------------------

def encode_mutf7(name):
    """Encode a folder name in IMAP modified UTF-7 (RFC 3501 section 5.1.3)."""
    out, run = [], []

    def flush():
        if run:
            b = base64.b64encode("".join(run).encode("utf-16-be")).decode("ascii")
            out.append("&" + b.rstrip("=").replace("/", ",") + "-")
            run.clear()

    for ch in name:
        if 0x20 <= ord(ch) <= 0x7E:
            flush()
            out.append("&-" if ch == "&" else ch)
        else:
            run.append(ch)
    flush()
    return "".join(out)


def decode_mutf7(name):
    """Decode an IMAP modified UTF-7 folder name."""
    out, i = [], 0
    while i < len(name):
        ch = name[i]
        if ch != "&":
            out.append(ch)
            i += 1
            continue
        j = name.find("-", i)
        if j < 0:
            raise DedupeError(f"malformed modified UTF-7 folder name: {name!r}")
        chunk = name[i + 1:j]
        if not chunk:
            out.append("&")
        else:
            b64 = chunk.replace(",", "/")
            b64 += "=" * (-len(b64) % 4)
            out.append(base64.b64decode(b64).decode("utf-16-be"))
        i = j + 1
    return "".join(out)


def quote_mailbox(name):
    """The folder name as one IMAP quoted string, modified UTF-7 encoded.
    Spaces, slashes, parentheses and dots stay literal inside the quotes; a
    backslash or double quote is escaped."""
    enc = encode_mutf7(name)
    return '"' + enc.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _unquote(token):
    token = token.strip()
    if len(token) >= 2 and token[0] == '"' and token[-1] == '"':
        return re.sub(r"\\(.)", r"\1", token[1:-1])
    return token


_LIST_LINE = re.compile(r'^\((?P<flags>[^)]*)\)\s+(?P<delim>"(?:[^"\\]|\\.)*"|NIL)\s+(?P<name>.*)$', re.S)


def parse_list_response(data):
    """[{name, flags, delimiter}] from imaplib's LIST data (lines or literal tuples)."""
    folders = []
    for item in data:
        if item is None:
            continue
        if isinstance(item, tuple):
            head, literal = item[0], item[1]
            line = head.decode("ascii", "replace")
            m = _LIST_LINE.match(re.sub(r"\{\d+\}$", "", line).strip() + ' ""')
            if not m:
                raise DedupeError(f"unreadable LIST line: {line!r}")
            name = literal.decode("utf-8", "replace")
        else:
            line = item.decode("ascii", "replace") if isinstance(item, bytes) else str(item)
            m = _LIST_LINE.match(line)
            if not m:
                raise DedupeError(f"unreadable LIST line: {line!r}")
            name = _unquote(m.group("name"))
        delim = m.group("delim")
        folders.append({
            "name": decode_mutf7(name),
            "flags": [f.lower() for f in m.group("flags").split()],
            "delimiter": None if delim == "NIL" else _unquote(delim),
        })
    return folders


# --- message analysis -----------------------------------------------------------------------

def sha256(data):
    return hashlib.sha256(data).hexdigest()


def header_meta(raw):
    """(Message-ID, Date) from the raw header block, without parsing the body."""
    head = raw.split(b"\r\n\r\n", 1)[0] if b"\r\n\r\n" in raw else raw.split(b"\n\n", 1)[0]
    msg = email.message_from_bytes(head + b"\r\n\r\n", policy=email.policy.compat32)
    mid = msg.get("Message-ID")
    mid = " ".join(str(mid).split()) if mid else None
    date = msg.get("Date")
    return mid or None, (" ".join(str(date).split()) if date else None)


def _part_text(part):
    try:
        return part.get_content()
    except Exception:  # undecodable charset or broken transfer encoding
        payload = part.get_payload(decode=True) or b""
        return payload.decode("utf-8", "replace")


def _strip_html(text):
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", text)
    return html.unescape(re.sub(r"<[^>]+>", " ", text))


def _is_inline_image(part):
    """An image leaf the HTML shows in the body: it has a Content-ID or an inline disposition."""
    if part.is_multipart() or part.get_content_maintype() != "image":
        return False
    disp = (part.get_content_disposition() or "").lower()
    if disp == "attachment":
        return False
    return bool(part.get("Content-ID")) or disp == "inline"


def _is_attachment(part):
    if part.is_multipart() or _is_inline_image(part):
        return False
    disp = (part.get_content_disposition() or "").lower()
    if disp == "attachment" or part.get_filename():
        return True
    # A non-text leaf (an application/* part, an image with no place in the body) is content the
    # body text lacks.
    return part.get_content_maintype() != "text"


# --- links and images -----------------------------------------------------------------------

_HREF = re.compile(r"""(?is)<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
_IMG_SRC = re.compile(r"""(?is)<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
_PLAIN_URL = re.compile(r"""(?i)\bhttps?://[^\s<>"'\)\]]+""")
_TRAILING_PUNCT = ".,;:!?'\""


def _first_group(m):
    return html.unescape(next(g for g in m.groups() if g is not None)).strip()


def _host(url):
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def _decode_urldefense_v3(rest):
    """Proofpoint v3: https://urldefense.com/v3/__<url>__;<base64 of replaced chars>!!<sig>$"""
    m = re.match(r"__(.*?)__;([A-Za-z0-9+/=_-]*)!!", rest, re.S)
    if not m:
        m = re.match(r"__(.*?)__", rest, re.S)
        if not m:
            return None
        return m.group(1)
    url, enc = m.group(1), m.group(2)
    if "*" not in url:
        return url
    try:
        enc = enc.replace("-", "+").replace("_", "/")
        chars = base64.b64decode(enc + "=" * (-len(enc) % 4)).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    out, k, i = [], 0, 0
    while i < len(url):
        if url[i] == "*":
            n = 2 if url[i:i + 2] == "**" else 1
            # "**A" style runs encode several characters; a single "*" is one character.
            if n == 2 and i + 2 < len(url):
                count = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".find(url[i + 2]) + 2
                out.append(chars[k:k + count])
                k += count
                i += 3
                continue
            out.append(chars[k:k + 1])
            k += 1
            i += 1
            continue
        out.append(url[i])
        i += 1
    return "".join(out)


def decode_rewritten_link(url):
    """(original destination, rewriter) for a link a mail filter rewrote after delivery.
    Microsoft Safe Links and Proofpoint URL Defense (v2 and v3) are decoded; anything else is
    returned as found with rewriter None."""
    host = _host(url)
    try:
        if host.endswith("safelinks.protection.outlook.com"):
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            if q.get("url"):
                return q["url"][0], "safelinks"
        elif host == "urldefense.com" and "/v3/" in url:
            orig = _decode_urldefense_v3(url.split("/v3/", 1)[1])
            if orig:
                return orig, "urldefense"
        elif host == "urldefense.proofpoint.com" and "/v2/url" in url:
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            if q.get("u"):
                enc = q["u"][0].replace("_", "/")
                enc = re.sub(r"-([0-9A-Fa-f]{2})", r"%\1", enc)
                return urllib.parse.unquote(enc), "urldefense"
    except ValueError:
        pass
    return url, None


def _link_record(url):
    original, by = decode_rewritten_link(url)
    return {"url": url, "original": original, "rewritten_by": by}


def _links(htmls_raw, plains):
    found = set()
    for h in htmls_raw:
        for m in _HREF.finditer(h):
            u = _first_group(m)
            if u.lower().startswith(("http://", "https://")):
                found.add(u)
    for t in plains:
        for m in _PLAIN_URL.finditer(t):
            found.add(m.group(0).rstrip(_TRAILING_PUNCT))
    return sorted((_link_record(u) for u in found), key=lambda r: (r["original"], r["url"]))


def _image_refs(htmls_raw):
    refs = set()
    for h in htmls_raw:
        for m in _IMG_SRC.finditer(h):
            src = _first_group(m)
            if src.lower().startswith(("cid:", "http://", "https://")):
                refs.add(src)
    return sorted(refs)


def _cid(value):
    return urllib.parse.unquote(value.strip().strip("<>").strip()).lower()


def analyse(raw):
    """Decoded text body, normalized-body hash, attachments, inline images, links, image
    references and headers of one message, from one walk of its parts."""
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    plain, htmls, htmls_raw, attachments, images = [], [], [], [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        if _is_inline_image(part):
            payload = part.get_payload(decode=True) or b""
            cid = part.get("Content-ID")
            images.append({"content_id": " ".join(str(cid).split()) if cid else None,
                           "filename": part.get_filename(), "size": len(payload),
                           "sha256": sha256(payload)})
        elif _is_attachment(part):
            payload = part.get_payload(decode=True) or b""
            attachments.append({"filename": part.get_filename() or f"(unnamed {part.get_content_type()})",
                                "size": len(payload), "sha256": sha256(payload)})
        elif part.get_content_type() == "text/plain":
            plain.append(_part_text(part))
        elif part.get_content_type() == "text/html":
            h = _part_text(part)
            htmls_raw.append(h)
            htmls.append(_strip_html(h))
    text = "\n".join(plain) if plain else "\n".join(htmls)
    norm = normalize_text(text)
    headers = [(k.lower(), " ".join(str(v).split())) for k, v in msg.items()]
    image_refs = _image_refs(htmls_raw)
    have = {_cid(i["content_id"]) for i in images if i["content_id"]}
    missing = sorted(r for r in image_refs if r.lower().startswith("cid:") and _cid(r[4:]) not in have)
    sender = {}
    for name in SENDER_HEADERS:
        vals = sorted(v[:HEADER_VALUE_CAP] for k, v in headers if k == name)
        sender[name] = vals[0] if len(vals) == 1 else (vals or None)
    return {"text": text, "normalized": norm, "body_sha256": sha256(norm.encode("utf-8")),
            "attachments": attachments, "images": images, "links": _links(htmls_raw, plain),
            "image_refs": image_refs, "missing_inline_images": missing,
            "sender_headers": sender, "headers": headers}


def normalize_text(text):
    text = unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))
    lines = [ln.rstrip() for ln in text.split("\n")]
    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def differing_headers(analyses):
    """{header: [values per copy]} for each header whose values differ between copies."""
    names = []
    for a in analyses:
        for k, _ in a["headers"]:
            if k not in names:
                names.append(k)
    out = {}
    for name in names:
        per_copy = [sorted(v[:HEADER_VALUE_CAP] for k, v in a["headers"] if k == name) for a in analyses]
        if any(pc != per_copy[0] for pc in per_copy):
            out[name] = [pc if pc else None for pc in per_copy]
    return out


def capped_diff(a, b, label_a, label_b):
    diff = "".join(difflib.unified_diff((a + "\n").splitlines(True), (b + "\n").splitlines(True),
                                        label_a, label_b, n=2))
    truncated = len(diff) > DIFF_CAP
    return (diff[:DIFF_CAP] + ("\n... [diff truncated]" if truncated else "")), truncated


def pair_hints(i, j, ai, aj):
    """Mechanical facts about copies i and j, to save the judge work. Not a verdict."""
    ha = {(x["sha256"]) for x in ai["attachments"]}
    hb = {(x["sha256"]) for x in aj["attachments"]}
    la = {x["original"] for x in ai["links"]}
    lb = {x["original"] for x in aj["links"]}
    ia = {x["sha256"] for x in ai["images"]}
    ib = {x["sha256"] for x in aj["images"]}
    return {
        "copies": [i, j],
        "body_equal": ai["normalized"] == aj["normalized"],
        "body_i_within_j": bool(ai["normalized"]) and ai["normalized"] in aj["normalized"],
        "body_j_within_i": bool(aj["normalized"]) and aj["normalized"] in ai["normalized"],
        "attachments_equal": ha == hb,
        "attachments_i_subset_of_j": ha <= hb,
        "attachments_j_subset_of_i": hb <= ha,
        "links_equal": la == lb,
        "links_i_subset_of_j": la <= lb,
        "links_j_subset_of_i": lb <= la,
        "rewritten_links_i": sum(1 for x in ai["links"] if x["rewritten_by"]),
        "rewritten_links_j": sum(1 for x in aj["links"] if x["rewritten_by"]),
        "images_equal": ia == ib,
        "images_i_subset_of_j": ia <= ib,
        "images_j_subset_of_i": ib <= ia,
        "sender_headers_equal": ai["sender_headers"] == aj["sender_headers"],
    }


# --- planning (pure) ------------------------------------------------------------------------

def _folder_rank(order):
    return {name: n for n, name in enumerate(order)}


def plan_tier1(scans, folder_order, across_folders):
    """Tier 1 groups. `scans` is {folder: {"uidvalidity", "messages": [meta]}}, each meta a dict
    with uid, sha256, size. Returns [{"sha256", "keep", "remove"}], each copy {folder, uid,
    uidvalidity, sha256, size}."""
    rank = _folder_rank(folder_order)
    buckets = {}
    for folder in folder_order:
        scan = scans[folder]
        for m in scan["messages"]:
            key = (m["sha256"],) if across_folders else (folder, m["sha256"])
            buckets.setdefault(key, []).append(_copy(folder, scan["uidvalidity"], m))
    groups = []
    for key, copies in buckets.items():
        if len(copies) < 2:
            continue
        copies.sort(key=lambda c: (rank[c["folder"]], -c["uid"]))
        groups.append({"sha256": copies[0]["sha256"], "keep": copies[0], "remove": copies[1:]})
    groups.sort(key=lambda g: (rank[g["keep"]["folder"]], g["keep"]["uid"]))
    return groups


def _copy(folder, uidvalidity, m):
    return {"folder": folder, "uid": m["uid"], "uidvalidity": uidvalidity, "sha256": m["sha256"],
            "size": m.get("size"), "date": m.get("date"), "internaldate": m.get("internaldate"),
            "message_id": m.get("message_id")}


def plan_tier2_groups(scans, folder_order, across_folders, removed):
    """Message-ID groups among the tier 1 survivors. `removed` is a set of (folder, uid)."""
    rank = _folder_rank(folder_order)
    buckets, no_id = {}, 0
    for folder in folder_order:
        scan = scans[folder]
        for m in scan["messages"]:
            if (folder, m["uid"]) in removed:
                continue
            if not m.get("message_id"):
                no_id += 1
                continue
            key = (m["message_id"],) if across_folders else (folder, m["message_id"])
            buckets.setdefault(key, []).append(_copy(folder, scan["uidvalidity"], m))
    groups = []
    for copies in buckets.values():
        if len(copies) < 2:
            continue
        copies.sort(key=lambda c: (rank[c["folder"]], -c["uid"]))
        groups.append(copies)
    groups.sort(key=lambda cs: (rank[cs[0]["folder"]], cs[0]["uid"]))
    return groups, no_id


def build_comparison(groups, raws):
    """The comparison file's groups. `raws` maps (folder, uid) to raw bytes."""
    out = []
    for n, copies in enumerate(groups, 1):
        analyses = []
        for c in copies:
            raw = raws[(c["folder"], c["uid"])]
            if sha256(raw) != c["sha256"]:
                raise DedupeError(f"message {c['folder']} UID {c['uid']} changed during the run")
            analyses.append(analyse(raw))
        diffs = []
        for i in range(1, len(copies)):
            d, trunc = capped_diff(analyses[0]["normalized"], analyses[i]["normalized"],
                                   f"copy 0 ({copies[0]['folder']} UID {copies[0]['uid']})",
                                   f"copy {i} ({copies[i]['folder']} UID {copies[i]['uid']})")
            diffs.append({"from": 0, "to": i, "diff": d, "truncated": trunc})
        hints = [pair_hints(i, j, analyses[i], analyses[j])
                 for i in range(len(copies)) for j in range(i + 1, len(copies))]
        dh = differing_headers(analyses)
        sender_diff = [h for h in SENDER_HEADERS
                       if any(a["sender_headers"][h] != analyses[0]["sender_headers"][h] for a in analyses)]
        out.append({
            "group_id": f"g{n}",
            "message_id": copies[0]["message_id"],
            "copies": [{
                "index": i,
                "folder": c["folder"], "uid": c["uid"], "uidvalidity": c["uidvalidity"],
                "sha256": c["sha256"], "date": c["date"], "internaldate": c["internaldate"],
                "size": c["size"], "body_sha256": a["body_sha256"], "body_chars": len(a["normalized"]),
                "attachments": a["attachments"],
                "images": a["images"],
                "image_refs": a["image_refs"],
                "missing_inline_images": a["missing_inline_images"],
                "links": a["links"],
                "sender_headers": a["sender_headers"],
                "differing_headers": {h: vals[i] for h, vals in dh.items()
                                      if h not in TRANSPORT_HEADERS},
                "differing_transport_headers": sorted(h for h in dh if h in TRANSPORT_HEADERS),
            } for i, (c, a) in enumerate(zip(copies, analyses))],
            "sender_header_differences": sender_diff,
            "body_diffs": diffs,
            "hints": hints,
        })
    return out


def moves_from_verdicts(comparison, verdicts, approved_groups=None):
    """The --move-uids file for approved groups. Each move's UIDVALIDITY and SHA-256 come from
    the comparison file. Refuses a UID not in its group and a group with no copy kept."""
    by_id = {g["group_id"]: g for g in comparison["groups"]}
    moves = []
    for v in verdicts["groups"]:
        gid = v["group_id"]
        if approved_groups is not None and gid not in approved_groups:
            continue
        if v.get("decision") != "remove" or not v.get("remove"):
            continue
        if gid not in by_id:
            raise DedupeError(f"verdict names unknown group {gid}")
        copies = {(c["folder"], c["uid"]): c for c in by_id[gid]["copies"]}
        remove = {(r["folder"], int(r["uid"])) for r in v["remove"]}
        unknown = remove - set(copies)
        if unknown:
            raise DedupeError(f"group {gid}: verdict removes a copy not in the group: {sorted(unknown)}")
        if remove >= set(copies):
            raise DedupeError(f"group {gid}: verdict removes every copy; one must be kept")
        keep = {(k["folder"], int(k["uid"])) for k in v.get("keep", [])}
        if keep & remove:
            raise DedupeError(f"group {gid}: a copy is both kept and removed")
        for key in sorted(remove, key=lambda k: (k[0], k[1])):
            c = copies[key]
            moves.append({"group_id": gid, "folder": c["folder"], "uid": c["uid"],
                          "uidvalidity": c["uidvalidity"], "sha256": c["sha256"]})
    return {"moves": moves}


# --- IMAP adapter ---------------------------------------------------------------------------

_FETCH_UID = re.compile(rb"\bUID\s+(\d+)")
_FETCH_SIZE = re.compile(rb"\bRFC822\.SIZE\s+(\d+)")
_FETCH_DATE = re.compile(rb'\bINTERNALDATE\s+"([^"]*)"')
_FETCH_FLAGS = re.compile(rb"\bFLAGS\s+\(([^)]*)\)")


def parse_fetch(data):
    """[{uid, size, internaldate, flags, raw}] from imaplib FETCH data."""
    out, i = [], 0
    while i < len(data):
        item = data[i]
        if isinstance(item, tuple):
            meta, raw = item[0], item[1]
            if i + 1 < len(data) and isinstance(data[i + 1], bytes):
                meta += b" " + data[i + 1]  # items the server sent after the literal
                i += 1
            uid = _FETCH_UID.search(meta)
            if not uid:
                raise DedupeError("FETCH response without a UID")
            size = _FETCH_SIZE.search(meta)
            date = _FETCH_DATE.search(meta)
            flags = _FETCH_FLAGS.search(meta)
            out.append({"uid": int(uid.group(1)), "size": int(size.group(1)) if size else len(raw),
                        "internaldate": date.group(1).decode("ascii", "replace") if date else None,
                        "flags": flags.group(1).decode("ascii", "replace").lower().split() if flags else [],
                        "raw": raw})
        i += 1
    return out


def _uid_set(uids):
    return ",".join(str(u) for u in uids)


class ImapMailbox:
    """A mailbox reached over IMAP. Read-only (EXAMINE) unless a move needs SELECT.
    Never sends EXPUNGE or CLOSE."""

    def __init__(self, conn, trash_fallbacks=TRASH_FALLBACK_NAMES):
        self.conn = conn
        self.trash_fallbacks = trash_fallbacks
        self._selected = None  # (folder, readonly)
        self._trash = None

    # helpers
    def _ok(self, resp, what):
        typ, data = resp
        if typ != "OK":
            raise DedupeError(f"{what} failed: {typ} {data!r}")
        return data

    def _open(self, folder, readonly):
        if self._selected == (folder, readonly):
            return self._uidvalidity
        self._ok(self.conn.select(quote_mailbox(folder), readonly=readonly),
                 ("EXAMINE " if readonly else "SELECT ") + folder)
        self._selected = (folder, readonly)
        uv = self.conn.response("UIDVALIDITY")[1]
        uv = [x for x in (uv or []) if x]
        if not uv:
            data = self._ok(self.conn.status(quote_mailbox(folder), "(UIDVALIDITY)"), "STATUS " + folder)
            m = re.search(rb"UIDVALIDITY\s+(\d+)", data[0] if data else b"")
            if not m:
                raise DedupeError(f"no UIDVALIDITY for {folder}")
            self._uidvalidity = int(m.group(1))
        else:
            self._uidvalidity = int(uv[-1])
        return self._uidvalidity

    # interface
    def list_folders(self):
        return parse_list_response(self._ok(self.conn.list('""', '"*"'), "LIST"))

    def trash_folder(self):
        if self._trash:
            return self._trash
        folders = self.list_folders()
        flagged = [f["name"] for f in folders if "\\trash" in f["flags"]]
        if flagged:
            self._trash = flagged[0]
        else:
            names = {f["name"]: f for f in folders}
            for cand in self.trash_fallbacks:
                if cand in names:
                    self._trash = cand
                    break
        if not self._trash:
            raise DedupeError("no trash folder found (no \\Trash flag and no known trash name)")
        return self._trash

    def scan(self, folder):
        """{"uidvalidity", "messages": [{uid, sha256, size, internaldate, message_id, date}]},
        skipping messages already flagged \\Deleted. Read-only."""
        uv = self._open(folder, readonly=True)
        data = self._ok(self.conn.uid("SEARCH", None, "ALL"), "SEARCH " + folder)
        uids = [int(x) for x in (data[0] or b"").split()]
        messages = []
        for k in range(0, len(uids), FETCH_CHUNK):
            chunk = uids[k:k + FETCH_CHUNK]
            data = self._ok(self.conn.uid("FETCH", _uid_set(chunk),
                                          "(UID FLAGS RFC822.SIZE INTERNALDATE BODY.PEEK[])"),
                            "FETCH " + folder)
            for f in parse_fetch(data):
                if "\\deleted" in f["flags"]:
                    continue
                mid, date = header_meta(f["raw"])
                messages.append({"uid": f["uid"], "sha256": sha256(f["raw"]), "size": f["size"],
                                 "internaldate": f["internaldate"], "message_id": mid, "date": date})
        messages.sort(key=lambda m: m["uid"])
        return {"uidvalidity": uv, "messages": messages}

    def fetch_raw(self, folder, uids, expected_uidvalidity):
        """{uid: raw bytes}. Read-only unless the folder is already open read-write."""
        readonly = not (self._selected and self._selected[0] == folder and not self._selected[1])
        uv = self._open(folder, readonly=readonly)
        if uv != expected_uidvalidity:
            raise DedupeError(f"{folder}: UIDVALIDITY changed ({expected_uidvalidity} -> {uv}); rescan")
        out = {}
        for k in range(0, len(uids), FETCH_CHUNK):
            chunk = uids[k:k + FETCH_CHUNK]
            data = self._ok(self.conn.uid("FETCH", _uid_set(chunk), "(UID BODY.PEEK[])"), "FETCH " + folder)
            for f in parse_fetch(data):
                out[f["uid"]] = f["raw"]
        return out

    def move_to_trash(self, folder, uid, expected_uidvalidity):
        """Move one message to the trash folder. Opens the folder read-write."""
        trash = self.trash_folder()
        if folder == trash:
            raise DedupeError("refusing to move a message out of the trash folder")
        uv = self._open(folder, readonly=False)
        if uv != expected_uidvalidity:
            raise DedupeError(f"{folder}: UIDVALIDITY changed ({expected_uidvalidity} -> {uv}); rescan")
        caps = {c.upper() if isinstance(c, str) else c.decode().upper()
                for c in getattr(self.conn, "capabilities", ())}
        if "MOVE" not in caps:
            # Without RFC 6851 MOVE the only way out of a folder is COPY plus a \Deleted flag,
            # which a mail program may later expunge. Refuse: a delete here is a move only.
            raise DedupeError("the server does not offer IMAP MOVE; nothing can be moved safely")
        self._ok(self.conn.uid("MOVE", str(uid), quote_mailbox(trash)), f"MOVE {folder} UID {uid}")
        return "move"

    def logout(self):
        try:
            self.conn.logout()
        except Exception:
            pass


# --- credentials ----------------------------------------------------------------------------

PROBANDA_MAIL_STORE = os.path.join("Coclerk", "mail", "mail.json.dpapi")


def _dpapi_unprotect(data):
    """Windows DPAPI (current user) decryption through crypt32, standard library only."""
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = Blob()
    if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0,
                                                    ctypes.byref(blob_out)):
        raise DedupeError("the stored Probanda mail sign-in could not be unlocked for this Windows user")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


def probanda_mail_credential(expected_host):
    """(host, port, user, password) from the mail sign-in Probanda's own mail tools saved on this
    Windows computer, or None when there is none or it is for another server. Read only."""
    if os.name != "nt":
        return None
    root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if not root:
        return None
    path = os.path.join(root, PROBANDA_MAIL_STORE)
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as fh:
        stored = json.loads(_dpapi_unprotect(fh.read()).decode("utf-8"))
    if str(stored.get("host", "")).lower() != expected_host.lower():
        return None
    if not (stored.get("username") and stored.get("password")):
        return None
    return stored["host"], int(stored.get("port") or 993), stored["username"], stored["password"]


def resolve_credentials(setup_id, default_host, default_port=993):
    """(host, port, user, password), first found of: MAIL_USER and MAIL_PASSWORD (with MAIL_HOST,
    MAIL_PORT); the mail sign-in Probanda already stores on this Windows computer, when it is for
    the same server; the OS keyring (service "deduping-email/<setup-id>": the user name under the
    key "MAIL_USER", the password under the user name). Never printed, never written."""
    host = os.environ.get("MAIL_HOST") or default_host
    port = int(os.environ.get("MAIL_PORT") or default_port)
    user = os.environ.get("MAIL_USER")
    password = os.environ.get("MAIL_PASSWORD")
    if user and password:
        return host, port, user, password
    if not (user or password):
        stored = probanda_mail_credential(host)
        if stored:
            return stored
    try:
        import keyring  # optional
    except ImportError:
        keyring = None
    if keyring is not None:
        service = f"deduping-email/{setup_id}"
        user = user or keyring.get_password(service, "MAIL_USER")
        if user and not password:
            password = keyring.get_password(service, user)
    if not (host and user and password):
        raise DedupeError("no credentials: no Probanda mail sign-in for this server on this computer; "
                          "set MAIL_USER and MAIL_PASSWORD in the environment, or store them in the "
                          f"keyring under 'deduping-email/{setup_id}'")
    return host, port, user, password


def redact(text, secrets):
    for s in secrets:
        if s:
            text = text.replace(s, "[redacted]")
    return text


# --- the run --------------------------------------------------------------------------------

HOME_DIR = os.path.join("~", ".probanda", "deduping-email")


def default_out_dir():
    """$DEDUPE_OUT_DIR, else ~/.probanda/deduping-email/runs/<time>: a folder this tool creates on
    the user's own computer. The comparison file holds message text, so it never leaves it."""
    base = os.environ.get("DEDUPE_OUT_DIR")
    if base:
        os.makedirs(base, exist_ok=True)
        return base
    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(os.path.expanduser(HOME_DIR), "runs", stamp)
    os.makedirs(path, exist_ok=True)
    return path


def build_parser(setup_id):
    p = argparse.ArgumentParser(prog=f"{setup_id}.py", description="Remove duplicate emails (deduping-email).")
    p.add_argument("folders", nargs="*", help="folder names, exactly as the mail program shows them")
    p.add_argument("--all", action="store_true", help="every selectable folder except the trash")
    p.add_argument("--across-folders", action="store_true",
                   help="treat the listed folders as one set; keep the copy in the first folder listed")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="carry out the tier 1 moves")
    mode.add_argument("--move-uids", metavar="FILE", help="carry out the approved tier 2 moves in FILE")
    p.add_argument("--out-dir", help="where the report and comparison file are written")
    return p


def _resolve_folders(mb, args):
    folders = mb.list_folders()
    names = [f["name"] for f in folders]
    trash = mb.trash_folder()
    if args.all:
        chosen = [f["name"] for f in folders
                  if f["name"] != trash and not any(fl in f["flags"] for fl in SKIP_FOLDER_FLAGS)]
        skipped = [f["name"] for f in folders if f["name"] not in chosen]
        return chosen, skipped
    missing = [f for f in args.folders if f not in names]
    if missing:
        raise DedupeError(f"no such folder: {missing}")
    if trash in args.folders:
        raise DedupeError("the trash folder cannot be deduplicated")
    seen, chosen = set(), []
    for f in args.folders:
        if f not in seen:
            seen.add(f)
            chosen.append(f)
    return chosen, []


def run(setup_id, connect, argv=None, out=sys.stdout):
    """Run one mode. `connect()` returns a mailbox (ImapMailbox or the same interface) and may
    raise DedupeError. Prints the JSON report and returns the exit code (0 ok, 2 error)."""
    args = build_parser(setup_id).parse_args(argv)
    if not args.move_uids and not args.all and not args.folders:
        build_parser(setup_id).error("name one or more folders, or --all")
    if args.all and args.folders:
        build_parser(setup_id).error("--all takes no folder names")
    mode = "move-uids" if args.move_uids else ("apply" if args.apply else "scan")
    report = {"setup": setup_id, "core_version": CORE_VERSION, "mode": mode, "status": "ok",
              "dry_run": mode == "scan", "expunged": False, "moved": [], "errors": []}
    secrets = [os.environ.get("MAIL_PASSWORD")]
    mb = None
    try:
        out_dir = args.out_dir or default_out_dir()
        report["out_dir"] = out_dir
        mb = connect()
        secrets += list(getattr(mb, "secrets", ()))
        report["trash_folder"] = mb.trash_folder()
        if mode == "move-uids":
            _run_move_uids(mb, args.move_uids, report)
        else:
            _run_scan(mb, args, mode, out_dir, report)
    except Exception as e:  # fail closed: stop, say what was already moved
        report["status"] = "error"
        report["errors"].append(redact(f"{type(e).__name__}: {e}", secrets))
    finally:
        if mb is not None:
            mb.logout()
    report["moved_count"] = len(report["moved"])
    text = json.dumps(report, indent=2, ensure_ascii=False)
    if report.get("out_dir") and os.path.isdir(report["out_dir"]):
        with open(os.path.join(report["out_dir"], f"report-{mode}.json"), "w", encoding="utf-8") as f:
            f.write(text)
    out.write(text + "\n")
    return 0 if report["status"] == "ok" else 2


def _run_scan(mb, args, mode, out_dir, report):
    folders, skipped = _resolve_folders(mb, args)
    report["across_folders"] = bool(args.across_folders)
    report["folders_skipped"] = skipped
    scans = {f: mb.scan(f) for f in folders}
    tier1 = plan_tier1(scans, folders, args.across_folders)
    removed = {(c["folder"], c["uid"]) for g in tier1 for c in g["remove"]}
    report["folders"] = [{
        "folder": f, "uidvalidity": scans[f]["uidvalidity"], "messages": len(scans[f]["messages"]),
        "tier1_groups": sum(1 for g in tier1 if g["keep"]["folder"] == f),
        "tier1_to_remove": sum(1 for g in tier1 for c in g["remove"] if c["folder"] == f),
    } for f in folders]
    report["tier1"] = {"rule": TIER1_RULE, "groups": [
        {"sha256": g["sha256"], "keep": _brief(g["keep"]), "remove": [_brief(c) for c in g["remove"]]}
        for g in tier1], "to_remove": len(removed)}
    if mode == "apply":
        for g in tier1:
            for c in g["remove"]:
                method = mb.move_to_trash(c["folder"], c["uid"], c["uidvalidity"])
                report["moved"].append({**_brief(c), "tier": 1, "method": method})
    groups, no_id = plan_tier2_groups(scans, folders, args.across_folders, removed)
    raws = {}
    for f in folders:
        uids = sorted({c["uid"] for cs in groups for c in cs if c["folder"] == f})
        if uids:
            got = mb.fetch_raw(f, uids, scans[f]["uidvalidity"])
            raws.update({(f, u): r for u, r in got.items()})
    comparison = {"setup": report["setup"], "created": _dt.datetime.now().isoformat(timespec="seconds"),
                  "rule": TIER2_RULE, "across_folders": bool(args.across_folders),
                  "groups": build_comparison(groups, raws)}
    cmp_path = os.path.join(out_dir, "tier2-comparison.json")
    with open(cmp_path, "w", encoding="utf-8") as fh:
        json.dump(comparison, fh, indent=2, ensure_ascii=False)
    report["tier2"] = {"rule": TIER2_RULE, "comparison_file": cmp_path, "groups": len(groups),
                       "copies": sum(len(cs) for cs in groups), "messages_without_message_id": no_id,
                       "proposed": [{"group_id": f"g{n}", "message_id": cs[0]["message_id"],
                                     "copies": [_brief(c) for c in cs]} for n, cs in enumerate(groups, 1)]}


def _run_move_uids(mb, path, report):
    with open(path, encoding="utf-8") as fh:
        moves = json.load(fh)["moves"]
    report["requested"] = len(moves)
    seen = set()
    for m in moves:
        key = (m["folder"], int(m["uid"]))
        if key in seen:
            raise DedupeError(f"duplicate entry for {m['folder']} UID {m['uid']}")
        seen.add(key)
        for field in ("folder", "uid", "uidvalidity", "sha256"):
            if field not in m:
                raise DedupeError(f"move entry without {field}: {m}")
    for m in moves:
        uid, uv = int(m["uid"]), int(m["uidvalidity"])
        raw = mb.fetch_raw(m["folder"], [uid], uv).get(uid)
        if raw is None:
            raise DedupeError(f"{m['folder']} UID {uid} no longer exists")
        if sha256(raw) != m["sha256"]:
            raise DedupeError(f"{m['folder']} UID {uid} is not the message that was judged (hash differs)")
        method = mb.move_to_trash(m["folder"], uid, uv)
        report["moved"].append({"folder": m["folder"], "uid": uid, "group_id": m.get("group_id"),
                                "tier": 2, "method": method})


def _brief(c):
    return {"folder": c["folder"], "uid": c["uid"], "date": c.get("date"), "size": c.get("size")}


def main(setup_id, connect, argv=None):
    sys.exit(run(setup_id, connect, argv))


def _cli(argv=None):
    p = argparse.ArgumentParser(prog="dedupe_core.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    mv = sub.add_parser("moves-from-verdicts", help="build the --move-uids file from approved verdicts")
    mv.add_argument("--comparison", required=True)
    mv.add_argument("--verdicts", required=True)
    mv.add_argument("--groups", help="comma-separated approved group ids (default: every 'remove' verdict)")
    mv.add_argument("--out", help="write here instead of stdout")
    a = p.parse_args(argv)
    with open(a.comparison, encoding="utf-8") as fh:
        comparison = json.load(fh)
    with open(a.verdicts, encoding="utf-8") as fh:
        verdicts = json.load(fh)
    approved = set(a.groups.split(",")) if a.groups else None
    try:
        result = moves_from_verdicts(comparison, verdicts, approved)
    except DedupeError as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        return 2
    text = json.dumps(result, indent=2, ensure_ascii=False)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
