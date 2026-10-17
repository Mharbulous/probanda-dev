"""Read-only health check for Coclerk matter and firm path breadcrumbs."""

import argparse
import json
import os
from pathlib import Path
import sys

from resolve_paths import (
    EXPECTED_SCHEMA_VERSION,
    EXPECTED_USER_VERSION,
    LEGACY_ARTIFACTS_DIR,
    case_data_root,
    default_evidence_sql,
    find_pointer,
    is_absolute,
    norm_join,
    resolve_case_data_dir,
    _read_user_version,
)


SQLITE_HEADER = b"SQLite format 3\x00"
EVIDENCE_HEADER = "-- Case Data evidence dump -- schema v9.0"
DATABASES = ("main.sqlite", "law.sqlite", "privileged.sqlite")


def _load_json(path):
    raw = path.read_bytes().replace(b"\x00", b"")
    return json.loads(raw.decode("utf-8-sig"))


def _stored_path(matter_root, value):
    if not isinstance(value, str) or not value:
        return None
    return os.path.normpath(value) if is_absolute(value) else norm_join(str(matter_root), value)


def _sqlite_status(path):
    if not path.is_file():
        return "missing"
    try:
        if path.stat().st_size < 100:
            return "bad-header"
        with path.open("rb") as handle:
            header = handle.read(16)
        if header != SQLITE_HEADER:
            return "bad-header"
    except OSError:
        return "unreadable"
    return "ok"


def _inspect_pointer(pointer_path):
    matter_root = pointer_path.parent
    fields = []
    healthy = True
    try:
        pointer = _load_json(pointer_path)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return False, [f"pointer:invalid({type(exc).__name__})"]

    schema = pointer.get("schema_version")
    fields.append(f"schema={schema}")
    if schema != EXPECTED_SCHEMA_VERSION:
        healthy = False

    stored_matter_root = pointer.get("matter_root")
    matter_exists = isinstance(stored_matter_root, str) and Path(stored_matter_root).is_dir()
    fields.append(f"matter_root:{'exists' if matter_exists else 'missing'}")
    if not matter_exists:
        healthy = False

    root = case_data_root(str(matter_root))
    legacy_dir = norm_join(str(matter_root), LEGACY_ARTIFACTS_DIR)
    stored = pointer.get("case_data_dir")
    selected, rejected = resolve_case_data_dir(str(matter_root), stored, root, legacy_dir)
    stored_path = _stored_path(matter_root, stored)
    same = stored_path is not None and os.path.normcase(stored_path) == os.path.normcase(selected)
    fields.append("stored=selected" if same else "stored!=selected")
    if rejected or not same:
        healthy = False
    fields.append(f"selected={selected}")

    selected_path = Path(selected)
    fields.append(f"case_data_dir:{'exists' if selected_path.is_dir() else 'missing'}")
    if not selected_path.is_dir():
        healthy = False

    for name in DATABASES:
        status = _sqlite_status(selected_path / name)
        fields.append(f"{name}:{status}")
        if status != "ok":
            healthy = False

    main_path = selected_path / "main.sqlite"
    if _sqlite_status(main_path) == "ok":
        try:
            version = _read_user_version(str(main_path))
            fields.append(f"user_version={version}")
            if version != EXPECTED_USER_VERSION:
                healthy = False
        except Exception as exc:
            fields.append(f"user_version:error({type(exc).__name__})")
            healthy = False

    evidence_value = pointer.get(
        "evidence_sql_path", default_evidence_sql(str(matter_root), selected))
    evidence = Path(norm_join(str(matter_root), evidence_value))
    try:
        if evidence.is_file():
            with evidence.open("r", encoding="utf-8", errors="replace") as handle:
                header_ok = handle.readline().rstrip("\r\n") == EVIDENCE_HEADER
        else:
            header_ok = False
    except OSError:
        header_ok = False
    fields.append(f"evidence:{'current' if header_ok else 'missing-or-stale'}")
    if not header_ok:
        healthy = False
    return healthy, fields


def _inspect_config(config_path):
    fields = []
    healthy = True
    try:
        config = _load_json(config_path)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return False, [f"config:invalid({type(exc).__name__})"]
    for key in ("case_data_root",):
        value = config.get(key)
        exists = isinstance(value, str) and bool(value) and Path(value).is_dir()
        fields.append(f"{key}:{'exists' if exists else 'missing'}")
        if not exists:
            healthy = False
    if "repo_root" in config:
        value = config.get("repo_root")
        exists = isinstance(value, str) and bool(value) and Path(value).is_dir()
        fields.append(f"repo_root:{'exists' if exists else 'missing'}")
        if not exists:
            healthy = False
    return healthy, fields


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Check Coclerk pointers without modifying them."
    )
    parser.add_argument("litigation_documents_root", type=Path)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args(argv)

    root = args.litigation_documents_root.resolve()
    if not root.is_dir():
        print(f"UNHEALTHY ROOT | missing={root}")
        return 2

    all_healthy = True
    found = (find_pointer(str(d)) for d in root.iterdir() if d.is_dir())
    pointers = sorted((Path(p) for p in found if p), key=lambda p: str(p).lower())
    if not pointers:
        print(f"UNHEALTHY ROOT | no matter pointers under {root}")
        all_healthy = False
    for pointer in pointers:
        healthy, fields = _inspect_pointer(pointer)
        all_healthy = all_healthy and healthy
        print(f"{'HEALTHY' if healthy else 'UNHEALTHY'} {pointer.parent.name} | " + " | ".join(fields))

    if args.config is not None:
        healthy, fields = _inspect_config(args.config.resolve())
        all_healthy = all_healthy and healthy
        print(f"{'HEALTHY' if healthy else 'UNHEALTHY'} CONFIG | " + " | ".join(fields))

    return 0 if all_healthy else 1


if __name__ == "__main__":
    sys.exit(main())
