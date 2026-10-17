"""Shared matter-folder output paths for BCSC form workflows.

Two buckets, per the workspace output rule in .claude/skills/shared/workspace-output-rule.md:

- writing_output_dir   -> <the matter's draft folder>/<Writing folder>/ (final
  .docx / PDF). The Writing folder's name comes from the caller.
- case_data_output_dir -> <case-data folder>/<workflow>/ (working files). The
  case-data folder's path comes from the caller.

Neither is a guessed literal. The draft folder is resolved by glob, because
real matters spell it inconsistently (with and without a trailing "s", in mixed
case). The case-data folder is the one probanda.json's case_data_dir names, and
the caller passes the path it sees, since in Cowork's sandbox that folder is
mounted apart from the matter. Neither the draft folder nor the case-data
folder is ever created here; only the subfolder beneath each is.

An individual form takes no Writing folder (#1324): write_deliverables saves
its .docx at the draft folder's root under the caller's out_name.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path, PureWindowsPath

from steps.shared.fingerprint import STORE_NAME, ManualEdits, drift

# Workflow folder names under the case-data folder.
SUBSTANCE_WORKFLOW = "bcsc-form-substance"
# Forms filed as a package (#1324): their .docx stays in the Writing folder.
PACKAGE_FORMS = ("form-32", "form-33")
# What an out_name stem may not carry: a character Windows forbids in a file
# name, a file extension, or the " v<n>" the versioning appends itself.
BAD_STEM = re.compile(r'[\\/:*?"<>|]|\.(docx?|pdf)$| v\d+$', re.I)


def _draft_folder(matter_path: str | Path) -> Path:
    """Return the matter's lawyer-facing draft folder.

    Resolves by glob "0. DRAFT*": exactly one match is used; zero or two-plus
    matches fail loudly. The folder belongs to the lawyer, so its absence means
    matter_path is wrong -- never created here.
    """
    matter = Path(matter_path)
    matches = sorted(p for p in matter.glob("0. DRAFT*") if p.is_dir())
    if not matches:
        raise RuntimeError(
            f"No draft folder found in {matter}\n"
            f"publish-bcsc-form writes final documents only under the matter's "
            f"'0. DRAFT' folder and will not create it. Check matter_path."
        )
    if len(matches) > 1:
        names = ", ".join(repr(p.name) for p in matches)
        raise RuntimeError(
            f"Ambiguous draft folder in {matter}: {names}.\n"
            f"publish-bcsc-form will not guess. Merge or rename so exactly one "
            f"'0. DRAFT*' folder remains."
        )
    return matches[0]


def writing_output_dir(matter_path: str | Path, writing_folder: str) -> Path:
    """Return the Writing's own folder under the draft folder, creating it if needed.

    writing_folder is one path segment, e.g. "NOA Stay application", supplied by
    the caller: the folder the Writing's mockup presentation copy was rendered
    into, or a {CODE} {description} name for a document with no Writing.
    """
    name = writing_folder or ""
    # ":" is refused with the separators because a Windows drive prefix
    # ("C:x") would re-root the joined path outside the draft folder.
    if name in ("", ".", "..") or any(c in name for c in "/\\:"):
        raise RuntimeError(
            f"Writing folder name must be one path segment: {writing_folder!r}. "
            f"Pass the Writing's folder name (no separators, not '.' or '..') "
            f"to harness init with --writing-folder."
        )
    d = _draft_folder(matter_path) / name
    d.mkdir(exist_ok=True)
    return d


def next_free_path(path: str | Path) -> Path:
    """Return path if unused, else the first unused "<stem> vN<ext>" sibling.

    A Word or PDF deliverable is never overwritten (workspace output rule): the
    practitioner may already have reviewed, signed or served the earlier one.
    """
    path = Path(path)
    n = 1
    candidate = path
    while candidate.exists():
        n += 1
        candidate = path.with_name(f"{path.stem} v{n}{path.suffix}")
    return candidate


def _free_copy(path: Path) -> Path:
    """Return the first "<stem> vN.docx" whose .docx and .pdf names are both unused.

    A version whose PDF survives (its .docx moved to TRASH, say) is skipped, so
    a new .docx never sits beside a PDF of the same vN made from other content.
    """
    candidate, n = path, 1
    while candidate.exists() or candidate.with_suffix(".pdf").exists():
        n += 1
        candidate = path.with_name(f"{path.stem} v{n}{path.suffix}")
    return candidate


def _next_version(folder: Path, stem: str, suffix: str) -> tuple[Path, Path | None]:
    """Return the next copy of a series and its highest existing copy (None if none).

    "<stem><suffix>.docx" counts as v1 and "<stem> vN<suffix>.docx" as vN. A
    version held only by a .pdf counts as taken, for the reason in _free_copy.
    """
    series = re.compile(r"^%s(?: v(\d+))?%s\.(docx|pdf)$"
                        % (re.escape(stem), re.escape(suffix)), re.I)
    numbers, taken = set(), {}
    for entry in os.listdir(folder):
        match = series.match(entry)
        if match:
            numbers.add(int(match.group(1) or 1))
            if match.group(2).lower() == "docx":
                taken[int(match.group(1) or 1)] = folder / entry
    if not numbers:
        return folder / f"{stem}{suffix}.docx", None
    prior = taken[max(taken)] if taken else None
    return folder / f"{stem} v{max(numbers) + 1}{suffix}.docx", prior


def _check_drift(ctx: dict, folder: Path, series: list[tuple[str, str]]) -> None:
    """Refuse to write while the newest copy of a series holds edits the new copy would drop.

    Skipped once the caller passed --edits-reviewed at init, after the
    practitioner saw the differences and any text worth keeping was carried.
    """
    if ctx.get("edits_reviewed") or not ctx.get("case_data_folder"):
        return
    store = Path(ctx["case_data_folder"]) / SUBSTANCE_WORKFLOW / STORE_NAME
    draft_root = _draft_folder(ctx["matter_path"])
    found = [drift(store, draft_root, folder, prefix, suffix) for prefix, suffix in series]
    found = [d for d in found if d]
    if found:
        raise ManualEdits(found)


def fingerprint_store(ctx: dict) -> Path:
    """The case-data file holding the fingerprints of every generated copy."""
    return case_data_output_dir(ctx["matter_path"], ctx.get("case_data_folder", ""),
                                SUBSTANCE_WORKFLOW) / STORE_NAME


def write_deliverables(ctx: dict, title: str, write,
                       suffixes: tuple[str, ...] = ("",)) -> list[tuple[Path, Path | None]]:
    """Write one new .docx per suffix and return [(path, versioned_from)].

    write(paths) writes the files, one path per suffix. ctx carries exactly one of:

    - writing_folder, for a package (Form 32 or 33, or a document sworn for
      one): "<title><suffix>.docx" in the Writing folder, or its first "vN"
      sibling whose .docx and .pdf names are both unused. versioned_from is None.
    - out_name, for an individual form: "<out_name><suffix>.docx" at the draft
      folder's root, creating no folder. In each series the unsuffixed name
      counts as v1 and "<out_name> vN<suffix>.docx" as vN: the copy takes
      v(highest + 1), and versioned_from is the highest existing copy. Each
      copy is written to a "~"-prefixed temporary file in the same folder and
      then renamed, so no file is overwritten and a failed write leaves none.

    Before anything is written, each series' newest copy is checked against
    the last copy generated (_check_drift), and ManualEdits is raised on a
    difference.
    """
    folder, stem = ctx.get("writing_folder"), ctx.get("out_name")
    if stem and ctx.get("form_id") in PACKAGE_FORMS:
        raise RuntimeError(
            f"{ctx['form_id']} is filed as a package, so its .docx goes into "
            f"the package's Writing folder. Pass that folder's name to harness "
            f"init with --writing-folder, not --out-name.")
    if folder and stem:
        raise RuntimeError(
            f"harness init was given both --writing-folder {folder!r} and "
            f"--out-name {stem!r}. Pass --out-name for an individual form or "
            f"--writing-folder for a package, not both.")
    if not folder and not stem:
        raise RuntimeError(
            "Neither --writing-folder nor --out-name was passed to harness "
            "init, so the finished .docx has nowhere to go. Pass --out-name "
            "with the form's /file-naming stem for an individual form, or "
            "--writing-folder for a package (Form 32 or 33, or an affidavit "
            "sworn for one).")
    if folder:
        target = writing_output_dir(ctx["matter_path"], folder)
        _check_drift(ctx, target, [(f"{title}{s}", "") for s in suffixes])
        out = [_free_copy(target / f"{title}{s}.docx") for s in suffixes]
        write(out)
        return [(p, None) for p in out]
    if not stem.strip() or BAD_STEM.search(stem):
        raise RuntimeError(
            f"Output name must be a bare file name stem: {stem!r}. Pass the "
            f"form's /file-naming stem (not empty, without \\ / : * ? \" < > |, "
            f"a file extension or a trailing \" v<n>\") to harness init with "
            f"--out-name.")
    root = _draft_folder(ctx["matter_path"])
    _check_drift(ctx, root, [(stem, s) for s in suffixes])
    temps = [root / f"~{stem}{s}.tmp-{os.getpid()}.docx" for s in suffixes]
    placed = []
    try:
        write(temps)
        for tmp, suffix in zip(temps, suffixes):
            if not tmp.is_file():
                raise RuntimeError(f"fill produced no output: {tmp}")
            path, prior = _next_version(root, stem, suffix)
            if path.exists():
                raise RuntimeError(
                    f"Not overwriting {path}: it appeared while the form was "
                    f"being written. Run the step again for the next version.")
            os.replace(tmp, path)
            placed.append((path, prior))
    finally:
        for tmp in temps:
            if tmp.exists():
                tmp.unlink()
    return placed


def _case_data_dir_name(matter_path: str | Path) -> str:
    """Return the last segment of the matter pointer's case_data_dir.

    The pointer is probanda.json, falling back to the legacy coclerk.json on a
    matter not yet migrated. The stored value is a Windows path, but this script
    may run in Cowork's Linux sandbox, so it is parsed as a Windows path on
    every host.
    """
    candidates = [Path(matter_path) / name for name in ("probanda.json", "coclerk.json")]
    pointer = next((p for p in candidates if p.is_file()), None)
    if pointer is None:
        raise RuntimeError(
            f"No probanda.json in {matter_path}. The matter is not initialized: "
            f"run /case-data initialize for it, then try again."
        )
    data = json.loads(pointer.read_bytes().replace(b"\x00", b"").decode("utf-8"))
    name = PureWindowsPath(data.get("case_data_dir") or "").name
    if not name:
        raise RuntimeError(
            f"{pointer} names no case_data_dir. Run /case-data initialize for "
            f"this matter, then try again."
        )
    return name


def case_data_output_dir(matter_path: str | Path, case_data_folder: str | Path,
                         workflow: str) -> Path:
    """Return this workflow's folder under the case-data folder, creating it if needed.

    case_data_folder is the path the caller sees for the folder probanda.json's
    case_data_dir names. It must already exist and its name must match that
    entry's last segment; the case-data folder itself is never created here.
    """
    folder = Path(case_data_folder) if case_data_folder else None
    if folder is None or not folder.is_dir():
        raise RuntimeError(
            f"case-data folder is not an existing directory: "
            f"{case_data_folder!r}. publish-bcsc-form never creates it. If the "
            f"matter is not initialized, run /case-data initialize; otherwise "
            f"pass the folder probanda.json's case_data_dir names to harness "
            f"init with --case-data-folder (in Cowork, request access to that "
            f"folder first)."
        )
    expected = _case_data_dir_name(matter_path)
    if folder.name.casefold() != expected.casefold():
        raise RuntimeError(
            f"case-data folder {str(folder)!r} does not match probanda.json's "
            f"case_data_dir, whose folder is {expected!r}. Pass the folder "
            f"case_data_dir names."
        )
    d = folder / workflow
    d.mkdir(exist_ok=True)
    return d
