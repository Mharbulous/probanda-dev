// Retention for the copy-aside backups the drafting-data and timecamping-data migrate engines write
// beside their database (`<db>.bak-<UTC stamp>[-n]`, #353). After a migrate succeeds, only the copy
// taken before its first hop is kept. An older copy predates a migration that has since succeeded,
// and restoring it would undo every write made after it. A hand-labelled copy is never touched.

import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const STAMP = /^\.bak-\d{8}T\d{6}Z(-\d+)?$/;

/** The engine's timestamped backups beside dbPath, by file name. */
export function timestampedBackups(dbPath: string): Set<string> {
  const dir = dirname(dbPath);
  const name = basename(dbPath);
  return new Set(existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(name) && STAMP.test(f.slice(name.length))) : []);
}

/** Called after a successful migrate, with the backups that existed before it. Keeps the earliest
 * backup the migrate wrote, the copy taken before its first hop, and removes every other timestamped
 * backup. A migrate that wrote no backup removes nothing. Returns one warning per backup it could
 * not remove; the migrate itself has still succeeded. */
export function pruneBackups(dbPath: string, before: Set<string>): string[] {
  const all = [...timestampedBackups(dbPath)];
  const kept = all.filter((f) => !before.has(f)).sort()[0];
  if (kept === undefined) return [];
  const warnings: string[] = [];
  for (const f of all) {
    if (f === kept) continue;
    try {
      unlinkSync(join(dirname(dbPath), f));
    } catch (err) {
      warnings.push(`could not remove the older migration backup ${f} (${(err as Error).message}); the migrate succeeded and ${kept} is the backup to keep`);
    }
  }
  return warnings;
}
