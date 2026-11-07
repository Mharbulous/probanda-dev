"""Price-weighted token cost of one Claude Code session and all its subagents.

Usage: python session_cost.py <session.jsonl> [--since <ISO UTC time>] [--until <ISO UTC time>] [--json]

Reads the main transcript and every <session-id>/subagents/*.jsonl beside it,
counts each API response once (by message id), and prices it per model.
--since and --until keep only lines whose timestamp falls in that window, so a
session that planned before it executed can price the execution alone.
Copied from docs/Experiments/2026-11-06_cast-orchestration-cost/ on
exp/cast-orchestrated, with the time window added.
"""
import argparse
import json
from pathlib import Path

# $ per million tokens: input, output, cache read. Source: the claude-api
# skill's model table, cached 2026-10-06. Cache writes are not listed there,
# so they use the standard multipliers on input (5 min x1.25, 1 h x2).
PRICES = {
    "claude-fable-5-1": (10.00, 50.00, 0.25),
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
}
FAST_MULTIPLIER = 2.0


def in_window(stamp, since, until):
    """ISO stamps ending in Z compare correctly as text."""
    if stamp is None:
        return since is None and until is None
    return (since is None or stamp >= since) and (until is None or stamp < until)


def responses(path, since, until):
    """Return (model, usage) once per API response in one transcript, within the window."""
    seen = {}
    for line in path.open(encoding="utf-8"):
        row = json.loads(line)
        if row.get("type") != "assistant" or not in_window(row.get("timestamp"), since, until):
            continue
        msg = row.get("message") or {}
        usage = msg.get("usage")
        if not usage or not msg.get("id"):
            continue
        seen[msg["id"]] = (msg.get("model"), usage)
    return seen.values()


def cost(model, usage):
    inp, out, read = PRICES[model]
    cc = usage.get("cache_creation") or {}
    w1h = cc.get("ephemeral_1h_input_tokens", 0)
    w5m = cc.get("ephemeral_5m_input_tokens", 0)
    if not cc:
        w5m = usage.get("cache_creation_input_tokens", 0)
    dollars = (
        usage.get("input_tokens", 0) * inp
        + usage.get("output_tokens", 0) * out
        + usage.get("cache_read_input_tokens", 0) * read
        + w5m * inp * 1.25
        + w1h * inp * 2.0
    ) / 1e6
    if usage.get("speed") == "fast":
        dollars *= FAST_MULTIPLIER
    return dollars


def summarise(path, since, until):
    tally = {}
    for model, usage in responses(path, since, until):
        if model not in PRICES:
            if model == "<synthetic>":
                continue
            raise SystemExit(f"no price for model {model!r} in {path.name}")
        t = tally.setdefault(model, {"calls": 0, "input": 0, "output": 0,
                                     "cache_read": 0, "cache_write": 0, "usd": 0.0})
        t["calls"] += 1
        t["input"] += usage.get("input_tokens", 0)
        t["output"] += usage.get("output_tokens", 0)
        t["cache_read"] += usage.get("cache_read_input_tokens", 0)
        t["cache_write"] += usage.get("cache_creation_input_tokens", 0)
        t["usd"] += cost(model, usage)
    return tally


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("session", type=Path)
    parser.add_argument("--since")
    parser.add_argument("--until")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    sub_dir = args.session.with_suffix("") / "subagents"
    files = [("main", args.session)]
    for p in sorted(sub_dir.glob("*.jsonl")) if sub_dir.is_dir() else []:
        meta = p.with_suffix(".meta.json")
        label = p.stem
        if meta.exists():
            m = json.loads(meta.read_text(encoding="utf-8"))
            label = m.get("description") or m.get("agentType") or label
        files.append((label, p))
    report = []
    total = 0.0
    for label, p in files:
        for model, t in summarise(p, args.since, args.until).items():
            report.append({"transcript": label, "model": model, **t})
            total += t["usd"]
    if args.json:
        print(json.dumps({"rows": report, "total_usd": round(total, 4)}, indent=1))
        return
    print("| Transcript | Model | Calls | Input | Output | Cache read | Cache write | USD |")
    print("|---|---|---|---|---|---|---|---|")
    for r in report:
        print(f"| {r['transcript']} | {r['model']} | {r['calls']} | {r['input']:,} | "
              f"{r['output']:,} | {r['cache_read']:,} | {r['cache_write']:,} | "
              f"{r['usd']:.2f} |")
    print(f"| **Total** | | | | | | | **{total:.2f}** |")


if __name__ == "__main__":
    main()
