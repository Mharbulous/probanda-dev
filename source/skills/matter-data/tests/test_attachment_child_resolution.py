"""The attachment-child rule in operations/ingest-verify.md Step 2, run against
the real renderer on a synthetic nested email (issue #1254).

A child source has no file_path: its bytes live inside its email. The rule
walks parent_source_id up to the nearest row with a file_path, checks that
file's hash against the row, then re-renders down the chain, taking at each
step the attachment whose SHA-256 equals the next row's file_hash. A top-level
hash mismatch, or a missing attachment under a parent whose hash matched, is
reported and nothing is verified. Synthetic fixtures only.
"""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from email.message import EmailMessage
from io import StringIO
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
TEST_TMP = CASE_DATA_ROOT.parents[2] / ".test-tmp"
TEST_TMP.mkdir(exist_ok=True)

spec = importlib.util.spec_from_file_location(
    "render_document", CASE_DATA_ROOT / "references" / "scripts" / "render_document.py"
)
render_document = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render_document)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def email_bytes(subject, body, attachments):
    msg = EmailMessage()
    msg["From"] = "sender@example.test"
    msg["To"] = "recipient@example.test"
    msg["Subject"] = subject
    msg.set_content(body)
    for name, payload in attachments:
        msg.add_attachment(payload, maintype="application", subtype="octet-stream", filename=name)
    return msg.as_bytes()


def render(path, out_dir):
    """render_document.py's CLI, freshly invoked, as the rule requires."""
    stdout = StringIO()
    with redirect_stdout(stdout):
        rc = render_document.main([str(path), str(out_dir)])
    assert rc == 0, f"render failed for {path}"
    return json.loads(stdout.getvalue())


def resolve_child(rows, child_id, matter_root, work_dir):
    """ingest-verify.md Step 2's attachment-child rule. Returns the path of the
    child's bytes, or a report naming why nothing can be verified."""
    chain = [rows[child_id]]
    while chain[-1]["file_path"] is None:
        chain.append(rows[chain[-1]["parent_source_id"]])
    chain.reverse()  # top-level email first, target child last

    top = chain[0]
    current = Path(matter_root) / top["file_path"]
    if sha256(current.read_bytes()) != top["file_hash"]:
        return {"report": "parent_changed", "source_id": top["source_id"]}
    for step, row in enumerate(chain[1:], start=1):
        rendered = render(current, Path(work_dir) / f"step{step}")
        match = [a for a in rendered["attachments"] if a["sha256"] == row["file_hash"]]
        if not match:
            return {"report": "attachment_missing", "source_id": row["source_id"]}
        current = Path(match[0]["path"])
    return {"path": current}


class AttachmentChildResolutionTests(unittest.TestCase):
    PDF = b"%PDF-1.4\n% synthetic exhibit for #1254\n"

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)
        self.matter = Path(self.tempdir.name) / "matter"
        self.matter.mkdir()
        inner = email_bytes("Inner", "The inner email carries the exhibit.", [("exhibit.pdf", self.PDF)])
        outer = email_bytes("Outer", "Forwarding the inner email.", [("inner.eml", inner)])
        (self.matter / "outer.eml").write_bytes(outer)
        # The rows ingest-extract registers: the email, its attached email, and that email's PDF.
        self.rows = {
            1: {"source_id": 1, "parent_source_id": None, "file_path": "outer.eml", "file_hash": sha256(outer)},
            2: {"source_id": 2, "parent_source_id": 1, "file_path": None, "file_hash": sha256(inner)},
            3: {"source_id": 3, "parent_source_id": 2, "file_path": None, "file_hash": sha256(self.PDF)},
        }

    def tearDown(self):
        self.tempdir.cleanup()

    def work_dir(self, name):
        return Path(self.tempdir.name) / name

    def test_a_child_one_level_down_resolves_to_its_attachment(self):
        result = resolve_child(self.rows, 2, self.matter, self.work_dir("w"))
        self.assertEqual(sha256(result["path"].read_bytes()), self.rows[2]["file_hash"])

    def test_a_grandchild_resolves_by_rendering_down_the_chain(self):
        result = resolve_child(self.rows, 3, self.matter, self.work_dir("w"))
        self.assertEqual(result["path"].read_bytes(), self.PDF)

    def test_a_fresh_render_gives_the_same_bytes_again(self):
        first = resolve_child(self.rows, 3, self.matter, self.work_dir("w1"))
        second = resolve_child(self.rows, 3, self.matter, self.work_dir("w2"))
        self.assertEqual(first["path"].read_bytes(), second["path"].read_bytes())

    def test_changed_parent_bytes_are_reported_before_any_render(self):
        changed = email_bytes("Outer", "Forwarding the inner email.", [("inner.eml", b"not the same email")])
        (self.matter / "outer.eml").write_bytes(changed)
        work = self.work_dir("w")
        result = resolve_child(self.rows, 3, self.matter, work)
        self.assertEqual(result, {"report": "parent_changed", "source_id": 1})
        self.assertFalse(work.exists(), "nothing is rendered once the parent's own hash fails")

    def test_a_missing_attachment_under_a_matching_parent_is_reported(self):
        self.rows[3]["file_hash"] = sha256(b"an exhibit the email never carried")
        result = resolve_child(self.rows, 3, self.matter, self.work_dir("w"))
        self.assertEqual(result, {"report": "attachment_missing", "source_id": 3})


if __name__ == "__main__":
    unittest.main()
