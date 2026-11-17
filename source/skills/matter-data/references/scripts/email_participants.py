#!/usr/bin/env python3
"""email_participants.py -- whether a rendered email is between the client and the firm alone, message by message.

    python3 email_participants.py <rendering.txt> --firm <address> ... --client <address> ...

Reads a rendering by render_document.py (an .eml or .msg) and the addresses the
caller gives: the firm roster's emails (`practice_data__firm_profile`) and the
emails of this matter's client contacts (`practice_data__contact_lookup`). Opens
no database. Standard library only.

The newest message is the hdr block and the paragraphs before the first quoted or
forwarded header. Each later message starts at a paragraph that opens a header
block ("From: ... Sent:/Date: ... To: ...", "-----Original Message-----",
"---------- Forwarded message ---------") or reads "On ... wrote:". A message's
participants are the addresses of its From, To and Cc (an "On ... wrote:" line
names only its author). Bcc is never read.

Prints one line of JSON:

    {"client_lawyer": true|false,
     "messages": [{"paragraph": N|null, "author": str|null, "sent": str|null,
                   "side": "privileged"|"outside"|"unknown"}]}

The first message has paragraph null. A message is `privileged` when every
participant is a firm or client address, `outside` when one is neither, and
`unknown` when it names no address. `client_lawyer` is true only when the newest
message is privileged, names at least one firm and one client address, and no
message is unknown. Exit 0, or 2 with a message on stderr for a bad call.
"""

import argparse
import json
import re
import sys

ADDRESS = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")
ON_WROTE = re.compile(r"^On (.+?) wrote:")
HEADER_START = re.compile(r"^(?:_{10,}\s*)?(?:-{5,} ?(?:Original Message|Forwarded message) ?-{5,}\s*)?From: ", re.I)
FIELD = re.compile(r"\b(From|Sent|Date|To|Cc|Bcc|Subject):\s*", re.I)


def fields(text):
    """A collapsed header paragraph's fields, by label; a later label ends the one before."""
    marks = list(FIELD.finditer(text))
    out = {}
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        out.setdefault(m.group(1).lower(), text[m.end():end].strip())
    return out


def addresses(*values):
    return [a.lower() for v in values if v for a in ADDRESS.findall(v)]


def quoted_message(text):
    """The message a quoted or forwarded header paragraph opens, or None."""
    wrote = ON_WROTE.match(text)
    if wrote:
        found = addresses(wrote.group(1))
        sent = wrote.group(1).split(",")
        return {"author": found[-1] if found else None, "sent": ",".join(sent[:-1]).strip() or None,
                "participants": found[-1:]}
    if not HEADER_START.match(text):
        return None
    f = fields(text)
    if not (("sent" in f or "date" in f) and "to" in f):
        return None
    author = addresses(f.get("from"))
    return {"author": author[0] if author else None, "sent": f.get("sent") or f.get("date"),
            "participants": addresses(f.get("from"), f.get("to"), f.get("cc"))}


def classify(rendering, firm, client):
    firm = {a.lower() for a in firm}
    client = {a.lower() for a in client}
    header, paragraphs = {}, []
    for line in rendering.splitlines():
        marker, _, text = line.partition("\t")
        if marker == "hdr":
            name, _, value = text.partition(": ")
            header[name.lower()] = value
        elif marker.startswith("¶") and marker[1:].isdigit():
            paragraphs.append((int(marker[1:]), text))
    author = addresses(header.get("from"))
    messages = [{"paragraph": None, "author": author[0] if author else None, "sent": header.get("date"),
                 "participants": addresses(header.get("from"), header.get("to"), header.get("cc"))}]
    for number, text in paragraphs:
        found = quoted_message(text)
        if found:
            messages.append({"paragraph": number, **found})
    for m in messages:
        people = m.pop("participants")
        m["side"] = ("unknown" if not people
                     else "privileged" if all(p in firm or p in client for p in people) else "outside")
        m["_both"] = any(p in firm for p in people) and any(p in client for p in people)
    newest = messages[0]
    client_lawyer = (newest["side"] == "privileged" and newest["_both"]
                     and all(m["side"] != "unknown" for m in messages))
    for m in messages:
        del m["_both"]
    return {"client_lawyer": client_lawyer, "messages": messages}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("rendering")
    parser.add_argument("--firm", action="append", default=[])
    parser.add_argument("--client", action="append", default=[])
    args = parser.parse_args(argv)
    try:
        with open(args.rendering, encoding="utf-8") as fh:
            rendering = fh.read()
    except OSError as exc:
        print(f"cannot read the rendering: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(classify(rendering, args.firm, args.client), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
