#!/usr/bin/env python3
"""
measure_bill_run: numbers for one billing run, from its Claude Code transcripts.

  python scripts/measure_bill_run.py <main.jsonl> [<subagent.jsonl> ...]

Give the run's main transcript and, by shell glob, its subagents/*.jsonl files. A file
whose user or assistant rows say isSidechain is a subagent, any other is the main
session, and exactly one main session is required.

It prints numbers and model names only: tokens per session and per model, the subagent
count, the questions asked of the practitioner, and the minutes from the first message
to the last. It never prints a path, a file name or any text from a transcript, and it
reads no .meta.json file. A maintainer script: no plugin ships it.

Tokens: an assistant message is written once per content block, with the same usage
each time, so each message id counts once. "In" is fresh input plus cache writes plus
cache reads.

Questions: AskUserQuestion calls plus wrap_up calls that carry an ask. A question
written as plain text is not counted. The practitioner's typed messages (user rows whose
origin kind is "human", slash commands included) are counted too, as a second measure;
a transcript that records no origin prints "not recorded".

Exit 0: printed. Exit 2: the files could not be read or do not hold exactly one main session.
"""

import argparse
import json
import sys
from datetime import datetime

TOKEN_FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")


class InputError(Exception):
    pass


def new_tokens():
    return dict.fromkeys(TOKEN_FIELDS, 0)


def read_rows(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    except (OSError, ValueError):
        raise InputError("a transcript could not be read as JSON lines") from None
    return rows


def blocks(row):
    content = (row.get("message") or {}).get("content")
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def is_typed(row):
    return (row.get("origin") or {}).get("kind") == "human" and not row.get("isMeta")


def read_session(path):
    rows = [r for r in read_rows(path) if r.get("type") in ("user", "assistant")]
    session = {
        "sidechain": any(r.get("isSidechain") for r in rows),
        "models": {},
        "messages": 0,
        "ask_user_question": 0,
        "wrap_up_ask": 0,
        "agent_calls": 0,
        "typed": 0,
        "origin_recorded": any("origin" in r for r in rows),
        "times": [],
    }
    seen_messages, seen_calls = set(), set()
    for row in rows:
        if row.get("timestamp"):
            session["times"].append(datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00")))
        if row["type"] == "user":
            session["typed"] += is_typed(row)
            continue
        message = row.get("message") or {}
        usage, message_id = message.get("usage"), message.get("id")
        if isinstance(usage, dict) and (message_id is None or message_id not in seen_messages):
            seen_messages.add(message_id)
            session["messages"] += 1
            totals = session["models"].setdefault(message.get("model") or "unknown", new_tokens())
            for field in TOKEN_FIELDS:
                totals[field] += usage.get(field) or 0
        for block in blocks(row):
            if block.get("type") != "tool_use" or block.get("id") in seen_calls:
                continue
            seen_calls.add(block.get("id"))
            name, args = block.get("name") or "", block.get("input") or {}
            session["ask_user_question"] += name == "AskUserQuestion"
            session["wrap_up_ask"] += name.endswith("wrap_up") and bool(str(args.get("ask") or "").strip())
            session["agent_calls"] += name == "Agent"
    return session


def sum_tokens(parts):
    total = new_tokens()
    for part in parts:
        for field in TOKEN_FIELDS:
            total[field] += part[field]
    return total


def tokens_line(tokens):
    fresh, write, read, out = (tokens[f] for f in TOKEN_FIELDS)
    return f"in {fresh + write + read} (fresh {fresh}, cache write {write}, cache read {read}), out {out}"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("transcripts", nargs="+")
    paths = parser.parse_args(argv).transcripts
    try:
        sessions = [read_session(p) for p in paths]
    except InputError as error:
        print(error, file=sys.stderr)
        return 2
    mains = [s for s in sessions if not s["sidechain"]]
    if len(mains) != 1:
        print(f"expected exactly one main session, found {len(mains)}", file=sys.stderr)
        return 2
    main_session = mains[0]
    subagents = [s for s in sessions if s["sidechain"]]
    labelled = [("main", main_session)] + [(f"subagent {i}", s) for i, s in enumerate(subagents, 1)]

    for label, session in labelled:
        print(f"{label}: {session['messages']} messages, {tokens_line(sum_tokens(session['models'].values()))}")
        for model, tokens in sorted(session["models"].items()):
            print(f"  {model}: {tokens_line(tokens)}")
    all_models = {}
    for _, session in labelled:
        for model, tokens in session["models"].items():
            all_models[model] = sum_tokens([all_models.get(model, new_tokens()), tokens])
    print(f"total: {tokens_line(sum_tokens(all_models.values()))}")
    for model, tokens in sorted(all_models.items()):
        print(f"  {model}: {tokens_line(tokens)}")

    asked = main_session["ask_user_question"] + main_session["wrap_up_ask"]
    print(f"subagents: {len(subagents)} (Agent calls in main: {main_session['agent_calls']})")
    print(
        f"questions asked of the practitioner: {asked} "
        f"(AskUserQuestion {main_session['ask_user_question']}, wrap_up with an ask {main_session['wrap_up_ask']}; "
        "plain-text questions are not counted)"
    )
    typed = main_session["typed"] if main_session["origin_recorded"] else "not recorded"
    print(f"messages typed by the practitioner: {typed}")
    times = [t for _, s in labelled for t in s["times"]]
    if times:
        print(f"minutes, first message to last: {(max(times) - min(times)).total_seconds() / 60:.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
