"""Regression locks for the Westlaw client-ID gate (#1066).

Stage 2 of the deep-research playbook once required a tab-title prefix that a
live run never showed, and had no check that a dropdown selection took. Each
test pins one piece of the fix, in every copy of the playbook.
"""
import re
import unittest
from pathlib import Path


SKILLS_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SKILLS_ROOT.parents[1]
PLAYBOOK = Path("shared") / "law-getter" / "westlaw-deep-research.md"
PLAYBOOK_COPIES = (
    SKILLS_ROOT / PLAYBOOK,
)


def flat(path):
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8"))


def stage_2(text):
    return text[text.index("### Stage 2"):text.index("### Stage 3")]


class ClientIdGateTests(unittest.TestCase):
    def test_tab_title_is_not_a_scoping_signal(self):
        for path in PLAYBOOK_COPIES:
            with self.subTest(path=str(path.relative_to(REPO_ROOT))):
                gate = stage_2(flat(path))
                self.assertIn("The browser tab title is not a scoping signal", gate)
                self.assertNotIn("L8443- ...", gate)

    def test_selection_is_re_read_and_capped(self):
        for path in PLAYBOOK_COPIES:
            with self.subTest(path=str(path.relative_to(REPO_ROOT))):
                gate = stage_2(flat(path))
                self.assertIn("at most 3 attempts", gate)
                self.assertIn("re-read the combobox", gate)
                self.assertIn("After 3 attempts without a match, return `status: blocked (matter-mismatch)`", gate)

    def test_matching_is_token_only_trimmed_and_case_insensitive(self):
        for path in PLAYBOOK_COPIES:
            with self.subTest(path=str(path.relative_to(REPO_ROOT))):
                gate = stage_2(flat(path))
                self.assertIn("ID token only", gate)
                self.assertIn("ignore letter case", gate)

    def test_absent_top_nav_blocks(self):
        for path in PLAYBOOK_COPIES:
            with self.subTest(path=str(path.relative_to(REPO_ROOT))):
                self.assertIn("If it is absent, unreadable, or different, submit nothing and return "
                              "`status: blocked (matter-mismatch)`", stage_2(flat(path)))

    def test_session_already_started_switches_via_top_nav_and_re_reads(self):
        for path in PLAYBOOK_COPIES:
            with self.subTest(path=str(path.relative_to(REPO_ROOT))):
                gate = stage_2(flat(path))
                self.assertIn("**Session already started.**", gate)
                self.assertIn("re-read the top nav's `Client ID:` value; after 3 attempts without a match, "
                              "return `status: blocked (matter-mismatch)`", gate)

    def test_unlisted_target_blocks_and_is_never_typed(self):
        for path in PLAYBOOK_COPIES:
            with self.subTest(path=str(path.relative_to(REPO_ROOT))):
                text = flat(path)
                gate = stage_2(text)
                self.assertIn("Never type into the client-ID box", gate)
                self.assertNotIn("types `client_matter_id`", gate)
                self.assertIn("`status: blocked (client-id-not-on-westlaw)`", gate)
                contract = text[text.index("## Output contract"):]
                self.assertIn("`status: blocked (client-id-not-on-westlaw)`", contract)

    def test_contract_allows_personal_and_forbids_switching(self):
        for path in PLAYBOOK_COPIES:
            with self.subTest(path=str(path.relative_to(REPO_ROOT))):
                text = flat(path)
                self.assertIn("or the literal `PERSONAL`", text)
                self.assertIn("never switch between a matter ID and `PERSONAL`", text)

    def test_throttle_re_check_uses_the_stage_2_rule(self):
        text = flat(SKILLS_ROOT / PLAYBOOK)
        self.assertIn("confirm the top nav's `Client ID:` value still matches `client_matter_id` "
                      "under Stage 2's matching rule", text)


if __name__ == "__main__":
    unittest.main()
