"""Form 33 registry contract (#985).

The stored registry is a bare place name ("Vancouver"); Form 33 appends
" Registry". A value already ending in the word "Registry" (any case,
surrounding whitespace ignored) is refused rather than silently accepted.
A blank or missing registry still yields a blank field.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from fill_subs_form33 import build_subs_form33  # noqa: E402


class Form33RegistryTest(unittest.TestCase):
    def test_bare_place_gets_registry_suffix(self) -> None:
        subs = build_subs_form33({"registry": "Vancouver"})
        self.assertEqual(subs["[REGISTRY]"], "Vancouver Registry")

    def test_value_ending_in_registry_is_refused(self) -> None:
        for value in ("Vancouver Registry", "Vancouver registry",
                      "VANCOUVER REGISTRY", "Vancouver Registry ",
                      " Vancouver Registry\n"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "bare place name"):
                    build_subs_form33({"registry": value})

    def test_place_merely_ending_in_registry_letters_is_accepted(self) -> None:
        subs = build_subs_form33({"registry": "Newregistry"})
        self.assertEqual(subs["[REGISTRY]"], "Newregistry Registry")

    def test_blank_or_missing_registry_stays_blank(self) -> None:
        self.assertEqual(build_subs_form33({})["[REGISTRY]"], "")
        self.assertEqual(build_subs_form33({"registry": ""})["[REGISTRY]"], "")


if __name__ == "__main__":
    unittest.main()
