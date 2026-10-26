"""Render Form 63 -- Default Judgment Bill of Costs -- from a context JSON.

Usage:
    python fill_form63.py --context ctx.json --out "matter/0. DRAFT/<Writing folder>/Form 63 ... .md"
    python fill_form63.py --context ctx.json --out "... .md" --docx-dir "matter/0. DRAFT" --out-name STEM

`--out` writes the markdown mockup, rewritten in place. `--docx-dir` and
`--out-name`, given together, additionally fill templates/063-djboc.dotx and
write the filed Word copy at the root of the draft folder `--docx-dir` names,
an existing folder never created here, as `<stem>.docx`. The stem is composed
by the caller under the firm's file naming convention. A stem that is empty,
carries \\ / : * ? " < > |, ends in a file extension or ends in " v<n>" is
refused, as is a `--docx-dir` that is not a folder: `error: <code>: ...` on
stderr, exit 1, nothing written, not even the markdown.

An existing .docx is never overwritten. `<stem>.docx` counts as v1 and
`<stem> vN.docx` as vN: with none present the unsuffixed name is written, else
v(highest + 1). The second `Written:` line names the .docx actually written,
and a `Versioned from:` line names the highest existing copy. The .docx is
filled into a `~`-prefixed temporary file in the same folder and then renamed.

Context JSON schema and rendering rules: see
publish-boc/references/schedule-1.md and the sibling form63.py. All arithmetic
(Schedule 1 banding, subtotals, totals) is computed by the engine's
`form63.compute` -- never passed in pre-computed, and never re-derived here.

templates/063-djboc.dotx is a reconstruction of the prescribed form built from
the layout form63.render emits, not a conversion of a supplied Word document
(issue #713, open question 1). The binary is the source of truth: edit it in
Word, not by regenerating it.

Requires: lxml  (for --docx-dir only)
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
import zipfile
from pathlib import Path

import form63
from free_path import check_target, write_new

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "templates" / "063-djboc.dotx"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_SPC = "{http://www.w3.org/XML/1998/namespace}space"

# Unescaped counterpart of form63._DATE_PLACEHOLDER: Word shows the brackets
# literally, so the markdown escaping would leak backslashes onto the face.
DATE_PLACEHOLDER = "............[dd/mmm/yyyy]............"


def WN(tag: str) -> str:
    return f"{{{W}}}{tag}"


def substitute(scope, subs: dict[str, str]) -> None:
    """Substring-replace bracket placeholders in every <w:t> under `scope`.

    Substring rather than whole-cell replacement so run properties -- the bold
    on a total, the italics on a party role -- survive the fill.
    """
    for t_el in scope.iter(WN("t")):
        txt = t_el.text or ""
        new = txt
        for ph, val in subs.items():
            if ph in new:
                new = new.replace(ph, val)
        if new != txt:
            t_el.text = new
            t_el.set(XML_SPC, "preserve")


def row_text(tr) -> str:
    return "".join(t.text or "" for t in tr.iter(WN("t")))


def fill_disbursements(body, disbursements: list[dict]) -> None:
    """Duplicate the single disbursement template row, one copy per entry."""
    template_row = next(
        tr for tr in body.iter(WN("tr")) if "[F63 DISB DESCRIPTION]" in row_text(tr)
    )
    tbl = template_row.getparent()
    insert_idx = list(tbl).index(template_row)
    tbl.remove(template_row)

    for i, disb in enumerate(disbursements):
        new_row = copy.deepcopy(template_row)
        substitute(
            new_row,
            {
                "[F63 DISB DESCRIPTION]": disb["description"],
                "[F63 DISB CLAIMED]": form63._fmt_money(disb["amount"]),
            },
        )
        tbl.insert(insert_idx + i, new_row)


def build_scalars(fig: dict) -> dict[str, str]:
    date = fig["date"]
    return {
        "[REGISTRY]": fig["registry"],
        "[COURT FILE NUMBER]": fig["court_file_number"],
        "[PLAINTIFFS]": fig["plaintiffs"],
        "[PLAINTIFF ROLE]": fig["plaintiff_role"],
        "[DEFENDANTS]": fig["defendants"],
        "[DEFENDANT ROLE]": fig["defendant_role"],
        "[PARTY CLAIMING COSTS]": fig["party_claiming_costs"],
        "[AMOUNT INVOLVED]": form63._fmt_optional(
            fig["amount_involved"], form63._NO_AMOUNT
        ),
        "[F63 COSTS DESCRIPTION]": fig["costs_description"],
        "[F63 SCHED1 CLAIMED]": form63._fmt_money(fig["schedule_1_costs"]),
        "[F63 ADDITIONAL CLAIMED]": form63._fmt_optional(
            fig["additional_costs"], form63._DOTTED
        ),
        "[F63 COSTS TOTAL CLAIMED]": form63._fmt_money(fig["costs_total"]),
        "[F63 DISB TAXES CLAIMED]": form63._fmt_optional(
            fig["disbursement_taxes"], form63._DOTTED
        ),
        "[F63 DISB TOTAL CLAIMED]": form63._fmt_money(fig["disbursement_total"]),
        "[F63 DATE]": date if date else DATE_PLACEHOLDER,
    }


def fill(fig: dict, out_path: Path, template_path: Path = TEMPLATE) -> None:
    from lxml import etree

    with zipfile.ZipFile(template_path) as zin:
        members = {n: zin.read(n) for n in zin.namelist()}

    root = etree.fromstring(members["word/document.xml"])
    body = root.find(WN("body"))

    fill_disbursements(body, fig["disbursements"])
    substitute(body, build_scalars(fig))

    ct = members["[Content_Types].xml"].decode("utf-8")
    members["[Content_Types].xml"] = ct.replace(
        "wordprocessingml.template.main+xml",
        "wordprocessingml.document.main+xml",
    ).encode("utf-8")
    members["word/document.xml"] = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True
    )

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in members.items():
            zout.writestr(name, data)


def main() -> int:
    p = argparse.ArgumentParser(
        description="Render Form 63 (Default Judgment Bill of Costs) from a context JSON."
    )
    p.add_argument("--context", required=True, help="Path to JSON context file")
    p.add_argument("--out", required=True, help="Output .md path")
    p.add_argument(
        "--docx-dir",
        help="Also fill 063-djboc.dotx and write the .docx at the root of this draft folder",
    )
    p.add_argument("--out-name", help="The .docx file name stem, no extension (with --docx-dir)")
    p.add_argument("--template", default=None, help="Override template path")
    args = p.parse_args()

    if (args.docx_dir is None) != (args.out_name is None):
        print("error: bad_input: --docx-dir and --out-name go together", file=sys.stderr)
        return 1
    if args.docx_dir is not None:
        refusal = check_target(args.docx_dir, args.out_name)
        if refusal:
            print(f"error: {refusal}", file=sys.stderr)
            return 1

    ctx = json.loads(Path(args.context).read_text(encoding="utf-8"))

    try:
        fig = form63.compute(ctx)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(form63.render(ctx), encoding="utf-8", newline="\n")
    print(f"Written: {out_path}")

    if args.docx_dir is not None:
        template = Path(args.template) if args.template else TEMPLATE
        try:
            docx_path, prior = write_new(args.docx_dir, args.out_name, ".docx",
                                         lambda tmp: fill(fig, tmp, template))
        except FileExistsError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        print(f"Written: {docx_path}")
        if prior:
            print(f"Versioned from: {prior}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
