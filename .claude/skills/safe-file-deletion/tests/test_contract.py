import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SKILL_ROOT.parents[2]

# .claude/skills carries the full body. The Probanda plugin ships that full
# source since #1266 (no stub under plugins/litigation/skills), so there is no
# second projection to check.
FULL_PROJECTION = REPO_ROOT / ".claude" / "skills" / "safe-file-deletion" / "SKILL.md"

FRONTMATTER_TOKENS = (
    "client-matter project",
    "Does NOT apply inside a Git worktree",
)

BODY_TOKENS = (
    "including when this skill was invoked explicitly",
    "nearest existing parent",
    "inside a Git worktree",
    "this skill is **out of scope**",
    "coclerk.json",
    "even if a client-matter folder happens to live inside a Git worktree: the Git exclusion always wins",
)


def split_skill(text):
    _, frontmatter, body = text.split("---", 2)
    return frontmatter, body


class SafeFileDeletionContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.canonical = split_skill(
            (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        )
        cls.full_projection = split_skill(
            FULL_PROJECTION.read_text(encoding="utf-8")
        )

    def test_canonical_carries_scope_boundaries(self):
        frontmatter, body = self.canonical
        for token in FRONTMATTER_TOKENS:
            with self.subTest(token=token):
                self.assertIn(token, frontmatter)
        for token in BODY_TOKENS:
            with self.subTest(token=token):
                self.assertIn(token, body)

    def test_full_projection_carries_scope_boundaries(self):
        frontmatter, body = self.full_projection
        for token in FRONTMATTER_TOKENS:
            with self.subTest(token=token):
                self.assertIn(token, frontmatter)
        for token in BODY_TOKENS:
            with self.subTest(token=token):
                self.assertIn(token, body)


if __name__ == "__main__":
    unittest.main()
