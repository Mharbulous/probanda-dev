"""Every read-side consumer of a matter's folders asks the practitioner's folder
map (spec 2026-10-23 document-type glossary and folder map, criterion 7): none
names one practitioner's matter folder literally. The folders Probanda writes
into itself stay fixed and are allowed: the drafts folder (`0. DRAFT`), the law
folder (`6. LAW`), the case data folder (`0. CASE DATA`) and the legacy `9. AI`,
and the firm's matter template (`ADMIN\\0. TEMPLATE`), which is not a matter folder."""

import re
import unittest
from pathlib import Path


SKILLS = Path(__file__).resolve().parents[2]
REPO = SKILLS.parents[1]

CONSUMERS = sorted(
    [*(SKILLS / "matter-data" / "operations").glob("*.md"),
     *(SKILLS / "matter-data" / "shared").glob("*.md"),
     SKILLS / "matter-data" / "SKILL.md",
     SKILLS / "matter-data" / "references" / "scripts" / "ingest_coverage.py",
     SKILLS / "ingest" / "SKILL.md",
     SKILLS / "file-sorting" / "SKILL.md",
     SKILLS / "file-sorting" / "profiles" / "litigation-matter" / "profile.md",
     SKILLS / "housekeeping" / "SKILL.md",
     SKILLS / "probanda-setup" / "references" / "folder-layout.md",
     SKILLS / "shared" / "declared-layout.md",
     REPO / "source" / "file-manager" / "agents" / "housekeeping-namer.md",
     REPO / "source" / "lawyer" / "mcp" / "src" / "case" / "ingest-coverage.ts",
     REPO / "source" / "lawyer" / "mcp" / "src" / "knowledge" / "declared-layout.ts",
     REPO / "source" / "lawyer" / "mcp" / "src" / "submission" / "court-file-affidavits.ts"])

FIXED = re.compile(r"0\. ?DRAFT|0\. ?CASE DATA|0\. TEMPLATE|6\. ?LAW\b|9\. ?AI\b")
LITERAL = re.compile(
    r"\b[0-9]\. ?[A-Z]{2,}"                       # a numbered folder, such as a court-file folder
    r"|\bRAW\b|\bCASEMAP\b"                      # the raw-intake folder's names
    r"|SOLICITOR CLIENT|LAWYER BRIEF|COURT FILE|TRIAL BRIEF|DISCOVERY\b|DISBURSEMENTS?\b"
    r"|LIKE '[0-9]\.|\^[0-9]\\\\?\.")             # a prefix test on a numbered folder


def literal_names(text):
    return [m.group(0) for m in LITERAL.finditer(FIXED.sub("", text))]


class FolderMapConsumerTests(unittest.TestCase):
    def test_the_check_catches_each_kind_of_literal_name(self):
        for text in ("scan `3. CORRESPONDENCE`", "a `1. RAW` folder", "`RAW`", "s.file_path LIKE '5.%'",
                     "re.compile(r'^5\\. COURT')", "under 5. COURT FILE#S-1", "`2. SOLICITOR CLIENT*`"):
            with self.subTest(text=text):
                self.assertTrue(literal_names(text))
        for text in ("`0. DRAFT*\\Superseded\\`", "a `6. LAW` issue folder", "`0. CASE DATA`", "legacy `9. AI`",
                     "1. **Scope.** Read the map", "Court File#S-290001"):
            with self.subTest(text=text):
                self.assertEqual(literal_names(text), [])

    def test_no_consumer_names_a_matter_folder_literally(self):
        for path in CONSUMERS:
            with self.subTest(path=path.relative_to(REPO).as_posix()):
                self.assertTrue(path.is_file())
                self.assertEqual(literal_names(path.read_text(encoding="utf-8")), [])


if __name__ == "__main__":
    unittest.main()
