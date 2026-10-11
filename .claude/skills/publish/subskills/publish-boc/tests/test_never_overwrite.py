"""Each Word deliverable is written at the draft folder's root under the caller's stem, and a
re-run never overwrites an earlier one: it takes v(highest + 1) and names the copy it passed
over (#1196, #1324)."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "tests"))
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

from free_path import next_version  # noqa: E402
from test_form63 import SAMPLE_CTX  # noqa: E402

FILL_BOC_PY = SKILL_ROOT / "scripts" / "fill_boc.py"
FILL_FORM63_PY = SKILL_ROOT / "scripts" / "fill_form63.py"

STEM = "2026-10-01 BOC Alpha"
BAD_STEMS = ("", " ", "a/b", "a:b", STEM + ".docx", STEM + " v2")

BOC_CTX = {
    "court_file_number": "S-123456",
    "registry": "Vancouver",
    "originating_party": "ALPHA COMPANY LTD.",
    "originating_party_role": "Plaintiff",
    "responding_party": "BETA COMPANY LTD.",
    "responding_party_role": "Defendant",
    "party_claiming_costs": "Alpha Company Ltd.",
    "tariff_items": [],
}


def run(script: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-B", str(script), *args],
        capture_output=True,
        text=True,
    )


def named(stdout: str, label: str) -> list[str]:
    """The paths named by each `<label><path>` line, size suffix dropped."""
    return [
        line[len(label):].split("  (")[0]
        for line in stdout.splitlines()
        if line.startswith(label)
    ]


class DraftFolderTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.draft = self.tmp / "0. DRAFT"
        self.draft.mkdir()

    def ok(self, script: Path, *args: str) -> str:
        result = run(script, *args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def refused(self, script: Path, *args: str) -> None:
        result = run(script, *args)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("error:", result.stderr)

    def assert_series(self, script: Path, args: tuple[str, ...], ext: str) -> bytes:
        """Three runs write <stem>, then v2 and v3, each naming the copy before it."""
        first = self.draft / (STEM + ext)
        v2 = self.draft / f"{STEM} v2{ext}"
        v3 = self.draft / f"{STEM} v3{ext}"
        out = self.ok(script, *args)
        self.assertEqual(named(out, "Written: ")[-1:], [str(first)])
        self.assertEqual(named(out, "Versioned from: "), [])
        original = first.read_bytes()
        for path, prior in ((v2, first), (v3, v2)):
            out = self.ok(script, *args)
            self.assertEqual(named(out, "Written: ")[-1:], [str(path)])
            self.assertEqual(named(out, "Versioned from: "), [str(prior)])
        self.assertEqual(first.read_bytes(), original)
        return original


class NextVersionTest(unittest.TestCase):
    def test_takes_one_above_the_highest_copy_not_the_first_gap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.assertEqual(next_version(folder, "B", ".docx"), (folder / "B.docx", None))
            for name in ("B.docx", "B v3.docx", "B v3 (old).docx", "B.md"):
                (folder / name).write_bytes(b"")
            self.assertEqual(
                next_version(folder, "B", ".docx"),
                (folder / "B v4.docx", folder / "B v3.docx"),
            )


class FillBocTest(DraftFolderTest):
    def args(self, stem: str = STEM, out_dir: Path | None = None) -> tuple[str, ...]:
        ctx = self.tmp / "ctx.json"
        ctx.write_text(json.dumps(BOC_CTX), encoding="utf-8")
        return ("--context", str(ctx), "--out-dir", str(out_dir or self.draft),
                "--out-name", stem)

    def test_reruns_write_v2_then_v3_at_the_root_and_leave_nothing_else(self) -> None:
        self.assert_series(FILL_BOC_PY, self.args(), ".docx")
        self.assertEqual(
            sorted(p.name for p in self.draft.iterdir()),
            sorted([STEM + ".docx", STEM + " v2.docx", STEM + " v3.docx"]),
        )

    def test_a_bad_stem_or_a_missing_folder_is_refused_and_nothing_is_written(self) -> None:
        for stem in BAD_STEMS:
            with self.subTest(stem=stem):
                self.refused(FILL_BOC_PY, *self.args(stem))
        missing = self.draft / "BOC Alpha"
        self.refused(FILL_BOC_PY, *self.args(out_dir=missing))
        self.assertEqual(list(self.draft.iterdir()), [])


class FillForm63Test(DraftFolderTest):
    def args(self, stem: str = STEM, docx_dir: Path | None = None) -> tuple[str, ...]:
        ctx = self.tmp / "ctx.json"
        ctx.write_text(json.dumps(SAMPLE_CTX), encoding="utf-8")
        self.md = self.draft / "BOC Harbourline" / "f.md"
        return ("--context", str(ctx), "--out", str(self.md),
                "--docx-dir", str(docx_dir or self.draft), "--out-name", stem)

    def test_md_rewritten_in_its_writing_folder_and_docx_versioned_at_the_root(self) -> None:
        args = self.args()
        self.assert_series(FILL_FORM63_PY, args, ".docx")
        self.md.write_text("stale", encoding="utf-8")
        out = self.ok(FILL_FORM63_PY, *args)
        self.assertEqual(named(out, "Written: "), [str(self.md), str(self.draft / (STEM + " v4.docx"))])
        self.assertNotEqual(self.md.read_text(encoding="utf-8"), "stale")

        self.assertEqual(
            sorted(p.name for p in self.draft.iterdir()),
            sorted(["BOC Harbourline", STEM + ".docx", STEM + " v2.docx",
                    STEM + " v3.docx", STEM + " v4.docx"]),
        )
        self.assertEqual([p.name for p in self.md.parent.iterdir()], ["f.md"])

    def test_a_bad_stem_or_a_missing_folder_is_refused_before_anything_is_written(self) -> None:
        for stem in BAD_STEMS:
            with self.subTest(stem=stem):
                self.refused(FILL_FORM63_PY, *self.args(stem))
        self.refused(FILL_FORM63_PY, *self.args(docx_dir=self.draft / "missing"))
        md_only = self.args()[:4]
        self.refused(FILL_FORM63_PY, *md_only, "--docx-dir", str(self.draft))
        self.refused(FILL_FORM63_PY, *md_only, "--out-name", STEM)
        self.assertEqual(list(self.draft.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
