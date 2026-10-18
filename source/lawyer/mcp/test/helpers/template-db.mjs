// A migrated submission database, built once and copied per test.
//
// A fresh submissionDataMigrate costs about 2.5 s (22 migration hops). Tests
// whose subject is not migration start from a copy of one template instead.
// The template is built through the real submissionDataMigrate and cached
// under os.tmpdir()/coclerk-test-templates/, named by a SHA-256 of the
// migration sources, so a schema change produces a new name and a stale
// template is never served. Tests about migration itself still call migrate.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { submissionDataMigrate } = await import("../../build/submission/migrate.js");
const { submissionDataMigrateScriptsDir } = await import("../../build/repo-root.js");
const { partiesSnapshotStatements } = await import("../../build/submission/forms/parties-snapshot.js");
const { fetchFiling } = await import("../../build/submission/forms/query.js");

const TEMPLATE_DIR = join(tmpdir(), "coclerk-test-templates");

function sourcesHash() {
  const scripts = submissionDataMigrateScriptsDir(process.env);
  const hash = createHash("sha256");
  for (const file of [join(scripts, "migrate_engine.py"), join(scripts, "..", "migrations.sql"), join(scripts, "..", "schema.sql")]) {
    hash.update(readFileSync(file));
  }
  return hash.digest("hex").slice(0, 16);
}

let templatePath;

/** Path of the migrated template, building it on first use. */
export async function submissionTemplate() {
  if (templatePath) return templatePath;
  const target = join(TEMPLATE_DIR, `submission-${sourcesHash()}.sqlite`);
  if (!existsSync(target)) {
    mkdirSync(TEMPLATE_DIR, { recursive: true });
    const temp = join(TEMPLATE_DIR, `building-${process.pid}-${Date.now()}.sqlite`);
    await submissionDataMigrate(temp);
    // linkSync, not renameSync: on Windows a rename replaces an existing target,
    // so only a link reports that another process already put the template there.
    try {
      linkSync(temp, target);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    unlinkSync(temp);
  }
  templatePath = target;
  return target;
}

/** Puts a freshly migrated submission database at `dbPath`. */
export async function freshSubmissionDb(dbPath) {
  copyFileSync(await submissionTemplate(), dbPath);
}

/** Puts a submission database migrated to exactly `version` at `dbPath`, through the engine itself,
 * for a test of a database that stays behind the current schema. */
export function submissionDbAt(dbPath, version) {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sys, migrate_engine as m; m.migrate(sys.argv[1], int(sys.argv[2]))", dbPath, String(version)],
    { encoding: "utf-8", env: { ...process.env, PYTHONPATH: submissionDataMigrateScriptsDir(process.env) } }
  );
  if (res.status !== 0) throw new Error(`fixture migrate to v${version} failed: ${res.stderr}`);
}

/** SQL writing filing `filingId`'s parties_snapshot as the runtime's send writes it, from the matter-data
 * read (forms/parties-snapshot.ts), for a test that sets filed_on by a raw update, which the schema v42
 * guard refuses while the filing has no snapshot and its proceeding has a party. */
export function partiesSnapshotSql(dbPath, filingId) {
  const literal = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  return partiesSnapshotStatements(dbPath, fetchFiling(dbPath, filingId), "test")
    .map(({ sql, params }) => {
      let i = 0;
      return sql.replace(/\?/g, () => literal(params[i++])) + ";";
    })
    .join(" ");
}
