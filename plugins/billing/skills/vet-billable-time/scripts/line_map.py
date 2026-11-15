"""What tie_out.py writes beside invoice_lines.json on a pass, so each line can be defended later.

    line_map.json      each invoice line with the time entries or reviewed blocks, estimates, evidence and
                       rulings behind it, and the ids of the review-page blocks it rests on (`block_ids`,
                       empty for a line vetted in chat before the page existed)
    time_entries.json  the rows for the practice records' time entries, one per timer entry, reviewed block
                       or estimate

A vetted line is keyed by `block_id` (a reviewed block, carrying its own date and user and billed on its
own time) or by `entry_id` (a timer entry vetted in chat, billed on the entry's duration).
"""
FIRM_RULE = "firm rule"
TRACKER_SOURCE = "timecamp_time_entries"


def tracker_key(entry_id):
    return f"timecamp:{entry_id}"


def estimate_key(key):
    return f"estimate:{key}"


def block_key(block_id):
    return f"block:{block_id}"


def is_block(line):
    return line.get("block_id") is not None


def line_id(line):
    return line["block_id"] if is_block(line) else line["entry_id"]


def source_key(line):
    return block_key(line["block_id"]) if is_block(line) else tracker_key(line["entry_id"])


def day_of(line, by_id):
    """The line's (date, person)."""
    if is_block(line):
        return line["date"], line["user"]
    entry = by_id[str(line["entry_id"])]
    return entry["date"], entry["user_name"]


def supported(line):
    """What this line's evidence supports, or the estimate where nothing bounds it."""
    value = line.get("supported_seconds")
    return value if value is not None else line.get("estimate_seconds")


def time_of(line, by_id):
    """The line's time before exclusions: a block's own time, or a timer entry's tracked duration."""
    return int(supported(line) or 0) if is_block(line) else int(by_id[str(line["entry_id"])]["duration"])


def block_ids_of(line):
    return [line["block_id"]] if is_block(line) else list(line.get("block_ids") or [])


def excluded_seconds(line):
    return sum(int(item.get("seconds") or 0) for item in line.get("excluded") or [])


def tracker_record(line, entry, billed, day_billed):
    """One TimeCamp entry as the practice records hold it. A person-day under the minimum bills nothing."""
    words = (line.get("description") or "").strip() or f"Written off: {line.get('write_off_reason')}"
    return {"source_key": tracker_key(entry["id"]), "entry_date": entry["date"], "timekeeper": entry["user_name"], "description": words,
            "billed_seconds": billed if day_billed else 0, "tracked_seconds": int(entry["duration"]),
            "start": entry.get("start_time"), "end": entry.get("end_time"), "provenance": "tracker",
            "billable": bool(billed and day_billed), "tracker_ids": [str(entry["id"])],
            "proposal_ids": [] if line.get("proposal_id") is None else [str(line["proposal_id"])],
            "determination_ids": [] if line.get("determination_id") is None else [str(line["determination_id"])],
            **({"estimate": {"seconds": line["estimate_seconds"], "basis": [], "method": "the practitioner's own figure",
                             "reason": "no evidence bounds this entry", "approved_by": line.get("confirmed")}}
               if line.get("no_evidence_confirmed") else {})}


def block_record(line, billed, day_billed):
    """One reviewed block as the practice records hold it, its timer entries cited as evidence only."""
    words = (line.get("description") or "").strip() or f"Written off: {line.get('write_off_reason')}"
    figure = line.get("estimate_seconds") is not None
    return {"source_key": block_key(line["block_id"]), "entry_date": line["date"], "timekeeper": line["user"], "description": words,
            "billed_seconds": billed if day_billed else 0, "provenance": "estimate" if figure else "block",
            "billable": bool(billed and day_billed),
            "tracker_ids": [str(row["native_id"]) for row in line.get("evidence") or [] if row.get("source") == TRACKER_SOURCE],
            "proposal_ids": [] if line.get("proposal_id") is None else [str(line["proposal_id"])], "determination_ids": [],
            **({"estimate": {"seconds": line["estimate_seconds"], "basis": line.get("evidence") or [],
                             "method": "the reviewed block's own span, set on the review page",
                             "reason": "the block states its time as the practitioner's figure", "approved_by": line.get("confirmed")}}
               if figure else {})}


def estimate_record(item, day_billed):
    return {"source_key": estimate_key(item["key"]), "entry_date": item["date"], "timekeeper": item["user"],
            "description": item["description"], "billed_seconds": int(item["seconds"]) if day_billed else 0,
            "provenance": "estimate", "billable": day_billed, "tracker_ids": [],
            "estimate": {k: item.get(k) for k in ("seconds", "basis", "method", "reason", "approved_by", "approved_at")}}


