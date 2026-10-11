"""Writes an unsent Outlook draft: one .eml file carrying X-Unsent: 1 (#1453).

Reads ONE JSON request object from stdin and prints exactly ONE JSON line to stdout. It exits 0
for a success and for a refusal ({"success": false, "error": <code>, "detail": <text>}); a defect
is a traceback and a non-zero exit.

Request: from_name, from_address, to (one or more address strings, "Name <a@b>" or "a@b"),
cc (optional), subject, body (plain text), attachments (optional absolute paths), out_dir (an
existing folder, or a new one in an existing folder, made only once every check has passed),
out_name (a bare file name stem), and optional signature_template and closing.

The signature is the sender's template when signature_template names an existing .htm (the roster
person's <case_data_root>\\_practice\\firm\\email-signatures\\<key>.htm, laid out as Outlook lays out a
signature: <key>.txt and <key>_files beside it, both optional). Otherwise it is Outlook's own
default new-message signature for from_address: the "New
Signature" of each account in the Outlook profiles whose "Account Name" is that address. One
distinct name gives %APPDATA%\\Microsoft\\Signatures\\<name>.htm (its images, whether files in
<name>_files or base64 data: URIs, become inline cid: parts) with <name>.txt, and a
multipart/alternative message. None, several, no Windows, or a missing .htm
gives a plain-text message, "signature": null and a "signature_note" saying why. The result's
"signature_source" is "template", "outlook" or null. While a signature applies, a body whose last
lines repeat closing or from_name is refused (signoff_duplicates_signature): the signature supplies them.

The draft goes to <out_dir>\\<out_name>.eml, or the next free " vN" when that is taken (reported
as versioned_from, the highest existing copy), through a temporary file, so a killed run leaves
no draft. The text/plain part is the body's exact UTF-8 bytes, base64-encoded, so parsing the
file back gives the body unchanged. The result never carries file content.
"""

import base64
import html
import json
import mimetypes
import os
import re
import sys
from email import policy
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import parseaddr
from pathlib import Path

OUTLOOK_PROFILES = r"Software\Microsoft\Office\16.0\Outlook\Profiles"
# The fixed subkey under each Outlook profile that holds its mail-account entries, each with
# its "Account Name" and "New Signature" values.
MAIL_ACCOUNTS = "9375CFF0413111d3B88A00104B2A6676"

# What an out_name stem may not carry: a character Windows forbids in a file name, the .eml
# extension, or the " v<n>" this script appends itself (as fill_general.py's BAD_STEM).
BAD_STEM = re.compile(r'[\\/:*?"<>|]|\.eml$| v\d+$', re.I)
VML_BLOCK = re.compile(r"<!--\[if gte vml 1\]>.*?<!\[endif\]-->", re.I | re.S)
# The non-VML fallback Outlook wraps each image in; other <![if ...]> blocks keep their markers.
VML_FALLBACK = re.compile(r"<!\[if !vml\]>(.*?)<!\[endif\]>", re.I | re.S)
META_CHARSET = re.compile(r"""(<meta\b[^>]*?charset\s*=\s*["']?)([A-Za-z0-9_.:-]+)""", re.I)
IMG_SRC = re.compile(r"""(<img\b[^>]*?\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>"']+))""", re.I)
URL_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
DATA_URI = re.compile(r"^data:([\w.+-]+/[\w.+-]+)?(?:;[^,;]*)*?;base64,(.*)$", re.I | re.S)


class Refusal(Exception):
    """A refusal: printed as one JSON line naming `code`, never a traceback."""

    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def read_outlook_accounts():
    """(Account Name, New Signature) of every Outlook mail account in every profile, as stored:
    str, bytes or None. A missing key or value is skipped or None; any other registry error and a
    missing winreg (not Windows: ImportError) are raised."""
    import winreg

    def subkeys(key):
        return [winreg.EnumKey(key, i) for i in range(winreg.QueryInfoKey(key)[0])]

    def value(key, name):
        try:
            return winreg.QueryValueEx(key, name)[0]
        except FileNotFoundError:
            return None

    accounts = []
    try:
        profiles = winreg.OpenKey(winreg.HKEY_CURRENT_USER, OUTLOOK_PROFILES)
    except FileNotFoundError:
        return accounts
    with profiles:
        for profile in subkeys(profiles):
            try:
                mail = winreg.OpenKey(profiles, profile + "\\" + MAIL_ACCOUNTS)
            except FileNotFoundError:
                continue
            with mail:
                for account in subkeys(mail):
                    with winreg.OpenKey(mail, account) as key:
                        accounts.append((value(key, "Account Name"), value(key, "New Signature")))
    return accounts


