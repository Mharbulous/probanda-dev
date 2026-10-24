"""The scrivener is the one read-only context that words correspondence, and its guidance is in one place."""
import json
import re
import unittest
from pathlib import Path


SCRIVENER = Path(__file__).resolve().parents[1]
REFS = SCRIVENER / "references"
SKILLS = SCRIVENER.parents[1]
REPO = SKILLS.parents[1]
AGENT = REPO / "source" / "lawyer" / "agents" / "scrivener.md"
DOCTRINE = SKILLS / "shared" / "correspondence-isolation.md"
NO_VENUE = SKILLS / "draft" / "references" / "CAN" / "BC" / "_NoVenue" / "Documents"
LETTER_FILES = sorted(NO_VENUE.glob("letter-to-*.md"))
WRITE_TOOL = re.compile(r"^(Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Agent)$|write|upsert|execute|save|send|edit",
                        re.I)


def frontmatter(path):
    return path.read_text(encoding="utf-8").split("---")[1]


class AgentTests(unittest.TestCase):
    def test_is_named_scrivener_and_assigned_to_lawyer(self):
        self.assertRegex(frontmatter(AGENT), r"(?m)^name: scrivener$")
        assignment = json.loads((REPO / "source" / "assignment.json").read_text(encoding="utf-8"))
        self.assertIn("scrivener", assignment["plugins"]["lawyer"]["agents"])

    def test_tools_are_read_only(self):
        tools = re.findall(r"^\s+- (\S+)", frontmatter(AGENT), re.M)
        self.assertIn("Read", tools)
        for tool in tools:
            with self.subTest(tool=tool):
                self.assertNotRegex(tool, WRITE_TOOL)

    def test_every_cited_reference_exists(self):
        agent = AGENT.read_text(encoding="utf-8")
        cited = set(re.findall(r"shared/scrivener/references/([\w/.-]+\.md)", agent))
        cited |= {f"{kind}/{name}.md" for kind, name in
                  re.findall(r"`(recipient|capacity|audience)/([\w-]+)\.md`", agent)}
        for kind, values in re.findall(r"- `(recipient|capacity|audience)`: (.+)", agent):
            cited |= {f"{kind}/{name}.md" for name in re.findall(r"`([a-z-]+)`", values)
                      if name not in ("recipient", "capacity", "audience")}
        self.assertIn("core.md", cited)
        self.assertIn("recipient/court.md", cited)
        for rel in sorted(cited):
            with self.subTest(rel=rel):
                self.assertTrue((REFS / rel).is_file(), rel)

    def test_every_reference_link_resolves(self):
        for path in sorted(REFS.rglob("*.md")):
            for rel in re.findall(r"`((?:\.\./)?[\w./-]+\.md)`", path.read_text(encoding="utf-8")):
                if rel.startswith(("shared/", "references/")):
                    continue
                with self.subTest(file=path.relative_to(REFS).as_posix(), rel=rel):
                    self.assertTrue((path.parent / rel).is_file() or (REFS / rel).is_file(), rel)


class LetterFileTests(unittest.TestCase):
    def test_six_letter_files_keep_their_layout_and_point_to_their_wording(self):
        self.assertEqual(len(LETTER_FILES), 6)
        for path in LETTER_FILES:
            text = path.read_text(encoding="utf-8")
            recipient = path.stem.removeprefix("letter-to-")
            with self.subTest(file=path.name):
                self.assertTrue(text.startswith("```json\n"))
                block = json.loads(text.split("```json\n", 1)[1].split("```", 1)[0])
                self.assertEqual(block["renderer"], "general")
                self.assertEqual([p["source"] for p in block["parts"]][-2:], ["slot:body", "signature-block"])
                self.assertIn("How every letter is drafted, checked on its mockup and sent is `references/letters.md`.", text)
                self.assertIn(f"`shared/scrivener/references/recipient/{recipient}.md`", text)
                self.assertTrue((REFS / "recipient" / f"{recipient}.md").is_file())

    def test_the_gates_stay_with_the_document(self):
        self.assertIn("Rule 7.2-6", (NO_VENUE / "letter-to-opposing-party.md").read_text(encoding="utf-8"))
        self.assertIn("## Is This the Right Audience?", (NO_VENUE / "letter-to-non-party.md").read_text(encoding="utf-8"))

    def test_wording_lives_once(self):
        moved = {
            "letter-to-opposing-counsel.md": "## Position Discipline",
            "letter-to-opposing-party.md": "## Demand Letters",
            "letter-to-expert.md": "### 1. Initial Retainer Letter",
            "letter-to-witness.md": "## First Contact Letters",
            "letter-to-public-body.md": "## Complaints and Requests for Enforcement",
            "letter-to-non-party.md": "## Core Principles",
        }
        for name, heading in moved.items():
            with self.subTest(file=name):
                self.assertNotIn(heading, (NO_VENUE / name).read_text(encoding="utf-8"))
        letters = (SKILLS / "draft" / "references" / "letters.md").read_text(encoding="utf-8")
        for heading in ("### Voice and Tone", "### Tone\n", "### What NOT to Do", "**Pass 4 — Voice.**"):
            with self.subTest(heading=heading):
                self.assertNotIn(heading, letters)


class DoctrineTests(unittest.TestCase):
    def test_states_the_recipients_the_four_edits_and_the_stop(self):
        doctrine = DOCTRINE.read_text(encoding="utf-8")
        for token in ("client", "court", "opposing lawyer or party", "regulator", "witness", "expert",
                      "public body", "non-party", "poorly chosen words could bite us",
                      "spelling, punctuation, grammar or word choice",
                      "No sentence, fact, position, deadline or tone",
                      "Say so and stop", "`lawyer:scrivener`"):
            with self.subTest(token=token):
                self.assertIn(token, doctrine)

    def test_cited_where_wording_is_asked_for(self):
        for path in (SKILLS / "draft" / "SKILL.md", SKILLS / "draft" / "references" / "letters.md",
                     SKILLS / "shared" / "email.md"):
            with self.subTest(file=path.name):
                text = path.read_text(encoding="utf-8")
                self.assertIn("scrivener", text)
                self.assertIn("correspondence-isolation.md", text)


class NoWordsmithTests(unittest.TestCase):
    def test_no_wordsmith_in_source(self):
        hits = []
        for root in (REPO / "source", REPO / ".claude"):
            for path in root.rglob("*"):
                if path.suffix in (".md", ".py", ".json") and path.is_file() \
                        and "__pycache__" not in path.parts and path != Path(__file__).resolve():
                    if "wordsmith" in path.read_text(encoding="utf-8", errors="replace").lower():
                        hits.append(path.relative_to(REPO).as_posix())
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