def adjustments_for(lines, estimates, by_id, under_minimum, the_date, decided_by):
    """Every trim and write-off, each tied to the entry it came off."""
    out = []

    def add(key, kind, source_key, seconds, reason, by=decided_by, marker=None):
        out.append({"adjustment_key": key, "kind": kind, "seconds": seconds, "reason": reason, "marker": marker,
                    "decided_by": by, "decided_at": the_date, "entry_source_key": source_key})

    for line in lines:
        source = source_key(line)
        if line["disposition"] == "write_off":
            add(f"write_off:{source}", "write_off", source, time_of(line, by_id), line["write_off_reason"])
            continue
        for item in line.get("excluded") or []:
            add(f"trim:{source}:{item['marker']}", "trim", source, int(item["seconds"]),
                f"Non-billable window: {item['confirmed']}", marker=item["marker"])
        if day_of(line, by_id) in under_minimum:
            add(f"minimum:{source}", "write_off", source, time_of(line, by_id) - excluded_seconds(line),
                "a person's day under the firm's minimum", by=FIRM_RULE)
    for item in estimates:
        if (item["date"], item["user"]) in under_minimum:
            add(f"minimum:{estimate_key(item['key'])}", "write_off", estimate_key(item["key"]), int(item["seconds"]),
                "a person's day under the firm's minimum", by=FIRM_RULE)
    return out


def build(the_date, rows, lines, estimates, by_id, people, under_minimum, adjustments, vetted, not_candidates):
    """The line map: rows is tie_out's person-day rows, each already carrying its line_key."""
    per_source = {a["entry_source_key"]: [] for a in adjustments}
    for adjustment in adjustments:
        per_source[adjustment["entry_source_key"]].append(adjustment)

    def detail(line):
        if is_block(line):
            key = block_key(line["block_id"])
            return {"source_key": key, "block_id": line["block_id"], "billed_seconds": time_of(line, by_id) - excluded_seconds(line),
                    "description": line.get("description"), "proposal_id": line.get("proposal_id"), "evidence": line.get("evidence") or [],
                    "ruling": line.get("confirmed"), "supported_seconds": line.get("supported_seconds"),
                    "estimate_seconds": line.get("estimate_seconds"), "excluded": line.get("excluded") or [],
                    "late_reason": line.get("late_reason"), "adjustments": per_source.get(key, []), "block_ids": [line["block_id"]]}
        entry = by_id[str(line["entry_id"])]
        return {"source_key": tracker_key(entry["id"]), "entry_id": str(entry["id"]), "start": entry.get("start_time"),
                "end": entry.get("end_time"), "tracked_seconds": int(entry["duration"]),
                "billed_seconds": int(entry["duration"]) - excluded_seconds(line),
                "description": line.get("description"), "proposal_id": line.get("proposal_id"), "evidence": line.get("evidence") or [],
                "ruling": line.get("confirmed"), "supported_seconds": line.get("supported_seconds"),
                "excluded": line.get("excluded") or [], "late_reason": line.get("late_reason"),
                "note": entry.get("description") or None, "adjustments": per_source.get(tracker_key(entry["id"]), []),
                "block_ids": list(line.get("block_ids") or [])}

    out_lines = []
    for row in rows:
        day_user = (row["date"], row["user"])
        tracked = [l for l in lines if l["disposition"] == "bill" and day_of(l, by_id) == day_user]
        estimated = [e for e in estimates if (e["date"], e["user"]) == day_user]
        out_lines.append({**row, "rate_source": people[row["user"]].get("rate_source"),
                          "entries": [detail(l) for l in tracked],
                          "estimates": [{**e, "source_key": estimate_key(e["key"])} for e in estimated]})
    unbilled_lines = [l for l in lines if l["disposition"] == "write_off" or day_of(l, by_id) in under_minimum]
    unbilled_estimates = [e for e in estimates if (e["date"], e["user"]) in under_minimum]
    return {"passed_on": the_date, "lines": out_lines,
            "not_billed": [detail(l) for l in unbilled_lines] + [{**e, "source_key": estimate_key(e["key"])} for e in unbilled_estimates],
            "adjustments": adjustments, "unexplained": vetted.get("candidates") or {}, "gaps": vetted.get("gaps") or [],
            "not_candidates": not_candidates}


def time_entries(lines, estimates, by_id, under_minimum):
    def billed(line):
        return 0 if line["disposition"] == "write_off" else time_of(line, by_id) - excluded_seconds(line)

    def record(line):
        day_billed = day_of(line, by_id) not in under_minimum
        if is_block(line):
            return block_record(line, billed(line), day_billed)
        return tracker_record(line, by_id[str(line["entry_id"])], billed(line), day_billed)

    tracked = [record(l) for l in lines]
    return tracked + [estimate_record(e, (e["date"], e["user"]) not in under_minimum) for e in estimates]
