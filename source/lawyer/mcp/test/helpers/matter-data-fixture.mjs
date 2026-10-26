// A real /matter-data main.sqlite, built from /matter-data's canonical schema.sql (party/counsel SSOT).
//
// The drafting runtime reads counsel of record and the address for service from case data, through
// /matter-data's own parties_of_record.py, in the folder holding the submission database. A test that
// renders a drafting Writing's parties writes this database beside its submission database, so the
// render exercises the real read, never a seam.

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const { caseDataMigrateScriptsDir } = await import("../../build/repo-root.js");

const BUILD_CASE_DATA = `
import sqlite3, sys
sys.path.insert(0, sys.argv[1])
import rebuild, resolve_paths
sections = rebuild.parse_sections(rebuild.read_ref('schema.sql'))
con = sqlite3.connect(sys.argv[2])
con.executescript(sections['main'])
con.executescript(sys.argv[3])
con.execute('PRAGMA user_version = %d' % resolve_paths.EXPECTED_USER_VERSION)
con.commit()
con.close()
`;

function python(args) {
  const res = spawnSync(process.env.COCLERK_PYTHON || "python", args, { encoding: "utf-8" });
  if (res.status !== 0) throw new Error(`matter-data fixture failed: ${res.stderr}`);
}

/** Writes `<caseDataDir>/main.sqlite` from the canonical schema at the current version plus `seed`
 * (SQL), replacing any database already there. `scriptsDir` names /matter-data's scripts folder on a
 * host whose paths the runtime's resolver does not handle (it resolves Windows paths only). */
export function writeCaseData(caseDataDir, seed, scriptsDir = caseDataMigrateScriptsDir(process.env)) {
  const main = join(caseDataDir, "main.sqlite");
  rmSync(main, { force: true });
  python(["-c", BUILD_CASE_DATA, scriptsDir, main, seed]);
}

const BUILD_SIDE_STORES = `
import os, sqlite3, sys
sys.path.insert(0, sys.argv[1])
import rebuild
sections = rebuild.parse_sections(rebuild.read_ref('schema.sql'))
for name in ('law', 'privileged'):
    path = os.path.join(sys.argv[2], name + '.sqlite')
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    con.executescript(sections[name])
    con.commit()
    con.close()
`;

/** writeCaseData, plus an empty `law.sqlite` and `privileged.sqlite` from the same schema: for a
 * read that attaches all three, such as ingest coverage. */
export function writeCaseDataStores(caseDataDir, seed = "") {
  writeCaseData(caseDataDir, seed);
  python(["-c", BUILD_SIDE_STORES, caseDataMigrateScriptsDir(process.env), caseDataDir]);
}

/** Runs `sql` against the matter-data database in `caseDataDir`. */
export function updateCaseData(caseDataDir, sql) {
  python([
    "-c",
    "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit(); c.close()",
    join(caseDataDir, "main.sqlite"),
    sql,
  ]);
}

const lit = (value) => (value === null || value === undefined ? "NULL" : `'${String(value).replace(/'/g, "''")}'`);

/**
 * Seed SQL for case data holding `proceedings` and `parties`. Each party carries counsel and the
 * address for service under the drafting runtime's own field names, and is of record in each
 * `[proceedingId, role]` its `of_record` names (role in /matter-data's vocabulary, e.g. "plaintiff").
 *
 *   proceedings: [{ id, file_number, court = "BCSC" }]
 *   parties: [{ id, name, counsel_name, counsel_firm, counsel_email, counsel_phone, address_for_service, of_record = [] }]
 */
export function partiesOfRecordSeed({ proceedings = [], parties = [] }) {
  const sql = [];
  for (const p of proceedings) {
    sql.push(`INSERT INTO proceedings (proceeding_id, court, file_number) VALUES (${p.id}, ${lit(p.court ?? "BCSC")}, ${lit(p.file_number)});`);
  }
  for (const p of parties) {
    sql.push(
      "INSERT INTO parties (party_id, name, lawyer_name, lawyer_firm, lawyer_email, lawyer_phone, address) VALUES " +
        `(${p.id}, ${lit(p.name)}, ${lit(p.counsel_name)}, ${lit(p.counsel_firm)}, ${lit(p.counsel_email)}, ${lit(p.counsel_phone)}, ${lit(p.address_for_service)});`
    );
    for (const [proceedingId, role] of p.of_record ?? []) {
      sql.push(`INSERT INTO proceeding_parties (proceeding_id, party_id, role) VALUES (${proceedingId}, ${p.id}, ${lit(role)});`);
    }
  }
  return sql.join("\n");
}

/** writeCaseData with partiesOfRecordSeed's SQL. */
export function writePartiesOfRecord(caseDataDir, spec) {
  writeCaseData(caseDataDir, partiesOfRecordSeed(spec));
}
