"""Pins the three leave-blank lists against each form's actual leftovers.

`fill_plain.py` decides what to substitute, the shared `publish/scripts/verify.py`
decides what may survive into a filed document, and the subagent prose in
`steps/shared/verify.py` tells the reviewer which survivors are acceptable.
Issue #719 was the three drifting apart: the firm tokens were mapped to context
keys and simultaneously listed as untouchable, so they were refused and warned
about. These tests fail the moment the lists drift again.
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import re
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import harness  # noqa: E402
from fill_plain import FORM_PART_MARKERS, LEAVE_BLANK, fill  # noqa: E402
from test_caption_contract import RENDER_CONTEXT  # noqa: E402


def _shared_verify():
    """Load publish/scripts/verify.py the way steps/shared/verify.py resolves it."""
    path = SKILL_ROOT.parents[1] / "scripts" / "verify.py"
    spec = importlib.util.spec_from_file_location("publish_verify", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VERIFY = _shared_verify()

# Form 123 carries two tokens that no substitution map mentions and neither
# leave-blank list covers. Pre-existing and out of scope for #719 -- listed
# here so they cannot hide a NEW drift, not to bless them.
KNOWN_UNRECONCILED = {"[amount]", "[type or print name]"}

FIRM_TOKENS = ("[FIRM ADDRESS]", "[FIRM EMAIL]", "[FIRM FAX]")


def _plain_forms():
    return [(form_id, spec) for form_id, spec in harness.REGISTRY.items()
            if spec["fill_script"] == "fill_plain.py"]


def _render(form_id: str, spec: dict, context: dict, directory: Path) -> Path:
    """Fill one form in assemble shape -- every Part supplied, as in a real run."""
    form = spec["fill_form_arg"]
    form_context = dict(context)
    if form == "petition":
        form_context["plaintiff_role"] = "Petitioner"
        form_context["defendant_role"] = "Respondent"
    body = "\n".join(f"{part.upper()}\nBody line for {part}."
                     for part in FORM_PART_MARKERS.get(form, {}))
    output = directory / f"{form_id}.docx"
    with contextlib.redirect_stderr(io.StringIO()), \
            contextlib.redirect_stdout(io.StringIO()):
        fill(SKILL_ROOT / spec["template"], form_context, body, output, form=form)
    return output


def _leftover_tokens(path: Path) -> set[str]:
    tokens: set[str] = set()
    with zipfile.ZipFile(path) as package:
        for name in package.namelist():
            if name.startswith("word/") and name.endswith(".xml"):
                text = re.sub(r"<[^>]+>", "", package.read(name).decode("utf-8"))
                tokens |= set(VERIFY.PLACEHOLDER_RX.findall(text))
    return tokens


def _document_text(path: Path) -> str:
    with zipfile.ZipFile(path) as package:
        return re.sub(r"<[^>]+>", "", package.read("word/document.xml").decode("utf-8"))


class LeaveBlankContractTests(unittest.TestCase):
    def test_fill_leave_blank_is_a_subset_of_the_shared_verifier(self) -> None:
        """A token the fill code refuses to touch must be one the verifier tolerates."""
        self.assertEqual(set(), LEAVE_BLANK - VERIFY.LEAVE_BLANK)

    def test_firm_tokens_are_in_neither_leave_blank_list(self) -> None:
        """Firm details are filled from coclerk.json, so a survivor is a defect."""
        for token in FIRM_TOKENS:
            with self.subTest(token=token):
                self.assertNotIn(token, LEAVE_BLANK)
                self.assertNotIn(token, VERIFY.LEAVE_BLANK)

    def test_every_form_leaves_only_tolerated_tokens(self) -> None:
        context = dict(RENDER_CONTEXT)
        context["firm_fax"] = ""
        tolerated = VERIFY.LEAVE_BLANK | KNOWN_UNRECONCILED
        with tempfile.TemporaryDirectory() as temporary:
            for form_id, spec in _plain_forms():
                with self.subTest(form=form_id):
                    output = _render(form_id, spec, context, Path(temporary))
                    self.assertEqual(set(), _leftover_tokens(output) - tolerated)

    def test_forms_1_and_4_fill_the_address_for_service_block(self) -> None:
        """An empty fax blanks its line; it never leaves the token standing."""
        context = dict(RENDER_CONTEXT)
        context["firm_fax"] = ""
        with tempfile.TemporaryDirectory() as temporary:
            for form_id, spec in _plain_forms():
                if spec["fill_form_arg"] not in ("nocc", "rtc"):
                    continue
                with self.subTest(form=form_id):
                    text = _document_text(
                        _render(form_id, spec, context, Path(temporary)))
                    for token in FIRM_TOKENS:
                        self.assertNotIn(token, text)
                    self.assertIn(context["firm_address"], text)
                    self.assertIn(context["firm_email"], text)

    def test_form_1_and_4_keep_the_address_token_when_no_firm_is_configured(self) -> None:
        """No firm block means no address for service -- the token must survive
        for the verifier to catch, never a silently blank address."""
        context = {key: value for key, value in RENDER_CONTEXT.items()
                   if not key.startswith("firm_")}
        with tempfile.TemporaryDirectory() as temporary:
            for form_id, spec in _plain_forms():
                if spec["fill_form_arg"] not in ("nocc", "rtc"):
                    continue
                with self.subTest(form=form_id):
                    text = _document_text(
                        _render(form_id, spec, context, Path(temporary)))
                    self.assertIn("[FIRM ADDRESS]", text)


if __name__ == "__main__":
    unittest.main()