def registry_text(value):
    """A REG_SZ, or a REG_BINARY holding UTF-16-LE text, without its NULs."""
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-16-le")
    return value.strip("\x00")


def resolve_signature(from_address, read_accounts=read_outlook_accounts, signatures_dir=None, template=None):
    """{"name", "htm", "txt", "source"} for the sender's template when it exists, else for
    from_address's one Outlook default signature, else {"name": None, "source": None, "note"}."""
    if template and Path(template).is_file():
        htm = Path(template)
        return {"name": htm.stem, "htm": htm, "txt": htm.with_suffix(".txt"), "source": "template"}
    found = resolve_outlook_signature(from_address, read_accounts, signatures_dir)
    if found["name"]:
        found["source"] = "outlook"
    else:
        found["source"] = None
        if template:
            found["note"] += ", and there is no signature template at %s" % template
    return found


def resolve_outlook_signature(from_address, read_accounts, signatures_dir):
    """{"name", "htm", "txt"} for from_address's one default signature, else {"name": None, "note"}."""
    try:
        accounts = [(registry_text(account), registry_text(signature)) for account, signature in read_accounts()]
    except ImportError:
        return {"name": None, "note": "not Windows: no Outlook profile to read a signature from"}
    except (OSError, ValueError) as err:
        raise Refusal("signature_registry_error", "reading the Outlook profiles failed: %r" % (err,))
    names = set()
    for account, signature in accounts:
        if account and signature and account.casefold() == from_address.casefold():
            names.add(signature)
    if not names:
        return {"name": None, "note": "no Outlook account for %s has a default new-message signature" % from_address}
    if len(names) > 1:
        return {"name": None, "note": "the Outlook accounts for %s name several default signatures: %s"
                % (from_address, ", ".join(sorted(names)))}
    name = names.pop()
    if not signatures_dir and not os.environ.get("APPDATA"):
        return {"name": None, "note": "APPDATA is not set, so the Signatures folder for %s cannot be found" % name}
    folder = Path(signatures_dir) if signatures_dir else Path(os.environ["APPDATA"]) / "Microsoft" / "Signatures"
    htm = folder / (name + ".htm")
    if not htm.is_file():
        return {"name": None, "note": "signature %s has no %s" % (name, htm)}
    return {"name": name, "htm": htm, "txt": folder / (name + ".txt")}


def decode_txt(data):
    """Outlook's .txt signature, decoded by its byte-order mark."""
    if data.startswith(b"\xef\xbb\xbf"):
        return data.decode("utf-8-sig")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    return data.decode("cp1252")


def unquote(src):
    """A URL path's %XX escapes, read as UTF-8."""
    return re.sub(r"(?:%[0-9A-Fa-f]{2})+",
                  lambda m: bytes.fromhex(m.group(0).replace("%", "")).decode("utf-8", "replace"), src)


def body_html(body):
    """The body as HTML paragraphs: blank lines split paragraphs, single newlines are <br>."""
    text = body.replace("\r\n", "\n").strip("\n")
    paragraphs = re.split(r"\n(?:[ \t]*\n)+", text)
    return "".join("<p>%s</p>" % html.escape(p).replace("\n", "<br>") for p in paragraphs) + "<p>&nbsp;</p>"


def data_image(src, htm):
    """(content type, bytes) of a data: URI image, as Outlook writes them (base64, whitespace allowed)."""
    match = DATA_URI.match(src)
    if not match:
        raise Refusal("signature_unusable", "signature %s has an image data URI that is not base64" % htm.stem)
    try:
        data = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except ValueError as err:
        raise Refusal("signature_unusable", "signature %s has an image data URI that cannot be decoded: %s" % (htm.stem, err))
    return match.group(1) or "application/octet-stream", data


