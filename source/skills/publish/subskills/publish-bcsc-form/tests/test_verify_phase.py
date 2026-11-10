"""Pins which `shared.verify` positions run under the Assemble-phase rules.

Issue #1315: `_detect_phase` recognised only `asm.fill`, so the strict Form 32
and Form 33 assemblies (`asm32.fill` / `asm33.fill`) were verified under the
lenient Generate-phase rules, where content placeholders may survive.
Issue #1331: the phase now comes from the harness's fill-step declarations, and
every sequence is also walked. The hand-named cases stay deliberately: the walk
derives its expectation from ASSEMBLY_FILLS, so only they catch a fill dropped
from it.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

from harness import ASSEMBLY_FILLS, GENERATE_FILLS, SEQUENCES  # noqa: E402
from steps.shared.verify import _detect_phase  # noqa: E402


def _verify_positions(sequence: str) -> list[int]:
    return [i for i, step in enumerate(SEQUENCES[sequence]) if step == "shared.verify"]


def _phase_after(sequence: str, prev_step: str) -> str:
    steps = SEQUENCES[sequence]
    idx = next(i for i in _verify_positions(sequence) if steps[i - 1] == prev_step)
    return _detect_phase({"sequence": sequence, "step_index": idx})


class DetectPhaseTest(unittest.TestCase):
    def test_strict_form32_assembly_is_assemble(self):
        self.assertEqual(_phase_after("asm32", "asm32.fill"), "assemble")

    def test_strict_form33_assembly_is_assemble(self):
        self.assertEqual(_phase_after("asm33", "asm33.fill"), "assemble")

    def test_asm_fill_is_assemble(self):
        for sequence in ("assemble", "full"):
            with self.subTest(sequence=sequence):
                self.assertEqual(_phase_after(sequence, "asm.fill"), "assemble")

    def test_generate_sequences_are_generate(self):
        for sequence in ("generate", "generate-subserv"):
            with self.subTest(sequence=sequence):
                self.assertEqual(_phase_after(sequence, "gen.fill"), "generate")

    def test_first_verify_in_full_is_generate(self):
        first = _verify_positions("full")[0]
        self.assertEqual(
            _detect_phase({"sequence": "full", "step_index": first}), "generate"
        )

    def test_every_verify_is_preceded_by_a_classified_fill(self):
        for sequence in SEQUENCES:
            steps = SEQUENCES[sequence]
            for idx in _verify_positions(sequence):
                with self.subTest(sequence=sequence, step_index=idx):
                    self.assertGreater(idx, 0)
                    self.assertIn(steps[idx - 1], ASSEMBLY_FILLS | GENERATE_FILLS)

    def test_every_verify_phase_follows_its_fill(self):
        for sequence in SEQUENCES:
            steps = SEQUENCES[sequence]
            for idx in _verify_positions(sequence):
                expected = "assemble" if steps[idx - 1] in ASSEMBLY_FILLS else "generate"
                with self.subTest(sequence=sequence, step_index=idx):
                    self.assertEqual(
                        _detect_phase({"sequence": sequence, "step_index": idx}), expected
                    )

    def test_fill_classes_are_disjoint(self):
        self.assertFalse(ASSEMBLY_FILLS & GENERATE_FILLS)

    def test_out_of_range_and_unknown_are_generate(self):
        last = len(SEQUENCES["asm32"])
        for ctx in (
            {},
            {"sequence": "no-such-sequence", "step_index": 4},
            {"sequence": "asm32", "step_index": 0},
            {"sequence": "asm32", "step_index": last + 1},
        ):
            with self.subTest(ctx=ctx):
                self.assertEqual(_detect_phase(ctx), "generate")


if __name__ == "__main__":
    unittest.main()
