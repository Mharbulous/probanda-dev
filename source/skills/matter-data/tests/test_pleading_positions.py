import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS))
from pleading_positions import (  # noqa: E402
    ExtractionError,
    locator_sort_key,
    resolve_fact_positions,
    validate_extraction,
)


FACTS = [
    {"fact_key": "f2a", "source_locator": "para. 2", "description": "A"},
    {"fact_key": "f2b", "source_locator": "para. 2", "description": "B"},
    {"fact_key": "f3", "source_locator": "para. 3", "description": "C"},
    {"fact_key": "f4", "source_locator": "para. 4(a)", "description": "D"},
]

# A response document may answer a pleading whose own facts came from a
# rendered docx/eml body — those carry ¶N/hdr locators, which _locator_parts
# cannot parse. They must be skipped, not fatal, when resolving a numbered
# "paragraph N" reference (issue #282).
FACTS_WITH_RENDERED_LOCATORS = FACTS + [
    {"fact_key": "f_p1", "source_locator": "¶1", "description": "E"},
    {"fact_key": "f_hdr", "source_locator": "hdr", "description": "F"},
]


def empty_payload():
    return {
        "facts": [],
        "fact_positions": [],
        "relief_items": [],
        "relief_positions": [],
        "source_references": [],
        "unresolved_references": [],
    }


class PleadingPositionTests(unittest.TestCase):
    def test_single_admission_maps_every_atomic_fact_and_party(self):
        rows = resolve_fact_positions(
            ["para. 2"], FACTS, ["Northridge", "Pacific"], "admit", "para. 1"
        )
        self.assertEqual(len(rows), 4)
        self.assertEqual({row["target_fact_key"] for row in rows}, {"f2a", "f2b"})
        self.assertEqual({row["party_name"] for row in rows}, {"Northridge", "Pacific"})

    def test_ranged_denial(self):
        rows = resolve_fact_positions(
            ["paras. 2-4"], FACTS, ["Ashbourne"], "deny", "para. 2"
        )
        self.assertEqual(
            {row["target_fact_key"] for row in rows}, {"f2a", "f2b", "f3", "f4"}
        )

    def test_non_admission_bases_and_express_no_position(self):
        for value, basis in (
            ("not_admit", "outside_knowledge"),
            ("not_admit", "strict_proof"),
            ("no_position", "directed_to_other_party"),
        ):
            rows = resolve_fact_positions(
                ["para. 3"], FACTS, ["Ashbourne"], value, "para. 8", basis
            )
            self.assertEqual(rows[0]["position_basis"], basis)

    def test_qualified_admission_is_one_row(self):
        rows = resolve_fact_positions(
            ["para. 3"],
            FACTS,
            ["Ashbourne"],
            "admit",
            "para. 7",
            "qualified",
            "except that payment was due later",
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["value"], "admit")
        self.assertEqual(rows[0]["qualification"], "except that payment was due later")

    def test_unparseable_answered_locator_is_skipped_not_fatal(self):
        # ¶1/hdr facts in ANSWERED_FACTS can never be the target of a
        # "para. 2" reference; resolution must skip them and still resolve
        # the para.-numbered facts normally, not raise.
        rows = resolve_fact_positions(
            ["para. 2"],
            FACTS_WITH_RENDERED_LOCATORS,
            ["Northridge"],
            "admit",
            "para. 1",
        )
        self.assertEqual({row["target_fact_key"] for row in rows}, {"f2a", "f2b"})

    def test_unresolved_range_reports_smallest_locator(self):
        with self.assertRaisesRegex(
            ExtractionError, r"unresolved target locator: para\. 1"
        ):
            resolve_fact_positions(
                ["para. 9", "para. 1"], FACTS, ["Ashbourne"], "deny", "para. 2"
            )

    def test_affirmative_matter_relief_and_incorporation_validate(self):
        payload = empty_payload()
        payload["facts"] = [
            {
                "fact_key": "new:1",
                "source_locator": "para. 5",
                "description": "Ashbourne delivered the notice on 1 May 2025.",
            }
        ]
        payload["fact_positions"] = [
            {
                "target_fact_key": "new:1",
                "party_name": "Ashbourne",
                "value": "claim",
                "position_basis": None,
                "qualification": None,
                "source_locator": "para. 5",
            }
        ]
        payload["relief_items"] = [
            {
                "relief_key": "new-relief:1",
                "description": "Dismissal of the counterclaim",
            }
        ]
        payload["relief_positions"] = [
            {
                "target_relief_key": "new-relief:1",
                "party_name": "Ashbourne",
                "value": "oppose",
            }
        ]
        payload["source_references"] = [
            {
                "reference_type": "incorporates",
                "description": "Incorporates the notice of civil claim",
            }
        ]
        self.assertIs(validate_extraction(payload), payload)

    def test_position_meta_fact_is_rejected(self):
        payload = empty_payload()
        payload["facts"] = [
            {
                "fact_key": "new:1",
                "source_locator": "para. 1",
                "description": "The Defendants deny paragraphs 9 to 20.",
            }
        ]
        with self.assertRaisesRegex(
            ExtractionError, "non-factual position stored as fact"
        ):
            validate_extraction(payload)

    def test_unresolved_payload_aborts_before_persistence(self):
        payload = empty_payload()
        payload["unresolved_references"] = [
            {"target_locator": "para. 20"},
            {"target_locator": "para. 9"},
        ]
        with self.assertRaisesRegex(
            ExtractionError, r"unresolved target locator: para\. 9"
        ):
            validate_extraction(payload)

    def test_reingestion_duplicate_current_position_is_rejected(self):
        payload = empty_payload()
        row = {
            "target_fact_key": "f3",
            "party_name": "Ashbourne",
            "value": "deny",
            "position_basis": None,
            "qualification": None,
            "source_locator": "para. 2",
        }
        payload["fact_positions"] = [row, dict(row)]
        with self.assertRaisesRegex(
            ExtractionError, "duplicate current factual position"
        ):
            validate_extraction(payload, answered_fact_keys={"f3"})

    def issue_payload(self, **change):
        payload = empty_payload()
        payload["facts"] = [{"fact_key": "new:1", "source_locator": "para. 5", "description": "A notice was delivered."}]
        issue = {"issue_key": "new-issue:1", "title": "Was the notice delivered in time?", "description": None,
                 "issue_type": "mixed", "source_locator": "Part 2, para. 1", "fact_keys": ["new:1", "f3"]}
        issue.update(change)
        payload["issues"] = [issue, {**issue, "issue_key": "issue:12", "fact_keys": []}]
        return payload

    def test_issues_validate_and_a_payload_without_them_still_passes(self):
        payload = self.issue_payload()
        self.assertIs(validate_extraction(payload, answered_fact_keys={"f3"}), payload)
        bare = empty_payload()
        self.assertIs(validate_extraction(bare), bare)

    def test_each_malformed_issue_is_refused(self):
        for change, message in (
            ({"title": " "}, "issue without a title"),
            ({"issue_type": "lawyer"}, "invalid issue type: lawyer"),
            ({"fact_keys": ["new:9"]}, "unknown issue fact: new:9"),
            ({"issue_key": "issue:12"}, "invalid or repeated issue key: issue:12"),
            ({"issue_key": "fact:3"}, "invalid or repeated issue key: fact:3"),
        ):
            with self.assertRaisesRegex(ExtractionError, message):
                validate_extraction(self.issue_payload(**change), answered_fact_keys={"f3"})
        payload = empty_payload()
        payload["issues"] = None
        with self.assertRaisesRegex(ExtractionError, "issues must be an array"):
            validate_extraction(payload)


