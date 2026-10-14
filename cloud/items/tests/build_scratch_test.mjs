// Builds one SQL script that tests ledger.sql and rules.sql in scratch schemas,
// and writes it to the path given.
//
//   node build_scratch_test.mjs <output.sql> [ledger scratch name] [rules scratch name]
//
// The script it writes, as one transaction: creates the two scratch schemas,
// applies ledger.sql then rules.sql twice each (the second time proves they are
// idempotent), runs the tests in scratch_test.template.sql, drops both scratch
// schemas, and as its last statement returns one row per test. A run that fails
// leaves nothing behind.
//
// The tested SQL is the shipped SQL with the two schema names replaced where
// they name a schema: a qualified name (rules.apply_write), a schema clause
// (schema rules, schema if not exists rules) and a quoted name ('rules'). The
// files' own begin and commit lines are removed. Other words are left alone.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ITEMS = path.resolve(HERE, "..");
const LIVE = ["ledger", "rules"];

const [out, ledgerName = "items_scratch_ledger", rulesName = "items_scratch_rules"] = process.argv.slice(2);
if (!out) throw new Error("usage: node build_scratch_test.mjs <output.sql> [ledger scratch name] [rules scratch name]");
const scratch = { ledger: ledgerName, rules: rulesName };
for (const name of Object.values(scratch)) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name) || LIVE.includes(name)) {
    throw new Error(`"${name}" cannot be a scratch schema's name`);
  }
}

const read = (...parts) => fs.readFileSync(path.join(ITEMS, ...parts), "utf8").replace(/\r\n/g, "\n");
for (const file of [["ledger.sql"], ["rules.sql"], ["tests", "scratch_test.template.sql"]]) {
  const text = read(...file);
  if (/[^\x00-\x7f]/.test(text)) throw new Error(`${file.join("/")} is not plain ASCII`);
  if (/pgrst/i.test(text)) throw new Error(`${file.join("/")} mentions pgrst; these schemas are never exposed`);
}
const shipped = (file) =>
  read(file)
    .split("\n")
    .filter((line) => !/^(begin|commit);\s*$/.test(line))
    .join("\n");

const rename = (text) =>
  text
    .replace(/\b(ledger|rules)\.(?=[a-z_])/g, (_, s) => `${scratch[s]}.`)
    .replace(/\bschema( if not exists)? (ledger|rules)\b/g, (_, ine, s) => `schema${ine ?? ""} ${scratch[s]}`)
    .replace(/'(ledger|rules)'/g, (_, s) => `'${scratch[s]}'`);

const script = [
  "begin;",
  `create schema ledger;  -- stops here if the scratch schema already exists`,
  `create schema rules;`,
  shipped("ledger.sql"),
  shipped("rules.sql"),
  shipped("ledger.sql"),
  shipped("rules.sql"),
  "create temp table t_result (seq serial, name text, pass boolean, detail text);",
  "create temp table t_question (question text);",
  read("tests", "scratch_test.template.sql"),
  "drop schema rules cascade;",
  "drop schema ledger cascade;",
  "commit;",
  "select name, pass, detail from t_result order by seq;",
]
  .map(rename)
  .join("\n\n");

// Refuse if a live schema name survives anywhere outside a comment. Schema
// names are lower case, so "Civil Rules" in the overlay fixture is not one.
const code = script.replace(/--[^\n]*/g, "");
const survivor = code.match(/\b(ledger|rules)\b/);
if (survivor) {
  const at = code.indexOf(survivor[0], survivor.index);
  throw new Error(`a live schema name survives the renaming: ...${code.slice(Math.max(0, at - 60), at + 60)}...`);
}

fs.writeFileSync(out, script + "\n");
console.log(`wrote ${out}: scratch schemas ${scratch.ledger} and ${scratch.rules}`);
