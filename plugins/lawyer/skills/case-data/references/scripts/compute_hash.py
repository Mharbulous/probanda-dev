#!/usr/bin/env python3
"""compute_hash.py — SHA-256 (lowercase hex) of a file's raw bytes.

Streams the file in 1 MB chunks so an arbitrarily large PDF never loads whole
into memory. This is the same hash the extractor, the ingest gate, and the
drift checks rely on, so it must be byte-exact and lowercase hex. Hash the raw
bytes on disk — never extracted text, never a converted rendering.

E1-ONLY. Do not run/import/copy/stage in a mediated/sandboxed (E2) filesystem —
the mount may serve stale/truncated bytes, producing a hash of a truncated file.
Use the inline code in the operation files there instead. See ../scripts.md.

Usage:
    python3 compute_hash.py <file>
"""

import argparse
import hashlib


def sha256_of_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main(argv=None):
    ap = argparse.ArgumentParser(description="SHA-256 (lowercase hex) of a file.")
    ap.add_argument('file', help="Path to the file to hash.")
    args = ap.parse_args(argv)
    print(sha256_of_file(args.file))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
