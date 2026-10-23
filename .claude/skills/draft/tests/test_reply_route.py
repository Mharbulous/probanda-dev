import unittest
from pathlib import Path


DRAFT = Path(__file__).resolve().parents[1]
SKILL = DRAFT / "SKILL.md"
PROCEDURE = DRAFT / "references" / "procedure.md"
REFERENCES = DRAFT / "references"
ROUTE = "references/reply.md"


def section(text, heading):
    start = text.index(heading)
    end = text.find("\n## ", start + len(heading))
    return text[start:end if end != -1 else None]


class ReplyRouteTest(unittest.TestCase):
    """A reply to the tribunal or counsel reaches reply.md from every route (ADR 0040)."""

    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.procedure = PROCEDURE.read_text(encoding="utf-8")
        cls.route = (DRAFT / ROUTE).read_text(encoding="utf-8")

    def test_section_1_routes_it_before_session_entry(self):
        what = section(self.text, "## 1. What this skill is")
        self.assertIn(f"`{ROUTE}` from the start, before session entry", what)

    def test_section_15_names_it(self):
        self.assertIn(f"| `{ROUTE}` |", section(self.procedure, "## 15. References"))

    def test_opening_routes_names_it(self):
        self.assertIn(f"`draft/{ROUTE}`", (DRAFT.parent / "work" / "references" / "opening-routes.md").read_text(encoding="utf-8"))

    def test_the_chat_rules_name_the_exception(self):
        prohibitions = section(self.text, "## 2. Hard prohibitions")
        item_13 = next(line for line in prohibitions.splitlines() if line.startswith("13. "))
        self.assertIn(f"`{ROUTE}`", item_13)
        chat = next(line for line in section(self.text, "## 3. Doctrine bindings").splitlines()
                    if line.startswith("**Chat is not the review surface.**"))
        self.assertIn(f"`{ROUTE}`", chat)

    def test_save_first_exempts_it(self):
        save_first = next(line for line in section(self.procedure, "## 8. New matter setup").splitlines()
                          if line.startswith("**Save first**"))
        self.assertIn(f"a reply on the reply route (`{ROUTE}`; ADR 0040) are not Writings", save_first)

    def test_letters_points_at_it(self):
        self.assertIn("`references/reply.md`", (REFERENCES / "letters.md").read_text(encoding="utf-8"))

    def test_the_route_uses_its_two_tools_and_opens_the_database_only_to_attach(self):
        self.assertIn("`drafting_forms__read_message`", self.route)
        self.assertIn("`drafting_forms__reply_draft`", self.route)
        self.assertIn("takes no intake and no session entry's opening", self.route)
        self.assertIn("It opens the drafting database only to attach the file to one Job Board", self.route)
        attach = next(line for line in self.route.splitlines()
                      if line.startswith("5. **Attach it to a Job Board at its first save**"))
        before = self.route[:self.route.index(attach)]
        self.assertNotIn("Call `drafting_forms__open_session`", before)

    def test_the_final_pass_checks_quotes_by_script(self):
        final = section(self.route, "## 5. The final pass, on request")
        self.assertIn("`/verify-law` Mode A", final)
        self.assertIn("`diff_excerpt.py`", final)
        self.assertIn("Never judge a match by eye", final)

    def test_deadline_isolation_binds_it(self):
        self.assertIn("`shared/deadline-isolation.md`", self.route)


if __name__ == "__main__":
    unittest.main()