def signature_html(htm, body):
    """The signature's HTML with the body inserted after <body>, and its images as
    (cid, content type, bytes, file name) tuples, each image's src rewritten to cid:<id>. An image
    is a file relative to the .htm or, as Outlook often writes it, a base64 data: URI."""
    raw = htm.read_bytes()
    declared = META_CHARSET.search(raw.decode("latin-1"))
    try:
        text = raw.decode(declared.group(2) if declared else "cp1252")
    except (LookupError, UnicodeDecodeError) as err:
        raise Refusal("signature_unusable", "signature %s's .htm cannot be decoded: %s" % (htm.stem, err))
    text = VML_FALLBACK.sub(r"\1", VML_BLOCK.sub("", text))

    images, missing = {}, []

    def rewrite(match):
        src = next(g for g in match.groups()[1:] if g is not None)
        is_data = src[:5].lower() == "data:"
        if URL_SCHEME.match(src) and not is_data:
            return match.group(0)
        key = src if is_data else htm.parent / unquote(html.unescape(src))
        if key not in images:
            cid = "image%03d@signature" % (len(images) + 1)
            if is_data:
                ctype, data = data_image(src, htm)
                images[key] = (cid, ctype, data, cid.split("@")[0] + (mimetypes.guess_extension(ctype) or ""))
            elif key.is_file():
                ctype = mimetypes.guess_type(str(key))[0] or "application/octet-stream"
                images[key] = (cid, ctype, key.read_bytes(), key.name)
            else:
                missing.append(str(key))
                images[key] = (cid, None, None, None)
        return '%s"cid:%s"' % (match.group(1), images[key][0])

    text = IMG_SRC.sub(rewrite, text)
    if missing:
        raise Refusal("signature_image_missing", "signature %s names image(s) not on disk: %s"
                      % (htm.stem, "; ".join(missing)))
    if META_CHARSET.search(text):
        text = META_CHARSET.sub(lambda m: m.group(1) + "utf-8", text, count=1)
    else:
        meta = '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
        head = re.search(r"<head\b[^>]*>", text, re.I)
        text = text[:head.end()] + meta + text[head.end():] if head else meta + text
    opening = re.search(r"<body\b[^>]*>", text, re.I)
    if not opening:
        raise Refusal("signature_unusable", "signature %s's .htm has no <body> tag" % htm.stem)
    text = text[:opening.end()] + body_html(body) + text[opening.end():]
    return text, list(images.values())


def signoff_key(line):
    """A line compared as a sign-off: casefolded, whitespace collapsed, trailing punctuation dropped."""
    return re.sub(r"\s+", " ", line).strip().rstrip(".,;:!-").strip().casefold()


def repeats_signoff(body, closing, name):
    """True when the body's last non-blank line is name, or one of its last three is closing."""
    lines = [signoff_key(line) for line in body.splitlines() if line.strip()]
    name, closing = signoff_key(name or ""), signoff_key(closing or "")
    return bool(lines) and (bool(name) and lines[-1] == name or bool(closing) and closing in lines[-3:])


def address(value, label):
    name, spec = parseaddr(value)
    try:
        if "@" not in spec:
            raise ValueError("no @")
        return Address(display_name=name, addr_spec=spec)
    except ValueError as err:
        raise Refusal("bad_address", "%s %r is not an email address (%s)" % (label, value, err))


def check_request(req):
    def strings(key, minimum=0):
        value = [] if req.get(key) is None else req[key]
        if not isinstance(value, list) or len(value) < minimum or not all(isinstance(v, str) for v in value):
            raise Refusal("bad_request", "%s must be a list of strings, at least %d" % (key, minimum))
        return value

    if not isinstance(req, dict):
        raise Refusal("bad_request", "the request must be one JSON object")
    for key in ("from_name", "from_address", "subject", "body", "out_dir", "out_name"):
        if not isinstance(req.get(key), str):
            raise Refusal("bad_request", "%s must be a string" % key)
    for key in ("signature_template", "closing"):
        if req.get(key) is not None and not isinstance(req[key], str):
            raise Refusal("bad_request", "%s must be a string when given" % key)
    if req.get("signature_template") and not os.path.isabs(req["signature_template"]):
        raise Refusal("bad_request", "signature_template %s is not an absolute path" % req["signature_template"])
    if "\r" in req["subject"] or "\n" in req["subject"]:
        raise Refusal("bad_request", "subject must be one line")
    out_dir = req["out_dir"]
    if not os.path.isabs(out_dir) or not (os.path.isdir(out_dir) or os.path.isdir(os.path.dirname(out_dir))):
        raise Refusal("bad_request", "out_dir %s is not an absolute folder, or a new one in an existing folder" % out_dir)
    stem = req["out_name"]
    if not stem.strip() or BAD_STEM.search(stem):
        raise Refusal("bad_request", "out_name %r must be a bare file name stem: not empty, without "
                      '\\ / : * ? " < > |, the .eml extension or a trailing " v<n>"' % (stem,))
    return strings("to", 1), strings("cc"), strings("attachments")


