"""Two-pass, cycle-safe rename/copy of exhibit files.

CLI: python rename_exhibits.py <input.json path>
     python rename_exhibits.py   (reads JSON from stdin)

Input JSON:
{
  "exhibit_dir": "<dir>",
  "renames": [{"from": "<filename>", "to": "<filename>"}],
  "copies": [{"source": "<abs path>", "target_name": "<filename>"}]
}

Never invoked directly by the agent's shell — this is the sole path for
mutating exhibit filenames. See references/validation.md.
"""
import secrets
import shutil
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common


def validate(exhibit_dir, renames, copies):
    errors = []
    from_names = {r["from"] for r in renames}

    for r in renames:
        src = exhibit_dir / r["from"]
        if not src.is_file():
            errors.append(f"rename source not found: {r['from']}")
        dst = exhibit_dir / r["to"]
        if dst.exists() and r["to"] not in from_names:
            errors.append(
                f"rename target already exists and is not itself being renamed: {r['to']}"
            )

    for c in copies:
        src = Path(c["source"])
        if not src.is_file():
            errors.append(f"copy source not found: {c['source']}")
        elif src.stat().st_size == 0:
            errors.append(f"copy source is zero bytes: {c['source']}")
        dst = exhibit_dir / c["target_name"]
        if dst.exists() and c["target_name"] not in from_names:
            errors.append(
                f"copy target already exists and is not a rename source: {c['target_name']}"
            )

    return errors


def two_pass_rename(exhibit_dir, renames):
    """Stage every 'from' to a temp name, then move each stage to its 'to'.

    Handles cycles (A->B, B->A) safely. On any failure, rolls back
    completed pass-2 moves and restores pass-1 stages to their original
    names, then returns (completed, errors).
    """
    completed = []
    errors = []
    staged = []  # list of (original_from_path, staged_path, to_name)

    # Pass 1: move every 'from' to a unique staging name.
    try:
        for r in renames:
            src = exhibit_dir / r["from"]
            staged_path = exhibit_dir / f"{r['from']}.staging.{secrets.token_hex(4)}"
            shutil.move(str(src), str(staged_path))
            staged.append((r["from"], staged_path, r["to"]))
    except Exception as e:
        errors.append(f"pass 1 (staging) failed: {e}")
        # Roll back any moves already made in pass 1.
        for orig_from, staged_path, _to in staged:
            if staged_path.exists():
                shutil.move(str(staged_path), str(exhibit_dir / orig_from))
        return completed, errors

    # Pass 2: move each staged file to its final destination.
    pass2_done = []
    try:
        for orig_from, staged_path, to_name in staged:
            dst = exhibit_dir / to_name
            shutil.move(str(staged_path), str(dst))
            pass2_done.append((orig_from, staged_path, to_name, dst))
            completed.append({"from": orig_from, "to": to_name})
    except Exception as e:
        errors.append(f"pass 2 (final move) failed: {e}")
        # Roll back completed pass-2 moves (dst -> back to staged name).
        for orig_from, staged_path, to_name, dst in pass2_done:
            if dst.exists():
                shutil.move(str(dst), str(staged_path))
        completed.clear()
        # Restore all staged files (including the one that failed mid-move,
        # which never got staged_path populated post-move) to originals.
        for orig_from, staged_path, to_name in staged:
            if staged_path.exists():
                shutil.move(str(staged_path), str(exhibit_dir / orig_from))
        return [], errors

    return completed, errors


def do_copies(exhibit_dir, copies):
    completed = []
    errors = []
    for c in copies:
        target = exhibit_dir / c["target_name"]
        if target.exists():
            errors.append(f"copy target already exists post-rename, refusing to overwrite: {c['target_name']}")
            continue
        try:
            shutil.copy2(c["source"], str(target))
            completed.append({"source": c["source"], "target_name": c["target_name"]})
        except Exception as e:
            errors.append(f"copy failed for {c['target_name']}: {e}")
    return completed, errors


def verify(exhibit_dir, renames_completed, copies_completed):
    verification = {}
    names = [r["to"] for r in renames_completed] + [c["target_name"] for c in copies_completed]
    for name in names:
        p = exhibit_dir / name
        if not p.is_file():
            verification[name] = {"size": 0, "header": "", "ok": False}
            continue
        size = p.stat().st_size
        with open(p, "rb") as f:
            header = f.read(4).hex()
        verification[name] = {"size": size, "header": header, "ok": size > 0}
    return verification


def main():
    data = common.read_input_json()
    exhibit_dir = Path(data["exhibit_dir"])
    renames = data.get("renames", [])
    copies = data.get("copies", [])

    errors = validate(exhibit_dir, renames, copies)
    if errors:
        return {"success": False, "errors": errors}

    renames_completed, rename_errors = two_pass_rename(exhibit_dir, renames)
    if rename_errors:
        return {"success": False, "errors": rename_errors, "renames_completed": renames_completed}

    copies_completed, copy_errors = do_copies(exhibit_dir, copies)

    verification = verify(exhibit_dir, renames_completed, copies_completed)

    all_errors = copy_errors
    return {
        "success": len(all_errors) == 0,
        "renames_completed": renames_completed,
        "copies_completed": copies_completed,
        "errors": all_errors,
        "verification": verification,
    }


if __name__ == "__main__":
    try:
        result = main()
        common.emit(result, result["success"])
    except Exception:
        common.emit(
            {"success": False, "error": "unexpected_exception", "detail": traceback.format_exc()},
            False,
        )
