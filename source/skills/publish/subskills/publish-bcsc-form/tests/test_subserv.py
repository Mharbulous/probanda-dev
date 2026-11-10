"""Form 16 substituted-service variant — regression and behaviour tests.

Run from anywhere:  python tests/test_subserv.py
No test framework: plain asserts, one function per behaviour, failures print
the offending value.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

from lxml import etree  # noqa: E402

import fill_plain  # noqa: E402
from fill_plain import (  # noqa: E402
    build_compliance_table,
    fill,
    validate_substituted_service,
)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
TEMPLATE = SKILL_ROOT / "templates" / "016-aos.docx"

# The base-mode rendering of BASE_CONTEXT after the prescribed caption refactor.
# Update this deliberately: a change means base Form 16 output moved.
# Any movement requires a semantic comparison before acceptance.
#
# Re-baselined for #770, which runs each role group's parties together as one
# prose list. The semantic comparison: this fixture has two defendants, and the
# caption moved from two centred paragraphs to the single paragraph
# "MEI LIN TAN, and WEN LI HAO". Nothing else in the document changed.
BASE_DOCUMENT_SHA256 = (
    "161c1abf79d622adf2d589ffdd340aeb1121a49e5ec626d2d4948e31ea16913a")

COMMON = {
    "court_file_number": "S-000000",
    "registry": "Vancouver",
    "plaintiff_caption": "ACME HOLDINGS INC.",
    "plaintiff_role": "Plaintiff",
    "defendant_caption": "MEI LIN TAN\nWEN LI HAO",
    "defendant_role": "Defendants",
    "deponent_name": "Morgan Chen",
    "deponent_address": "#320 - 240 Cambie Street, Vancouver, BC",
    "deponent_occupation": "Legal Assistant",
    "swear_or_affirm": "affirm",
    "sworn_or_affirmed": "AFFIRMED",
    "affidavit_date": "August 6, 2026",
    "commissioner_city": "Vancouver",
    "sworn_by_video": "no",
}

BASE_CONTEXT = {
    **COMMON,
    "court_file_number": "S-290003",
    "plaintiff_caption": "HARBOURLINE REAL ESTATE SERVICES INC.",
    "commissioner_name": "",
    "person_served": "Mei Lin Tan",
    "service_date": "June 10, 2026",
    "service_time": "2:15 p.m.",
    "filed_documents": [
        {"description": "Notice of Civil Claim", "stamp_date": "May 26, 2025"}],
    "unfiled_documents": [{"description": "a letter dated June 8, 2026"}],
    "service_method": "email",
    "service_email": "m.tan4180@example.com",
    "service_address": "",
    "service_fax": "",
}

# A generic two-defendant order: e-mail plus two mailing addresses per
# defendant, the order served with the pleading, one courtesy copy.
SUBSERV_CONTEXT = {
    **COMMON,
    "service_mode": "substituted",
    "service_date": "June 10, 2026",
    "service_time": "",
    "filed_documents": [
        {"description": "Notice of Civil Claim filed in this action",
         "stamp_date": "May 26, 2025"},
        {"description": "Order Made after Application permitting "
                        "substitutional service (the “Order”)",
         "stamp_date": "May 29, 2026"},
    ],
    "unfiled_documents": [],
    "parties_served": [
        {"name": "Wen Li Hao", "methods": [
            {"kind": "email", "detail": "first@example.com", "ordered": True},
            {"kind": "ordinary_mail", "detail": "the addresses in the Order",
             "ordered": True,
             "addresses": ["Wen Li Hao\n2207 Example Road\nRichmond, BC",
                           "Wen Li Hao\n3318 Example Avenue\nVancouver, BC"]},
        ]},
        {"name": "Mei Lin Tan", "methods": [
            {"kind": "email", "detail": "second@example.com", "ordered": True},
            {"kind": "ordinary_mail", "detail": "the addresses in the Order",
             "ordered": True,
             "addresses": ["Mei Lin Tan\n2207 Example Road\nRichmond, BC",
                           "Mei Lin Tan\n3318 Example Avenue\nVancouver, BC"]},
            {"kind": "email", "detail": "courtesy@example.com", "ordered": False},
        ]},
    ],
    "service_exhibits": [
        {"description": "the e-mail sent to the addresses in section 2"}],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _render(context: dict) -> tuple[list[str], bytes]:
    """Fill the template and return (paragraph texts, document.xml bytes)."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.docx"
        fill(TEMPLATE, context, "", out, form="aos")
        document = zipfile.ZipFile(out).read("word/document.xml")
    root = etree.fromstring(document)
    body = root.find(f"{{{W}}}body")
    texts = ["".join(t.text or "" for t in child.iter(f"{{{W}}}t"))
             for child in body]
    return texts, document


