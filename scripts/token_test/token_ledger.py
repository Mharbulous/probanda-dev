#!/usr/bin/env python3
"""
Price every Cowork subagent run from its transcript, for the token-efficiency tests.

Cowork writes each session as <project>/<session>.jsonl and each of its subagents as
<project>/<session>/subagents/agent-<id>.jsonl, with a meta.json beside it. A test run is
found by its tag: a user message holding a line `RUN <experiment>-<cell>-<doc>-<rep>`, or a
fork's `Your directive: RUN ...`. Each tagged message starts a new run in the transcript, so a
subagent resumed by SendMessage with its own RUN line gets its own row. Calls before the
transcript's first user message are the parent's, copied into a fork, and are not counted.

One API call can appear on several transcript lines (one per content block), each repeating
the call's usage. Lines are grouped by message id and the last line of each call is the one
counted, since it carries the final output count.

Writes two CSVs: one row per subagent run, and one row per session holding the
orchestrator's own totals (its main transcript, sidechain lines excluded).

Run: python scripts/token_test/token_ledger.py [ROOT ...] [--all]
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

# USD per million tokens: input, 5-minute cache write, 1-hour cache write, cache read, output.
# Thinking tokens are part of output_tokens and billed as output.
PRICES = {
    "haiku": (0.10, 0.125, 0.20, 0.01, 0.50),
    "sonnet": (2.00, 2.50, 4.00, 0.10, 10.00),
    "opus": (4.00, 5.00, 8.00, 0.20, 20.00),
}

TOKEN_FIELDS = ["input", "cache_write_5m", "cache_write_1h", "cache_read", "output", "thinking"]
RUN_COLUMNS = ["tag", "experiment", "cell", "doc", "rep", "session", "agent_id", "agent_type",
               "model", "effort", "calls"] + TOKEN_FIELDS + ["cost_usd"]
SESSION_COLUMNS = ["session", "subagent_runs", "model", "calls"] + TOKEN_FIELDS + ["cost_usd"]

TAG_RE = re.compile(r"^\s*(?:Your directive:\s*)?RUN\s+(\S+)", re.MULTILINE)
DEFAULT_ROOT = Path.home() / "AppData" / "Roaming" / "Claude" / "local-agent-mode-sessions"
DEFAULT_OUT = Path.home() / "token-test" / "results"


def parse_tag(tag):
    """Split `<experiment>-<cell>-<doc>-<rep>`; the cell may itself hold hyphens."""
    parts = tag.split("-")
    if len(parts) < 4:
        raise ValueError(f"RUN tag {tag!r} is not <experiment>-<cell>-<doc>-<rep>")
    return {"experiment": parts[0], "cell": "-".join(parts[1:-2]), "doc": parts[-2], "rep": parts[-1]}


def price_for(model):
    for family, prices in PRICES.items():
        if family in model:
            return prices
    raise ValueError(f"no price for model {model!r}: add it to PRICES")


def call_tokens(usage, where):
    created = usage.get("cache_creation_input_tokens", 0)
    split = usage.get("cache_creation")
    if split is None:
        if created:
            raise ValueError(f"{where}: cache writes of {created} tokens carry no 5m/1h split")
        split = {}
    return {
        "input": usage.get("input_tokens", 0),
        "cache_write_5m": split.get("ephemeral_5m_input_tokens", 0),
        "cache_write_1h": split.get("ephemeral_1h_input_tokens", 0),
        "cache_read": usage.get("cache_read_input_tokens", 0),
        "output": usage.get("output_tokens", 0),
        "thinking": (usage.get("output_tokens_details") or {}).get("thinking_tokens", 0),
    }


def call_cost(model, tokens):
    p_in, p_5m, p_1h, p_read, p_out = price_for(model)
    return (tokens["input"] * p_in + tokens["cache_write_5m"] * p_5m + tokens["cache_write_1h"] * p_1h
            + tokens["cache_read"] * p_read + tokens["output"] * p_out) / 1_000_000


def user_text(line):
    content = (line.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content or [] if b.get("type") == "text")


def split_runs(lines):
    """Split one subagent transcript into (tag, lines) runs, starting at its first user message."""
    runs = []
    for line in lines:
        if line.get("type") == "user":
            match = TAG_RE.search(user_text(line))
            if match or not runs:
                runs.append((match.group(1) if match else "", []))
        if runs:
            runs[-1][1].append(line)
    return runs


def total(lines, where, skip_sidechain=False):
    """Sum one transcript's API calls, each counted once."""
    calls = {}
    for line in lines:
        if line.get("type") != "assistant" or (skip_sidechain and line.get("isSidechain")):
            continue
        message = line.get("message") or {}
        if not message.get("usage") or message.get("model") == "<synthetic>":
            continue
        calls[message.get("id") or line.get("requestId")] = (message["model"], line.get("effort", ""),
                                                             message["usage"])
    row = {field: 0 for field in TOKEN_FIELDS}
    cost, models, efforts = 0.0, [], []
    for call_id, (model, effort, usage) in calls.items():
        tokens = call_tokens(usage, f"{where} call {call_id}")
        for field in TOKEN_FIELDS:
            row[field] += tokens[field]
        cost += call_cost(model, tokens)
        models += [model] if model not in models else []
        efforts += [effort] if effort and effort not in efforts else []
    row.update(calls=len(calls), cost_usd=round(cost, 8), model="+".join(models), effort="+".join(efforts))
    return row


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def ledger(roots, include_untagged=False):
    runs, sessions, mains = [], [], {}
    for root in roots:
        for path in sorted(Path(root).rglob("subagents/agent-*.jsonl")):
            meta_path = path.with_suffix(".meta.json")
            meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
            for tag, lines in split_runs(read_jsonl(path)):
                if not tag and not include_untagged:
                    continue
                row = {"tag": tag, **(parse_tag(tag) if tag else {"experiment": "", "cell": "", "doc": "", "rep": ""}),
                       "session": path.parent.parent.name, "agent_id": path.stem.removeprefix("agent-"),
                       "agent_type": meta.get("agentType", "")}
                row.update(total(lines, f"{path} run {tag or '(untagged)'}"))
                runs.append(row)
                mains[row["session"]] = path.parent.parent.parent / f"{row['session']}.jsonl"
    for session, main in mains.items():
        row = {"session": session, "subagent_runs": sum(r["session"] == session for r in runs)}
        row.update(total(read_jsonl(main), str(main), skip_sidechain=True))
        row.pop("effort")
        sessions.append(row)
    return runs, sessions


def write_csv(path, columns, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("roots", nargs="*", type=Path, default=[DEFAULT_ROOT],
                        help="folders searched for Cowork transcripts (default: %(default)s)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="results folder (default: %(default)s)")
    parser.add_argument("--all", action="store_true", help="include subagent runs with no RUN tag")
    args = parser.parse_args(argv)
    runs, sessions = ledger(args.roots, include_untagged=args.all)
    write_csv(args.out / "ledger.csv", RUN_COLUMNS, runs)
    write_csv(args.out / "sessions.csv", SESSION_COLUMNS, sessions)
    print(f"{len(runs)} subagent runs in {len(sessions)} sessions -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
