// Embedded Python drivers are written to the OS temp dir under a name carrying a hash of their
// source, so every process running the same build shares one file instead of leaving one per pid.
// The file is checked on every call: a temp-dir cleanup while the server runs must not break it.

import { createHash } from "node:crypto";
import { existsSync, linkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Path of the driver `coclerk-<name>-<hash>.py` holding `source`, writing it if absent. */
export function pythonDriverFile(name: string, source: string): string {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const p = join(tmpdir(), `coclerk-${name}-${hash}.py`);
  if (existsSync(p)) return p;
  // Write aside, then link into place: the driver appears whole or not at all, and a link
  // (unlike a rename on Windows) reports EEXIST when another process published it first.
  const temp = `${p}.${process.pid}.tmp`;
  writeFileSync(temp, source, "utf-8");
  try {
    linkSync(temp, p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  } finally {
    unlinkSync(temp);
  }
  return p;
}
