import unittest
from pathlib import Path


DRAFT = Path(__file__).resolve().parents[1]
PROCEDURE = DRAFT / "references" / "procedure.md"
REFERENCES = DRAFT / "references"
ROUTE = "references/revise-on-the-fly.md"


def section(text, heading):
    start = text.index(heading)
    end = text.find("\n## ", start + len(heading))
    return text[start:end if end != -1 else None]


class ReviseOnTheFlyRoutingTest(unittest.TestCase):
    """A request to reword one reviewed paragraph reaches revise-on-the-fly.md from every route."""

    @classmethod
    def setUpClass(cls):
        cls.text = PROCEDURE.read_text(encoding="utf-8")

    def test_the_route_file_exists(self):
        self.assertTrue((DRAFT / ROUTE).is_file())

    def test_the_route_file_has_the_reorder_branch(self):
        self.assertIn("\n## Reorder\n", (DRAFT / ROUTE).read_text(encoding="utf-8"))

    def test_section_12_names_it(self):
        self.assertIn(f"`{ROUTE}`", section(self.text, "## 12. Revise"))

    def test_section_15_names_it(self):
        self.assertIn(
            f"| The practitioner asks to reword one reviewed paragraph, or swap or move facts on a Writing "
            f"(section 12) | `{ROUTE}` |",
            section(self.text, "## 15. References"),
        )

    def test_opening_routes_names_it(self):
        self.assertIn(f"`draft/{ROUTE}`", (DRAFT.parent / "work" / "references" / "opening-routes.md").read_text(encoding="utf-8"))

    def test_substance_and_revise_names_it(self):
        revise = section((REFERENCES / "substance-and-revise.md").read_text(encoding="utf-8"), "## Section 12: Revise")
        self.assertIn("`revise-on-the-fly.md`", revise)


if __name__ == "__main__":
    unittest.main()