def next_version(out_dir, stem):
    """The path the next copy takes, and the highest existing copy (None if none).
    `<stem>.eml` counts as v1 and `<stem> vN.eml` as vN (fill_general.py's next_version)."""
    series = re.compile(r"^%s(?: v(\d+))?\.eml$" % re.escape(stem), re.I)
    taken = {}
    for entry in os.listdir(out_dir):
        match = series.match(entry)
        if match:
            taken[int(match.group(1) or 1)] = os.path.join(out_dir, entry)
    if not taken:
        return os.path.join(out_dir, stem + ".eml"), None
    top = max(taken)
    return os.path.join(out_dir, "%s v%d.eml" % (stem, top + 1)), taken[top]


def attachment_type(path):
    kind = mimetypes.guess_type(path)[0] or "application/octet-stream"
    # The email package base64-encodes every bytes part, which RFC 2046 forbids for message/*.
    return ("application", "octet-stream") if kind.startswith("message/") else tuple(kind.split("/", 1))


def run(req, read_accounts=read_outlook_accounts, signatures_dir=None):
    to, cc, attachments = check_request(req)
    unresolved = [p for p in attachments if not (os.path.isabs(p) and os.path.isfile(p))]
    if unresolved:
        raise Refusal("attachment_unresolved", "no file at: " + "; ".join(unresolved))

    msg = EmailMessage(policy=policy.SMTP)
    msg["X-Unsent"] = "1"
    sender = address(req["from_address"], "from_address").addr_spec
    try:
        msg["From"] = Address(display_name=req["from_name"], addr_spec=sender)
    except ValueError as err:
        raise Refusal("bad_address", "from_name %r cannot head the From address (%s)" % (req["from_name"], err))
    msg["To"] = [address(v, "to") for v in to]
    if cc:
        msg["Cc"] = [address(v, "cc") for v in cc]
    msg["Subject"] = req["subject"]

    body = req["body"]
    signature = resolve_signature(req["from_address"], read_accounts, signatures_dir, req.get("signature_template"))
    if signature["name"] and repeats_signoff(body, req.get("closing"), req["from_name"]):
        raise Refusal("signoff_duplicates_signature",
                      "body ends with the sender's closing or name, and the %s signature %s adds them again: "
                      "remove the closing and name from body and call again. Nothing was written."
                      % (signature["source"], signature["name"]))
    text = body
    if signature["name"]:
        html_text, images = signature_html(signature["htm"], body)
        if signature["txt"].is_file():
            sig_text = decode_txt(signature["txt"].read_bytes()).replace("\r\n", "\n")
            text = body + ("\n" if body.endswith("\n") else "\n\n") + sig_text
    msg.set_content(text.encode("utf-8"), maintype="text", subtype="plain", cte="base64", params={"charset": "utf-8"})
    if signature["name"]:
        msg.add_alternative(html_text, subtype="html")
        related = msg.get_payload()[1]
        for cid, ctype, data, filename in images:
            maintype, subtype = ctype.split("/", 1)
            related.add_related(data, maintype, subtype, cid="<%s>" % cid, disposition="inline", filename=filename)

    attached = []
    for path in attachments:
        data = Path(path).read_bytes()
        maintype, subtype = attachment_type(path)
        msg.add_attachment(data, maintype, subtype, filename=os.path.basename(path))
        attached.append({"name": os.path.basename(path), "size": len(data)})

    out_dir, stem = req["out_dir"], req["out_name"]
    # A new folder (a client letter's own) is made only now, after every refusal above.
    if not os.path.isdir(out_dir):
        os.mkdir(out_dir)
    tmp = os.path.join(out_dir, "~%s.%d.tmp" % (stem, os.getpid()))
    try:
        with open(tmp, "wb") as f:
            f.write(msg.as_bytes())
        path, prior = next_version(out_dir, stem)
        if os.path.exists(path):
            raise Refusal("output_exists", "not overwriting " + path)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    result = {"success": True, "path": os.path.abspath(path)}
    if prior:
        result["versioned_from"] = prior
    result["signature"] = signature["name"]
    result["signature_source"] = signature["source"]
    if not signature["name"]:
        result["signature_note"] = signature["note"]
    result["attachments"] = attached
    return result


def main():
    try:
        result = run(json.loads(sys.stdin.buffer.read().decode("utf-8")))
    except Refusal as err:
        result = {"success": False, "error": err.code, "detail": err.detail}
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
