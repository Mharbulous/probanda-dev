#!/usr/bin/env python3
"""Fail if public/ holds anything that may not reach a user's machine.

Usage:
  python scripts/check_public_tree.py          check every file under public/
  python scripts/check_public_tree.py --hook   check the one file a pending Edit or Write
                                               would leave in public/ (hook JSON on stdin)

public/ is the only source of the public repository, so it holds no Trade
Secret and no User Data (COMMANDMENTS.md). Each file is checked two ways:

  - check_publishable.file_problems: schema DDL, forbidden file types, paths
    from a maintainer's machine, and the pinned names.
  - fingerprints read from the private side on every run and never stored:
    schema identifiers taken from the private SQL and DDL (a DDL statement in
    a TypeScript or Python string is read to its last line), a rules-map marker,
    a file that is a copy of a private source file, a long line repeated from
    one, a matter code, a file type off the short allowlist, and CRLF endings.

--hook checks only for what could be a Trade Secret or User Data. Do not restrict it
further: it lets through the write-time generic names (SQL built-ins, column names any
schema uses, legal terms of art), lines of a standard licence such as MIT, CRLF endings,
a file type off the allowlist and an unfinished CHANGELOG.md entry. None of these reveals
Probanda's schema or anyone's data. The full-tree check (approve_public, export_public,
CI) still reports all of them.

The private side is .claude/skills/, cloud/ and the source folder of every plugin
the repo builds (plugin_layout.py reads which from source/assignment.json). A
private folder that is missing stops the check.

Exit codes: 0 clean, 1 a problem was found, public/ is missing or a private folder
is missing, 2 source/assignment.json is missing or unreadable. Standard library only.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).resolve().parent

PUBLIC = "public"
# The human-approved list of public files: {path under public/: sha256}. Written
# only by approve_public.py.
APPROVED = "public-approved.json"
# Each publication adds a top `## <subject>` entry with `- ` bullets. The entry is the
# public commit message, so a subject made only of these words says nothing.
CHANGELOG = "CHANGELOG.md"
GENERIC_WORDS = frozenset(("publish", "published", "update", "updates", "updated", "sync", "change", "changes",
                           "misc", "release", "from", "the", "probanda", "development", "repository", "repo"))
# Where the fingerprints are read from, beside the source folder of every plugin the
# repo builds (private_roots).
PRIVATE_ROOTS = (".claude/skills", "cloud")
# Third-party code and build output: a public bundle may rightly share their lines.
SKIP_DIRS = ("node_modules", "__pycache__", ".pytest_cache", "build", "dist")
# Files of a plugin's source folder whose content is not secret, so public/ may repeat it.
SHARED_FILES = ("plugin.json", ".mcp.json")
# Text only: a binary cannot be scanned, so each new type is added on purpose.
ALLOWED_SUFFIXES = (".md", ".json", ".py", ".js", ".txt")
ALLOWED_NAMES = ("LICENSE",)
# Schema identifiers that are also ordinary names outside the schema (a hook's
# input has a `file_path` key). Adding one here is a deliberate act.
GENERIC_IDENTIFIERS = frozenset(("file_path",))
# Exempt at write time only (--hook): names Probanda's schema shares with the rest of the
# world, so writing one reveals nothing of it. Three kinds, and nothing else:
#   - built-ins of the SQL engines (SQLite, PostgreSQL and its catalogs and extensions);
#   - column names any schema uses (audit timestamps, generic keys and times);
#   - legal terms of art a lawyer writes as they are.
# Never add a name that only Probanda uses: a table, view, index, trigger or function of
# its own (causes_of_action and witness_statements are its tables, so they are not here),
# or a column named for its own design (style_of_cause_or_title, evidence_link_id).
WRITE_TIME_GENERIC = frozenset((
    "array_agg", "array_append", "bool_and", "bool_or", "clock_timestamp", "column_default", "column_name",
    "foreign_key_violation", "foreign_keys", "gen_random_uuid", "generate_series", "generation_expression",
    "gin_trgm_ops", "group_concat", "has_function_privilege", "has_schema_privilege", "has_table_privilege",
    "information_schema", "is_nullable", "json_array", "json_array_length", "json_each", "json_extract",
    "json_group_array", "json_object", "json_remove", "json_set", "json_type", "jsonb_agg",
    "jsonb_array_elements", "jsonb_array_elements_text", "jsonb_array_length", "jsonb_build_array",
    "jsonb_build_object", "jsonb_each", "jsonb_object_agg", "jsonb_object_keys", "jsonb_path_exists",
    "jsonb_set", "jsonb_strip_nulls", "jsonb_to_recordset", "jsonb_typeof", "num_nonnulls", "ordinal_position",
    "pg_catalog", "pg_class", "pg_constraint", "pg_get_constraintdef", "pg_get_function_identity_arguments",
    "pg_indexes", "pg_namespace", "pg_proc", "pg_temp", "pg_trgm", "regexp_replace", "role_table_grants",
    "row_number", "search_path", "security_invoker", "split_part", "string_agg", "table_name", "table_schema",
    "to_char", "to_jsonb", "to_tsvector", "ts_rank", "udt_name", "user_version", "websearch_to_tsquery",
    "created_at", "created_by", "updated_at", "deleted_at", "user_id", "user_name", "file_name", "row_count",
    "start_time", "end_time", "phone_number", "valid_from", "valid_to", "effective_from", "effective_to",
    "schema_version",
    "address_for_service", "associate_judge", "beyond_reasonable_doubt", "burden_of_proof", "case_law",
    "cause_of_action", "clear_and_convincing", "co_counsel", "default_judgment", "defendant_by_counterclaim",
    "good_law", "information_and_belief", "notice_of_application", "notice_to_admit", "of_counsel",
    "opening_statement", "opposing_counsel", "opposing_party", "oral_reasons", "plaintiff_by_counterclaim",
    "point_of_law", "response_to_civil_claim", "solicitor_client", "strict_proof", "style_of_cause",
    "sworn_evidence", "third_party", "trial_management_conference", "witness_list", "witness_statement",
    "work_product", "written_argument",
))
# A private file by one of these names is a standard licence, not Probanda's own text, so
# at write time public/ may repeat its lines (an MIT LICENSE).
LICENCE_NAMES = ("LICENSE", "LICENCE", "COPYING")
LONG_LINE = 60

SNAKE = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+")
DOTTED = re.compile(r"\b([A-Za-z]\w*)\.([A-Za-z]\w*)\b")
# The object a DDL statement creates, with its database qualifier if it has one.
CREATED = re.compile(
    r"\bCREATE\s+(?:(?:UNIQUE|VIRTUAL|TEMP|TEMPORARY)\s+)*(?:TABLE|VIEW|INDEX|TRIGGER)\s+"
    r"(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?(\w+)", re.IGNORECASE)
RULES_MARKER = re.compile(r"<!--\s*(?:node|edge)\b")


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def walk(root):
    """(POSIX path relative to root, bytes) for every file under root, sorted."""
    for dirpath, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(names):
            path = Path(dirpath) / name
            yield path.relative_to(root).as_posix(), path.read_bytes()


def public_files(repo):
    """{path under public/: bytes}."""
    root = repo / PUBLIC
    return dict(walk(root)) if root.is_dir() else {}


def text_of(data):
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def private_roots(repo):
    """(private folders to fingerprint, private files public/ may repeat), as paths from
    the repo root. The plugin source folders, which hold the server source, are where
    source/assignment.json says the repo builds from."""
    sources = [spec["source"] for spec in load_script("plugin_layout").plugins(repo).values()]
    return (*PRIVATE_ROOTS, *sources), {f"{source}/{name}" for source in sources for name in SHARED_FILES}


def fingerprints(repo, hook=False):
    """What the private side holds that public/ may not repeat. At write time (hook) the
    write-time generic names and the private licence files do not count."""
    identifiers, tables, hashes, lines, sql = set(), set(), set(), set(), []
    roots, shared = private_roots(repo)
    for top in roots:
        root = repo / top
        # A root read as empty would pass a Trade Secret it should have caught.
        if not root.is_dir():
            sys.exit(f"STOP: private folder {top}/ is missing, so public/ cannot be checked against it")
        for rel, data in walk(root):
            if f"{top}/{rel}" in shared:
                continue
            if hook and rel.rsplit("/", 1)[-1].split(".")[0].upper() in LICENCE_NAMES:
                continue
            if data:
                hashes.add(hashlib.sha256(data).hexdigest())
            text = text_of(data)
            if text is None:
                continue
            is_sql = rel.lower().endswith(".sql")
            if is_sql:
                sql.append(text)
            # Above zero inside a DDL statement that runs over several lines, as
            # the schema in a TypeScript or Python string does. A blank line ends
            # it, so prose with an unclosed bracket does not run on.
            depth = 0
            for line in text.splitlines():
                stripped = line.strip()
                if len(stripped) >= LONG_LINE:
                    lines.add(stripped)
                created = CREATED.search(line)
                if created:
                    tables.add(created.group(1).lower())
                if created or not stripped:
                    depth = 0
                in_statement = depth > 0
                if created or in_statement:
                    code = line.split("--", 1)[0]
                    depth = max(depth + code.count("(") - code.count(")"), 0)
                if created or ((is_sql or in_statement) and not stripped.startswith("--")):
                    identifiers.update(t.lower() for t in SNAKE.findall(line))
    identifiers |= {t for t in tables if "_" in t}
    # A one-word table name is an ordinary word, so it counts only behind a
    # database qualifier the private SQL itself uses (`main.facts`).
    qualified = {(q.lower(), t.lower()) for text in sql for q, t in DOTTED.findall(text) if t.lower() in tables}
    generic = GENERIC_IDENTIFIERS | (WRITE_TIME_GENERIC if hook else frozenset())
    return {"identifiers": identifiers - generic, "qualified": qualified,
            "hashes": hashes, "lines": lines}


def tree_problems(files, prints, file_problems, matter_codes, formats=True):
    """[(path, line, message)] for {path under public/: bytes}. Without formats, the file
    type allowlist and CRLF checks are left out."""
    found = []
    for rel, data in files.items():
        found += [(rel, n, msg) for _, n, msg, _ in file_problems(PurePosixPath(rel), data)]
        name = rel.rsplit("/", 1)[-1]
        if formats and name not in ALLOWED_NAMES and not name.lower().endswith(ALLOWED_SUFFIXES):
            found.append((rel, 1, "file type is not on the public allowlist"))
        if data and hashlib.sha256(data).hexdigest() in prints["hashes"]:
            found.append((rel, 1, "is a copy of a private source file"))
        if formats and b"\r\n" in data:
            found.append((rel, 1, "has CRLF line endings"))
        text = text_of(data)
        if text is None:
            found.append((rel, 1, "is not UTF-8 text"))
            continue
        for n, line in enumerate(text.split("\n"), 1):
            stripped = line.strip()
            if len(stripped) >= LONG_LINE and stripped in prints["lines"]:
                found.append((rel, n, "repeats a line of a private source file"))
            names = {t.lower() for t in SNAKE.findall(line)} & prints["identifiers"]
            names |= {f"{q}.{t}" for q, t in DOTTED.findall(line) if (q.lower(), t.lower()) in prints["qualified"]}
            if names:
                found.append((rel, n, "names a private schema identifier: " + ", ".join(sorted(names))))
            if RULES_MARKER.search(line):
                found.append((rel, n, "holds a rules-map marker"))
            if matter_codes(line):
                found.append((rel, n, "holds a matter code"))
    return found


def release_entry(text):
    """(subject, body) of the top `## ` entry of CHANGELOG.md, or None when it has none."""
    entries = re.split(r"^## ", text, flags=re.M)[1:]
    if not entries:
        return None
    subject, _, body = entries[0].partition("\n")
    return subject.strip(), body.strip()


def release_problems(text):
    """Why the top CHANGELOG.md entry cannot be the public commit message, as messages."""
    entry = release_entry(text)
    if entry is None:
        return ["has no ## entry to use as the public commit message"]
    subject, body = entry
    found = []
    if not 10 <= len(subject) <= 72:
        found.append(f"the top entry's heading is {len(subject)} characters; it must be 10 to 72")
    if set(re.findall(r"[a-z]+", subject.lower())) <= GENERIC_WORDS:
        found.append("the top entry's heading is generic: say what this publication improves or adds")
    if not re.search(r"^- \S", body, flags=re.M):
        found.append("the top entry has no `- ` bullet naming an improvement or new feature")
    return found


def commit_message(text):
    subject, body = release_entry(text)
    return f"{subject}\n\n{body}\n"


def problems_in(repo, files, hook=False):
    """Every problem in files. At write time (hook) only what could be a Trade Secret or
    User Data counts: the format checks wait for the full-tree check."""
    found = tree_problems(files, fingerprints(repo, hook), load_script("check_publishable").file_problems,
                          load_script("check_plugin").matter_codes, formats=not hook)
    if CHANGELOG in files and not hook:
        found += [(CHANGELOG, 1, message) for message in release_problems(text_of(files[CHANGELOG]) or "")]
    return found


def digests(files):
    return {rel: hashlib.sha256(data).hexdigest() for rel, data in files.items()}


def load_approved(repo):
    path = repo / APPROVED
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def approval_diff(current, approved):
    """How the public files differ from the approved list, as printable lines."""
    return ([f"added: {p}" for p in sorted(set(current) - set(approved))]
            + [f"changed: {p}" for p in sorted(p for p in set(current) & set(approved) if current[p] != approved[p])]
            + [f"removed: {p}" for p in sorted(set(approved) - set(current))])


def pending_file(repo, event):
    """(path under public/, bytes) a pending Edit or Write would leave, or None when
    it does not touch public/. Raises ValueError for a change it cannot work out."""
    tool_input = event.get("tool_input") or {}
    raw = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not raw:
        return None
    path = Path(raw)
    path = (path if path.is_absolute() else Path(event.get("cwd") or repo) / path).resolve()
    root = (repo / PUBLIC).resolve()
    if root not in path.parents:
        return None
    rel = path.relative_to(root).as_posix()
    if "content" in tool_input:
        return rel, tool_input["content"].encode("utf-8")
    edits = tool_input.get("edits") or ([tool_input] if "old_string" in tool_input else None)
    if edits is None:
        raise ValueError(f"cannot work out what {event.get('tool_name')} would write to public/{rel}")
    text = path.read_bytes().decode("utf-8") if path.is_file() else ""
    for edit in edits:
        count = -1 if edit.get("replace_all") else 1
        text = text.replace(edit["old_string"], edit["new_string"], count)
    return rel, text.encode("utf-8")


def report(problems):
    for rel, lineno, message in problems:
        print(f"{PUBLIC}/{rel}:{lineno}: {message}")


def main():
    sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hook", action="store_true", help="check one pending Edit or Write (hook JSON on stdin)")
    parser.add_argument("--repo", type=Path, default=REPO, help="repo to check (for tests)")
    args = parser.parse_args()
    repo = args.repo.resolve()
    if args.hook:
        try:
            pending = pending_file(repo, json.loads(sys.stdin.buffer.read().decode("utf-8")))
        except ValueError as e:
            print(e)
            return 1
        if pending is None:
            return 0
        problems = problems_in(repo, dict([pending]), hook=True)
        report(problems)
        return 1 if problems else 0
    files = public_files(repo)
    if not files:
        print(f"no files under {PUBLIC}/")
        return 1
    problems = problems_in(repo, files)
    report(problems)
    if problems:
        print(f"\n{len(problems)} problem(s) in {PUBLIC}/. Nothing here may be published.")
        return 1
    print(f"OK: {len(files)} files under {PUBLIC}/ passed every check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
