"""Pins every read-only Probanda plugin agent to its subagent template (#549, #558).

Each agent body is its template verbatim plus the `**Lane:**` line plugins/CLAUDE.md
requires after the H1. Each grant is `Read` alone — the "file-read tool only" the
templates' binding constraints assert — so a caller dispatching one of these
templates gets that guarantee at runtime instead of on paper.

The model column is the #558 split: the verifiers are pinned so a weak session model
cannot produce weak extraction *and* an equally weak check of it, while the extractors
carry no `model:` line and inherit the session model, per the clean-room spec's R1 §2
("Omit the model field so subagents inherit the session model") and because
`operations/extract-facts.md` dispatches them in parallel batches of up to ten.

Run: python -m unittest discover -s .claude/skills/case-data/tests
"""

from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[4]
SKILLS = REPO_ROOT / ".claude" / "skills"
SOURCE = REPO_ROOT / "source"

# agent name -> (skill that owns the template, pinned model or None for "inherit")
AGENTS = {
    "verify-edges": ("case-data", "opus"),
    "verify-source": ("case-data", "opus"),
    "verify-caselaw": ("case-data", "opus"),
    "verify-claim": ("verify-law", "opus"),
    "extract-affidavit": ("case-data", None),
    "extract-caselaw": ("case-data", None),
    "extract-facts": ("case-data", None),
    "extract-provision": ("case-data", None),
    "extract-sought-orders": ("case-data", None),
}


def _template(name):
    return SKILLS / AGENTS[name][0] / "agents" / (name + ".md")


def _agent(name):
    """The agent's file, in whichever plugin ships it (source/<plugin>/agents/)."""
    (path,) = SOURCE.glob("*/agents/%s.md" % name)
    return path


def _read(path):
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def _split(text, name):
    match = re.match(r"---\n(.*?)\n---\n\n", text, re.DOTALL)
    assert match, "%s has no frontmatter block" % name
    return match.group(1), text[match.end():]


class PluginAgentParityTests(unittest.TestCase):
    def test_table_covers_every_template(self):
        """A new template must not slip in without an agent — scope by file list, not
        by grepping the read-only sentence, whose wording differs across templates."""
        listed = {name for name, (skill, _) in AGENTS.items() if skill == "case-data"}
        self.assertEqual(
            listed,
            {path.stem for path in (SKILLS / "case-data" / "agents").glob("*.md")},
        )
        self.assertEqual(
            {"verify-claim"},
            {path.stem for path in (SKILLS / "verify-law" / "agents").glob("*.md")},
        )

    def test_grant_is_read_only(self):
        for name in sorted(AGENTS):
            with self.subTest(agent=name):
                frontmatter, _ = _split(_read(_agent(name)), name)
                self.assertRegex(frontmatter, r"(?m)^name: %s$" % re.escape(name))
                self.assertEqual(
                    ["Read"],
                    re.findall(
                        r"^  - (.*)$",
                        frontmatter.split("tools:\n", 1)[1],
                        re.MULTILINE,
                    ),
                )

    def test_model_pin_matches_the_558_split(self):
        for name, (_, model) in sorted(AGENTS.items()):
            with self.subTest(agent=name):
                frontmatter, _ = _split(_read(_agent(name)), name)
                found = re.findall(r"(?m)^model: (.*)$", frontmatter)
                if model is None:
                    self.assertEqual(
                        [],
                        found,
                        "%s must carry no model line; it inherits the session model" % name,
                    )
                else:
                    self.assertEqual([model], found)

    def test_body_is_template_plus_lane_line(self):
        for name in sorted(AGENTS):
            with self.subTest(agent=name):
                _, body = _split(_read(_agent(name)), name)
                h1, lane, rest = body.split("\n\n", 2)
                self.assertTrue(
                    lane.startswith("**Lane:** "), "lane line must follow the H1"
                )
                self.assertEqual(_read(_template(name)), h1 + "\n\n" + rest)


if __name__ == "__main__":
    unittest.main()