# Suggestion 83893d42-82db-4d8d-a079-5081bd737271, item 3 (red test written by triage).
class PartQualifiedLocators(unittest.TestCase):
    def test_a_part_qualified_locator_resolves_within_its_part(self):
        facts = [{"fact_key": "a", "source_locator": "para. 2", "description": "A"},
                 {"fact_key": "b", "source_locator": "Part 3, para. 2", "description": "B"}]
        try:
            rows = resolve_fact_positions(["Part 3, para. 2"], facts, ["Ashbourne"], "deny", "para. 4")
        except ExtractionError:
            rows = []
        self.assertEqual({r["target_fact_key"] for r in rows}, {"b"})

    def test_part_qualified_locators_sort_by_part_then_paragraph(self):
        locators = ["Part 3, para. 1", "para. 10", "Part 2, paras. 2-4", "para. 2(b)", "para. 2(a)"]
        self.assertEqual(
            sorted(locators, key=locator_sort_key),
            ["para. 2(a)", "para. 2(b)", "para. 10", "Part 2, paras. 2-4", "Part 3, para. 1"],
        )

    def test_part_qualified_reference_without_a_fact_is_reported_unresolved(self):
        facts = [{"fact_key": "a", "source_locator": "para. 5", "description": "A"}]
        with self.assertRaisesRegex(
            ExtractionError, r"unresolved target locator: Part 3, para\. 5"
        ):
            resolve_fact_positions(["Part 3, para. 5"], facts, ["Ashbourne"], "deny", "para. 1")


if __name__ == "__main__":
    unittest.main()
