// Builds one SQL script that tests migration 0001 and consequence_functions.sql
// in a scratch schema, and writes it to the path given.
//
//   node build_scratch_test.mjs <output.sql> [scratch schema name]
//
// The script it writes: makes the scratch schema with empty copies of the
// existing tables (from schema.sql), applies the migration and the functions,
// runs the tests in scratch_test.template.sql, runs the down script, checks the
// schema is as it was before the migration, and drops the scratch schema. It is
// one transaction, so a run that fails leaves nothing behind. Its last statement
// returns one row per test.
//
// The tested SQL is the shipped SQL: the files are used as they are, with the
// schema name replaced throughout and three kinds of line removed (the files'
// own begin and commit, and the notice to PostgREST, which a scratch run must
// not send). The query in queries/exception_gaps.sql is tested as it is too.
//
// The expected results of the tidying rule are computed here by the plugin's own
// rank.ts, so the SQL version is tested against the real one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalize } from "../../../source/legal/mcp/src/phrases/rank.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POOL = path.resolve(HERE, "..");
const LIVE = "legal_commons";

const [out, scratch = "lc_scratch"] = process.argv.slice(2);
if (!out) throw new Error("usage: node build_scratch_test.mjs <output.sql> [scratch schema name]");
if (!/^[a-z_][a-z0-9_]*$/.test(scratch) || scratch.includes(LIVE)) {
  throw new Error(`"${scratch}" cannot be the scratch schema's name`);
}

const read = (...parts) => fs.readFileSync(path.join(POOL, ...parts), "utf8").replace(/\r\n/g, "\n");
const shipped = (...parts) =>
  read(...parts)
    .split("\n")
    .filter((line) => !/^(begin|commit);\s*$/.test(line) && !/^notify pgrst\b/.test(line))
    .join("\n");

// A JSON literal that is plain ASCII, so the script survives any editor.
const ascii = (value) =>
  JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const cases = JSON.parse(read("tests", "tidy_cases.json")).map((text) => ({ in: text, out: normalize(text) }));
const casesLiteral = `'${ascii(cases).replace(/'/g, "''")}'::jsonb`;

// The exception-gaps query, as it is in its file, less its final semicolon, as a
// dollar-quoted literal the template runs.
const gaps = read("queries", "exception_gaps.sql").trimEnd().replace(/;$/, "");
if (gaps.includes(";") || gaps.includes("$q$")) throw new Error("queries/exception_gaps.sql must be one statement");
const gapsLiteral = `$q$${gaps}\n$q$`;

const SNAPSHOT = `(
  select jsonb_build_object(
    'relations', (
      select jsonb_agg(jsonb_build_array(c.relname, c.relkind, c.relrowsecurity) order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = '${LIVE}' and c.relkind in ('r', 'v', 'm', 'S')),
    'columns', (
      select jsonb_agg(jsonb_build_array(c.table_name, c.ordinal_position, c.column_name, c.udt_name,
                                         c.is_nullable, c.column_default, c.generation_expression)
                       order by c.table_name, c.ordinal_position)
      from information_schema.columns c where c.table_schema = '${LIVE}'),
    'constraints', (
      select jsonb_agg(jsonb_build_array(cl.relname, co.conname, pg_get_constraintdef(co.oid)) order by cl.relname, co.conname)
      from pg_constraint co
      join pg_class cl on cl.oid = co.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = '${LIVE}'),
    'indexes', (
      select jsonb_agg(jsonb_build_array(i.tablename, i.indexname, i.indexdef) order by i.tablename, i.indexname)
      from pg_indexes i where i.schemaname = '${LIVE}'),
    'functions', (
      select jsonb_agg(jsonb_build_array(p.proname, pg_get_function_identity_arguments(p.oid), md5(p.prosrc))
                       order by p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = '${LIVE}'),
    'table_grants', (
      select jsonb_agg(jsonb_build_array(g.table_name, g.grantee, g.privilege_type)
                       order by g.table_name, g.grantee, g.privilege_type)
      from information_schema.role_table_grants g where g.table_schema = '${LIVE}'))
)`;

const script = [
  "begin;",
  `create schema ${LIVE};  -- stops here if the scratch schema already exists`,
  shipped("schema.sql"),
  "create temp table lc_test_result (seq serial, name text, pass boolean, detail text);",
  "create temp table lc_snapshot on commit drop as select " + SNAPSHOT + " as before;",
  shipped("migrations", "0001_consequence_structure.sql"),
  shipped("consequence_functions.sql"),
  read("tests", "scratch_test.template.sql")
    .replace("/*TIDY_CASES*/", () => casesLiteral)
    .replace("/*EXCEPTION_GAPS*/", () => gapsLiteral),
  shipped("migrations", "0001_down.sql"),
  `insert into lc_test_result (name, pass, detail)
select 'the down script leaves the schema as it was before the migration',
       s.before = ${SNAPSHOT},
       case when s.before = ${SNAPSHOT} then null else 'the schema differs from the one before the migration' end
from lc_snapshot s;`,
  `drop schema ${LIVE} cascade;`,
  "commit;",
  "reset search_path;",
  "select name, pass, detail from lc_test_result order by seq;",
]
  .join("\n\n")
  .replaceAll(LIVE, scratch);

if (new RegExp(LIVE, "i").test(script)) throw new Error("the live schema's name is still in the script");
if (/[^\x00-\x7f]/.test(read("tests", "scratch_test.template.sql"))) throw new Error("the template is not plain ASCII");
// A character outside ASCII can be garbled between the file and the SQL editor,
// which changes what the statement means. Write it as a \u escape instead.
for (const file of [["migrations", "0001_consequence_structure.sql"], ["consequence_functions.sql"], ["migrations", "0001_down.sql"], ["queries", "exception_gaps.sql"]]) {
  if (/[^\x00-\x7f]/.test(read(...file))) throw new Error(`${file.join("/")} is not plain ASCII`);
}

fs.writeFileSync(out, script + "\n");
console.log(`wrote ${out}: ${cases.length} tidying cases, scratch schema ${scratch}`);
