import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]


class NoticeToAdmitContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = (SKILL_ROOT / "SUBSKILL.md").read_text(encoding="utf-8")
        cls.form = (SKILL_ROOT / "references" / "form-26.md").read_text(
            encoding="utf-8"
        )
        cls.form_normalized = " ".join(cls.form.split())

    def test_skill_identity_and_route(self):
        self.assertIn("name: publish-notice-to-admit", self.skill)
        self.assertIn("BC Supreme Court Notice to Admit", self.skill)
        self.assertIn("Rule 7-7", self.skill)
        self.assertIn("Form 26", self.skill)

    def test_bounded_fact_verification_contract(self):
        for token in (
            "Make one consolidated `/matter-data` request",
            "read only the single best obvious primary matter file",
            "then stop searching",
            "`contradicted`",
            "`not independently corroborated`",
            "Ask once in a compact table",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.skill)

    def test_verbatim_and_attachment_contract(self):
        for token in (
            "character-for-character",
            "Do not add `[sic]`",
            "SHA-256",
            "attached once, in list order",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.skill)

    def test_prescribed_form_text_and_layout(self):
        for token in (
            "for the purpose of this proceeding only",
            "if the party to whom this notice is directed does not serve",
            "within 14 days after service of a copy of this notice on that party",
            "the truth of the facts and the authenticity of the documents will be deemed",
            "Place the date/signature block immediately after `AND TAKE NOTICE`",
            "Do not add Part headings",
        ):
            with self.subTest(token=token):
                self.assertIn(token, self.form_normalized)


if __name__ == "__main__":
    unittest.main()
