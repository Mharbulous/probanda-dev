#!/usr/bin/env python3
"""Hash files for the housekeeping review log.

Usage:
    python hash_files.py <folder> [--ext .pdf .docx ...]
    python hash_files.py --files <path> [<path> ...]

Prints one JSON object to stdout:
    {"files": [{"name": "<basename>", "path": "<abs path>",
                "hash": "<sha256 lowercase hex>"}, ...],
     "errors": [{"path": "...", "error": "..."}]}

SHA-256 of the file's raw bytes on disk, streamed in 1 MB chunks so a large PDF
never loads whole into memory. Raw bytes only -- never extracted text, never a
converted rendering -- because the point is to recognise the same document after
a human has renamed it, and a rename does not touch the bytes.

Unreadable files land in "errors" rather than aborting the run: one locked file
must not cost the whole folder its hashes. A file with no hash simply gets no
record-gate hit and is reviewed, which is the safe direction.
"""
import argparse
import hashlib
import json
import os
import sys

DEFAULT_EXTS = ('.pdf', '.docx', '.doc', '.eml', '.msg', '.xls')


def sha256_of_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def collect(folder, exts):
    """Non-recursive listing of `folder`, filtered to `exts` (case-insensitive)."""
    lowered = tuple(e.lower() for e in exts)
    out = []
    for entry in sorted(os.listdir(folder)):
        path = os.path.join(folder, entry)
        if os.path.isfile(path) and entry.lower().endswith(lowered):
            out.append(path)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="SHA-256 a folder or an explicit file list.")
    ap.add_argument('folder', nargs='?', help="Folder to list non-recursively.")
    ap.add_argument('--files', nargs='+', metavar='PATH',
                    help="Explicit file paths instead of a folder listing.")
    ap.add_argument('--ext', nargs='+', default=list(DEFAULT_EXTS),
                    help="Extensions to include when listing a folder.")
    args = ap.parse_args(argv)

    if args.files:
        paths = args.files
    elif args.folder:
        paths = collect(args.folder, args.ext)
    else:
        ap.error("give a folder or --files")

    files, errors = [], []
    for path in paths:
        try:
            files.append({
                'name': os.path.basename(path),
                'path': os.path.abspath(path),
                'hash': sha256_of_file(path),
            })
        except OSError as exc:
            errors.append({'path': path, 'error': str(exc)})

    json.dump({'files': files, 'errors': errors}, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