def _numbered(context: dict) -> list[str]:
    """The top-level numbered paragraphs, in document order."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.docx"
        fill(TEMPLATE, context, "", out, form="aos")
        document = zipfile.ZipFile(out).read("word/document.xml")
    body = etree.fromstring(document).find(f"{{{W}}}body")
    result = []
    for para in body.iter(f"{{{W}}}p"):
        ppr = para.find(f"{{{W}}}pPr")
        style = ppr.find(f"{{{W}}}pStyle") if ppr is not None else None
        if style is not None and style.get(f"{{{W}}}val") == "LEAPBCParaNumL1":
            result.append("".join(t.text or "" for t in para.iter(f"{{{W}}}t")))
    return result


def _refuses(context: dict, fragment: str) -> None:
    try:
        validate_substituted_service(context)
    except ValueError as e:
        assert fragment.lower() in str(e).lower(), \
            f"refusal did not mention {fragment!r}: {e}"
        return
    raise AssertionError(f"expected a refusal mentioning {fragment!r}")


def _without(context: dict, **overrides) -> dict:
    merged = json.loads(json.dumps(context))
    merged.update(overrides)
    return merged


# ---------------------------------------------------------------------------
# Base-mode regression
# ---------------------------------------------------------------------------

def test_base_mode_output_unchanged():
    _texts, document = _render(BASE_CONTEXT)
    digest = hashlib.sha256(document).hexdigest()
    assert digest == BASE_DOCUMENT_SHA256, (
        f"base Form 16 output changed: {digest}")


def test_base_mode_keeps_one_method_branch():
    texts, _ = _render(BASE_CONTEXT)
    assert "AFFIDAVIT OF ORDINARY SERVICE" in texts
    assert any("e-mailing the document to m.tan4180@example.com" in t
               for t in texts)
    assert not any("mailing the document by ordinary mail" in t for t in texts)
    assert not any(t.startswith("(a)") for t in texts)


# ---------------------------------------------------------------------------
# Variant structure
# ---------------------------------------------------------------------------

def test_variant_title_and_leads():
    texts, _ = _render(SUBSERV_CONTEXT)
    assert "AFFIDAVIT OF SUBSTITUTED SERVICE" in texts
    assert "AFFIDAVIT OF ORDINARY SERVICE" not in texts
    # No time collected: the lead sentence omits the time clause entirely.
    assert "1On June 10, 2026, I served Wen Li Hao and Mei Lin Tan with" in texts
    assert any("in accordance with the Order" in t for t in texts)


def test_variant_mirrors_party_and_method_order():
    texts, _ = _render(SUBSERV_CONTEXT)
    structure = [t for t in texts if t.startswith(("(a)", "(b)", "(i)", "(ii)"))]
    assert structure == [
        "(a)In respect of Wen Li Hao, by:",
        "(i)sending the document by e-mail to first@example.com",
        "(ii)mailing the document by ordinary mail to:",
        "(b)In respect of Mei Lin Tan, by:",
        "(i)sending the document by e-mail to second@example.com",
        "(ii)mailing the document by ordinary mail to:",
    ], structure


def test_variant_renders_every_ordered_address():
    texts, _ = _render(SUBSERV_CONTEXT)
    for line in ("2207 Example Road", "3318 Example Avenue"):
        assert sum(1 for t in texts if t == line) == 2, \
            f"{line!r} should appear once per defendant"


def test_courtesy_act_is_outside_the_mirrored_structure():
    texts, _ = _render(SUBSERV_CONTEXT)
    courtesy = [t for t in texts if "courtesy@example.com" in t]
    assert len(courtesy) == 1, courtesy
    assert courtesy[0].startswith("3"), courtesy[0]
    assert "not as a step required by the Order" in courtesy[0]


def test_one_transmission_yields_one_exhibit():
    texts, _ = _render(SUBSERV_CONTEXT)
    exhibits = [t for t in texts if "marked as Exhibit" in t]
    assert len(exhibits) == 1, exhibits
    assert "Exhibit A" in exhibits[0]


def test_numbered_paragraphs_are_sequential():
    numbered = _numbered(SUBSERV_CONTEXT)
    assert [t[0] for t in numbered] == ["1", "2", "3", "4"], numbered


def test_no_identifier_block_no_interpreter_blank_commissioner():
    texts, _ = _render(SUBSERV_CONTEXT)
    joined = "\n".join(texts)
    assert "[ORDINAL]" not in joined
    assert "This is the" not in joined, "Rule 22-2(3) identifier block present"
    assert "Endorsement of Interpreter" not in joined
    assert not any(SUBSERV_CONTEXT["deponent_name"] in t for t in texts[-3:]), \
        "the line under the jurat must stay blank for the commissioner's stamp"


def test_video_conference_statements_are_last_numbered_paragraphs():
    numbered = _numbered(_without(SUBSERV_CONTEXT, sworn_by_video="yes"))
    assert [t[0] for t in numbered] == ["1", "2", "3", "4", "5", "6"], numbered
    assert "not physically present" in numbered[-1]
    assert "solemnity" in numbered[-2]


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------

def test_refuses_without_parties():
    _refuses(_without(SUBSERV_CONTEXT, parties_served=[]), "parties_served")


def test_refuses_party_without_methods():
    ctx = _without(SUBSERV_CONTEXT)
    ctx["parties_served"][0]["methods"] = []
    _refuses(ctx, "no methods")


def test_refuses_method_without_detail():
    ctx = _without(SUBSERV_CONTEXT)
    ctx["parties_served"][0]["methods"][0]["detail"] = ""
    _refuses(ctx, "no detail")


def test_refuses_unknown_method_kind():
    ctx = _without(SUBSERV_CONTEXT)
    ctx["parties_served"][0]["methods"][0]["kind"] = "carrier pigeon"
    _refuses(ctx, "not one of")


def test_refuses_when_the_order_is_not_among_the_documents_served():
    ctx = _without(SUBSERV_CONTEXT)
    ctx["filed_documents"] = [ctx["filed_documents"][0]]
    _refuses(ctx, "4-4(2)")


# ---------------------------------------------------------------------------
# Mirror validation
# ---------------------------------------------------------------------------

def test_compliance_table_covers_every_ordered_method():
    table = build_compliance_table(SUBSERV_CONTEXT)
    assert "All order terms are covered." in table
    for cell in ("2(a)(i)", "2(a)(ii)", "2(b)(i)", "2(b)(ii)"):
        assert cell in table, f"{cell} missing from:\n{table}"
    assert "courtesy" in table


def test_compliance_table_flags_an_unperformed_order_term():
    ctx = _without(SUBSERV_CONTEXT)
    ctx["parties_served"][0]["methods"][1]["performed"] = False
    table = build_compliance_table(ctx)
    assert "NOT DEPOSED" in table
    assert "1 order term(s) are NOT covered" in table
    # The act was not done, so it is not deposed to either: one method item
    # disappears from the mirrored structure, and the flag is the only notice.
    texts, _ = _render(ctx)
    assert sum(1 for t in texts if t.startswith("(ii)")) == 1


# ---------------------------------------------------------------------------
# Harness routing and step wiring
# ---------------------------------------------------------------------------

def _harness():
    os.environ["DRAFT_BCSC_SESSIONS_DIR"] = tempfile.mkdtemp()
    import importlib
    import harness
    importlib.reload(harness)
    harness.load_all_steps()
    return harness


def _classify(harness, request: str, **data) -> dict:
    action = harness.cmd_init(request)
    payload = {"mode": "regular", "form_id": "form-16", "form_name": "Form 16",
               "registered": True, "op_id": "generate", "confidence": 0.95,
               "ambiguous": False}
    payload.update(data)
    result = harness.cmd_classify(
        action["session_id"],
        json.dumps({"kind": "step_result", "data": payload}))
    return harness.load_ctx(result.get("session_id", action["session_id"]))


def test_substituted_request_routes_to_the_order_ingesting_sequence():
    harness = _harness()
    ctx = _classify(harness, "Draft an affidavit of substituted service",
                    service_mode="substituted")
    assert ctx["sequence"] == "generate-subserv", ctx["sequence"]
    assert harness.SEQUENCES[ctx["sequence"]][1] == "gen.order"


def test_ordinary_request_keeps_the_plain_generate_sequence():
    harness = _harness()
    ctx = _classify(harness, "Draft an affidavit of ordinary service",
                    service_mode="ordinary")
    assert ctx["sequence"] == "generate", ctx["sequence"]


def test_order_extraction_lands_in_the_scalars():
    _harness()
    from steps.gen import order
    extraction = {
        "order_document": {"description": "Order permitting substitutional "
                                          "service", "stamp_date": "May 29, 2026"},
        "parties_served": SUBSERV_CONTEXT["parties_served"],
    }
    ok, err = order.validate({"extraction": extraction}, {})
    assert ok, err
    ctx = order.apply({"scalars": {}}, {"extraction": extraction,
                                        "confirmed": True})
    assert ctx["scalars"]["parties_served"][0]["name"] == "Wen Li Hao"


def test_order_extraction_refuses_a_party_without_methods():
    _harness()
    from steps.gen import order
    ok, err = order.validate({"extraction": {
        "order_document": {"description": "Order", "stamp_date": "May 29, 2026"},
        "parties_served": [{"name": "Someone", "methods": []}]}}, {})
    assert not ok and "no methods" in err, err


def test_order_extraction_refuses_an_order_without_its_stamp_date():
    _harness()
    from steps.gen import order
    ok, err = order.validate({"extraction": {
        "order_document": {"description": "Order"},
        "parties_served": SUBSERV_CONTEXT["parties_served"]}}, {})
    assert not ok and "stamp date" in err, err


def test_variant_file_name_is_dated_and_tagged():
    _harness()
    from steps.gen import scalars as gen_scalars
    ctx = {"form_id": "form-16", "service_mode": "substituted",
           "scalars": {"parties_served": []},
           "order_extraction": {"order_document": {
               "description": "Order permitting substitutional service",
               "stamp_date": "May 29, 2026"}}}
    result = {"confirmed": True, "scalars": {
        "deponent_name": "Morgan Chen", "affidavit_date": "August 6, 2026",
        "docs_summary": "NOCC and Order", "swear_or_affirm": "affirm",
        "filed_documents": [], "service_date": "June 10, 2026"}}
    ctx = gen_scalars.apply(ctx, result)
    assert ctx["scalars"]["title"] == \
        "2026-08-06 AOSS ChenM re service of NOCC and Order", \
        ctx["scalars"]["title"]
    # Rule 4-4(2): the entered order is always among the documents served.
    assert ctx["scalars"]["filed_documents"][0]["description"].startswith("Order")


def test_scalars_refuse_an_unparseable_affidavit_date():
    _harness()
    from steps.gen import scalars as gen_scalars
    ctx = {"form_id": "form-16", "service_mode": "substituted"}
    ok, err = gen_scalars.validate(
        {"scalars": {"affidavit_date": "next Tuesday",
                     "service_date": "June 10, 2026",
                     "docs_summary": "NOCC and Order"}}, ctx)
    assert not ok and "affidavit_date" in err, err


# ---------------------------------------------------------------------------

def main() -> int:
    tests = [(name, fn) for name, fn in sorted(globals().items())
             if name.startswith("test_") and callable(fn)]
    failures = []
    for name, fn in tests:
        try:
            fn()
            print(f"  ok   {name}")
        except AssertionError as e:
            failures.append((name, e))
            print(f"  FAIL {name}: {e}")
    print(f"\n{len(tests) - len(failures)}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
