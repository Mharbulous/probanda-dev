#!/usr/bin/env python3
"""Block the shared legal-commons pool's write tools (Probanda phase 1).

Probanda ships the commons read side only. Pushing matter-derived principles or
rule records to the shared pool is withheld until COMMANDMENTS.md says how it may
be done, so every write tool is refused here.
"""
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve()
    # shared/scripts in the built plugin, else in this repo's source tree
    sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                     HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
    import hook_io
except Exception as exc:  # a crash would let the write through
    sys.stderr.write(f"Refused: commons-read-only cannot load its helper: {exc!r}\n")
    sys.exit(2)

hook_io.deny(
    "Probanda's shared legal-commons pool is read-only for now. Writing to it "
    "(push, amend, link, merge, record, stamp, retire) is not available in this "
    "plugin. Tell the user the write was not made."
)
