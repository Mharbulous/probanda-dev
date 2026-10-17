#!/usr/bin/env python3
"""
Score token-efficiency test runs for accuracy, and price each correct result.

  names    Score proposed file names against the answer key, component by component
           (date, code, parties, re/encl/srv, subject, amount, folder). Deterministic.
  compare  Write one comparison file per extraction run, holding the gold facts and the
           run's output, for a scorer subagent to mark.
  summary  Join the ledger with the name scores and the scorer's marks into cost per
           correct name and cost per correct fact, per experiment cell.

Inputs:
  key CSV        doc,name,folder                     (doc is D###)
  proposals CSV  tag,name,folder                     (tag is the run's RUN tag)
  gold facts     <dir>/D###.json, a JSON list of fact strings
  run outputs    <dir>/<tag>.json, the extractor's JSON return
  marks          <dir>/<tag>.json, the scorer's return:
                 {"gold": [{"n": 1, "mark": "found|wrong|missing"}],
                  "extra": [{"n": 1, "mark": "supported|unsupported"}]}

Run: python scripts/token_test/score.py names|compare|summary --help
"""

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from token_ledger import parse_tag  # noqa: E402

COMPONENTS = ["date", "code", "parties", "flag", "subject", "amount", "folder"]
FLAGS = {"re", "encl", "srv"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
AMOUNT_RE = re.compile(r"^\$[\d,]+(\.\d+)?$")
EXT_RE = re.compile(r"\.(pdf|docx?|msg|eml|xlsx?)$", re.IGNORECASE)
GOLD_MARKS = {"found", "wrong", "missing"}
EXTRA_MARKS = {"supported", "unsupported"}
DEFAULT_DIR = Path.home() / "token-test"

SCORER_INSTRUCTIONS = """\
Mark this extraction run against the gold facts. Read only this file.

For each gold fact, mark it "found" (the run states it correctly), "wrong" (the run states it
with a material error) or "missing" (the run does not state it). Then number each claim in the
run's output that matches no gold fact, in the order it appears, and mark it "supported" (the
claim is a fair fact from the document that the key left out) or "unsupported".

Return only this JSON, with one entry per gold fact and one per extra claim:
{"gold": [{"n": 1, "mark": "found"}], "extra": [{"n": 1, "mark": "supported"}]}
"""


def split_name(name):
    """Split `YYYY-MM-DD CODE Party re/encl/srv Subject $Amount [STATUS]` into components."""
    tokens = EXT_RE.sub("", name).split()
    parts = {c: "" for c in COMPONENTS if c != "folder"}
    if tokens and DATE_RE.match(tokens[0]):
        parts["date"] = tokens.pop(0)
    if tokens:
        parts["code"] = tokens.pop(0)
    if tokens and tokens[0] not in FLAGS:
        parts["parties"] = tokens.pop(0)
    flags = []
    while tokens and tokens[0] in FLAGS:
        flags.append(tokens.pop(0))
    parts["flag"] = " ".join(flags)
    if tokens and AMOUNT_RE.match(tokens[-1]):
        parts["amount"] = tokens.pop()
    elif len(tokens) > 1 and AMOUNT_RE.match(tokens[-2]):
        parts["amount"] = tokens.pop(-2)
    parts["subject"] = " ".join(tokens)
    return parts


def norm(value):
    return " ".join(value.lower().replace("\\", "/").strip("/ ").split())


def score_name(proposed, proposed_folder, gold, gold_folder):
    p, g = split_name(proposed), split_name(gold)
    p["folder"], g["folder"] = proposed_folder, gold_folder
    marks = {c: int(norm(p[c]) == norm(g[c])) for c in COMPONENTS}
    marks["correct"] = int(all(marks[c] for c in COMPONENTS))
    return marks


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path, columns, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def names(key_path, proposals_path, out_path):
    key = {row["doc"]: row for row in read_csv(key_path)}
    rows = []
    for row in read_csv(proposals_path):
        doc = parse_tag(row["tag"])["doc"]
        if doc not in key:
            raise ValueError(f"run {row['tag']}: document {doc} is not in the key")
        gold = key[doc]
        rows.append({"tag": row["tag"], "doc": doc,
                     **score_name(row["name"], row["folder"], gold["name"], gold["folder"])})
    write_csv(out_path, ["tag", "doc"] + COMPONENTS + ["correct"], rows)
    return rows


def compare(gold_dir, runs_dir, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for run_path in sorted(Path(runs_dir).glob("*.json")):
        tag = run_path.stem
        doc = parse_tag(tag)["doc"]
        gold_path = Path(gold_dir) / f"{doc}.json"
        if not gold_path.exists():
            continue
        gold = json.loads(gold_path.read_text(encoding="utf-8"))
        run = json.loads(run_path.read_text(encoding="utf-8"))
        lines = [f"# Scoring {tag}", "", SCORER_INSTRUCTIONS, "## Gold facts", ""]
        lines += [f"{n}. {fact}" for n, fact in enumerate(gold, 1)]
        lines += ["", "## Run output", "", "```json", json.dumps(run, indent=2, ensure_ascii=False), "```", ""]
        dest = out_dir / f"{tag}.md"
        dest.write_text("\n".join(lines), encoding="utf-8")
        written.append(dest)
    return written


def read_marks(path, gold_count):
    marks = json.loads(Path(path).read_text(encoding="utf-8"))
    gold, extra = marks.get("gold", []), marks.get("extra", [])
    if len(gold) != gold_count or any(m["mark"] not in GOLD_MARKS for m in gold):
        raise ValueError(f"{path}: needs one found/wrong/missing mark for each of {gold_count} gold facts")
    if any(m["mark"] not in EXTRA_MARKS for m in extra):
        raise ValueError(f"{path}: an extra claim's mark is not supported/unsupported")
    return {"found": sum(m["mark"] == "found" for m in gold),
            "wrong": sum(m["mark"] == "wrong" for m in gold),
            "unsupported": sum(m["mark"] == "unsupported" for m in extra)}


def per_unit(cost, count):
    return round(cost / count, 6) if count else ""


def summary(ledger_path, out_path, names_path=None, marks_dir=None, gold_dir=None):
    names_by_tag = {r["tag"]: int(r["correct"]) for r in read_csv(names_path)} if names_path else {}
    cells = defaultdict(lambda: defaultdict(float))
    for run in read_csv(ledger_path):
        if not run["tag"]:
            continue
        cell = cells[(run["experiment"], run["cell"])]
        cell["runs"] += 1
        cell["cost_usd"] += float(run["cost_usd"])
        if run["tag"] in names_by_tag:
            cell["names_scored"] += 1
            cell["names_cost"] += float(run["cost_usd"])
            cell["names_correct"] += names_by_tag[run["tag"]]
        marks_path = Path(marks_dir) / f"{run['tag']}.json" if marks_dir else None
        if marks_path and marks_path.exists():
            gold = json.loads((Path(gold_dir) / f"{run['doc']}.json").read_text(encoding="utf-8"))
            marks = read_marks(marks_path, len(gold))
            cell["fact_runs"] += 1
            cell["facts_cost"] += float(run["cost_usd"])
            cell["gold_facts"] += len(gold)
            cell["facts_found"] += marks["found"]
            cell["facts_wrong"] += marks["wrong"]
            cell["extra_unsupported"] += marks["unsupported"]
    columns = ["experiment", "cell", "runs", "cost_usd", "names_scored", "names_correct",
               "cost_per_correct_name", "fact_runs", "gold_facts", "facts_found", "facts_wrong",
               "extra_unsupported", "cost_per_correct_fact"]
    rows = []
    for (experiment, cell_name), c in sorted(cells.items()):
        row = {"experiment": experiment, "cell": cell_name, "cost_usd": round(c["cost_usd"], 6)}
        for col in columns[2:]:
            if col not in row and not col.startswith("cost_per"):
                row[col] = int(c[col])
        # Each ratio uses only the cost of the runs that were scored that way.
        row["cost_per_correct_name"] = per_unit(c["names_cost"], c["names_correct"])
        row["cost_per_correct_fact"] = per_unit(c["facts_cost"], c["facts_found"])
        rows.append(row)
    write_csv(out_path, columns, rows)
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("names", help="score proposed names against the key")
    p.add_argument("--key", type=Path, default=DEFAULT_DIR / "key" / "names.csv")
    p.add_argument("--proposals", type=Path, required=True)
    p.add_argument("--out", type=Path, default=DEFAULT_DIR / "results" / "names_scored.csv")
    p = sub.add_parser("compare", help="write comparison files for the fact scorer")
    p.add_argument("--gold", type=Path, default=DEFAULT_DIR / "key" / "facts")
    p.add_argument("--runs", type=Path, required=True, help="folder of <tag>.json extractor returns")
    p.add_argument("--out", type=Path, default=DEFAULT_DIR / "results" / "compare")
    p = sub.add_parser("summary", help="cost per correct name and fact, per cell")
    p.add_argument("--ledger", type=Path, default=DEFAULT_DIR / "results" / "ledger.csv")
    p.add_argument("--names", type=Path, help="names_scored.csv from the names command")
    p.add_argument("--marks", type=Path, help="folder of <tag>.json scorer returns")
    p.add_argument("--gold", type=Path, default=DEFAULT_DIR / "key" / "facts")
    p.add_argument("--out", type=Path, default=DEFAULT_DIR / "results" / "summary.csv")
    args = parser.parse_args(argv)
    if args.command == "names":
        rows = names(args.key, args.proposals, args.out)
        print(f"{sum(r['correct'] for r in rows)} of {len(rows)} names correct -> {args.out}")
    elif args.command == "compare":
        print(f"{len(compare(args.gold, args.runs, args.out))} comparison files -> {args.out}")
    else:
        rows = summary(args.ledger, args.out, args.names, args.marks, args.gold)
        print(f"{len(rows)} cells -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
