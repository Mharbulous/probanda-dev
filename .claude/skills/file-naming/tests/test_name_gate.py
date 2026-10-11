"""The name gate accepts the " vN" revision suffix and UNSIGNED, and fails " (vN)" (#1303)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from name_gate import check_name  # noqa: E402

CODES = {"LT"}


def verdict(stem):
    return check_name(stem, CODES, [])[0]


class RevisionSuffixTest(unittest.TestCase):
    def test_v_suffix_and_unsigned_conform(self):
        for stem in ("2026-10-01 LT LiL re smoke reports v2",
                     "2026-10-01 LT LiL re smoke reports v2 UNSIGNED",
                     "2026-10-01 LT LiL re smoke reports UNSIGNED"):
            self.assertEqual(verdict(stem), "conforms", stem)

    def test_parenthesised_suffix_fails(self):
        for stem in ("2026-10-01 LT LiL re smoke reports (v2)",
                     "2026-10-01 LT LiL re smoke reports (version 2)",
                     "2026-10-01 LT LiL re smoke reports (v3) UNSIGNED"):
            self.assertEqual(verdict(stem), "fails", stem)
            self.assertIn("revision suffix", check_name(stem, CODES, [])[1])

    def test_parenthesis_inside_subject_conforms(self):
        for stem in ("2026-10-01 LT LiL re (vacated) order",
                     "2026-10-01 LT LiL re (v2) order final"):
            self.assertEqual(verdict(stem), "conforms", stem)


if __name__ == "__main__":
    unittest.main()
