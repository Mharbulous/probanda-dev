"""Tests for email_participants.py: whether a rendered email is between the client and the
firm alone, message by message (docs/Specs/2026-11-17_email-ingest-privilege-protocol-spec.md).
Each email is built here and rendered by render_document.py. Every name and address is invented.

Run: python -m unittest discover -s source/skills/matter-data/tests -p "test_email_participants.py"
"""

import json
import subprocess
import sys
import tempfile
import unittest
from email.message import EmailMessage
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import email_participants  # noqa: E402
import render_document  # noqa: E402

FIRM = ["lena@quill-law.test", "sam@quill-law.test"]
CLIENT = ["ada@plumtree.test"]


def rendered(sender, to, body, cc=None, bcc=None):
    msg = EmailMessage()
    msg["From"], msg["To"] = sender, to
    if cc:
        msg["Cc"] = cc
    if bcc:
        msg["Bcc"] = bcc
    msg["Date"] = "Mon, 02 Mar 2026 09:00:00 -0800"
    msg["Subject"] = "Update"
    msg.set_content(body)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "m.eml"
        path.write_bytes(bytes(msg))
        text, _, _ = render_document.render_eml(str(path))
    return text


def classify(text):
    return email_participants.classify(text, FIRM, CLIENT)


CHAIN = """Please see the exchange below with the other side.

Ada

---------- Forwarded message ---------
From: Ada Plumtree <ada@plumtree.test>
Date: Fri, 27 Feb 2026 at 14:10
Subject: Fence
To: Bo Ng <bo@northwind.test>

The fence was moved on 1 February.

On Thu, 26 Feb 2026 at 08:00, Bo Ng <bo@northwind.test> wrote:
> We will not pay for the fence.
"""


class Participants(unittest.TestCase):
    def test_client_to_lawyer_is_client_lawyer_and_bcc_is_never_read(self):
        out = classify(rendered("Ada Plumtree <ada@plumtree.test>", "Lena <lena@quill-law.test>",
                                "Can we meet on Friday?", bcc="someone@elsewhere.test"))
        self.assertTrue(out["client_lawyer"])
        self.assertEqual(out["messages"], [{"paragraph": None, "author": "ada@plumtree.test",
                                            "sent": "Mon, 02 Mar 2026 09:00:00 -0800", "side": "privileged"}])

    def test_an_outsider_on_the_newest_message_keeps_the_question(self):
        out = classify(rendered("lena@quill-law.test", "ada@plumtree.test", "Noted.", cc="bo@northwind.test"))
        self.assertFalse(out["client_lawyer"])
        self.assertEqual(out["messages"][0]["side"], "outside")

    def test_firm_only_or_an_unknown_address_is_not_client_lawyer(self):
        self.assertFalse(classify(rendered("lena@quill-law.test", "sam@quill-law.test", "File note."))["client_lawyer"])
        self.assertFalse(classify(rendered("lena@quill-law.test", "new.person@plumtree.test", "Hello."))["client_lawyer"])

    def test_a_mixed_chain_splits_each_outside_message_with_its_author_and_date(self):
        out = classify(rendered("ada@plumtree.test", "lena@quill-law.test", CHAIN))
        self.assertTrue(out["client_lawyer"])
        self.assertEqual([(m["author"], m["side"]) for m in out["messages"]],
                         [("ada@plumtree.test", "privileged"), ("ada@plumtree.test", "outside"),
                          ("bo@northwind.test", "outside")])
        self.assertEqual([m["paragraph"] for m in out["messages"]], [None, 3, 5])
        self.assertEqual(out["messages"][1]["sent"], "Fri, 27 Feb 2026 at 14:10")
        self.assertEqual(out["messages"][2]["sent"], "Thu, 26 Feb 2026 at 08:00")

    def test_a_quoted_message_from_the_firm_stays_privileged(self):
        body = ("Thanks, that works.\n\nFrom: Lena <lena@quill-law.test>\nSent: Sunday, March 1, 2026 6:00 PM\n"
                "To: Ada Plumtree <ada@plumtree.test>\nSubject: Meeting\n\nShall we meet Friday?\n")
        out = classify(rendered("ada@plumtree.test", "lena@quill-law.test", body))
        self.assertTrue(out["client_lawyer"])
        self.assertEqual([m["side"] for m in out["messages"]], ["privileged", "privileged"])

    def test_a_quoted_message_with_no_address_keeps_the_question(self):
        body = "See below.\n\nOn Sun, 1 Mar 2026, Bo Ng wrote:\n> No.\n"
        out = classify(rendered("ada@plumtree.test", "lena@quill-law.test", body))
        self.assertFalse(out["client_lawyer"])
        self.assertEqual(out["messages"][1]["side"], "unknown")

    def test_the_cli_prints_one_line_of_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "r.txt"
            path.write_text(rendered("ada@plumtree.test", "LENA@quill-law.test", "Hi."), encoding="utf-8")
            done = subprocess.run([sys.executable, str(SCRIPTS_DIR / "email_participants.py"), str(path),
                                   "--firm", FIRM[0], "--client", CLIENT[0]], capture_output=True, text=True,
                                  encoding="utf-8", check=True)
        self.assertTrue(json.loads(done.stdout)["client_lawyer"])


if __name__ == "__main__":
    unittest.main()
