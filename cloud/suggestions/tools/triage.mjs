// The maintainer's side of the Suggestion Box, for /hitl-triage,
// /view-suggestions (source/skills/<name>/SKILL.md) and
// /triage-issue run locally (.claude/commands/triage-issue.md). Run from
// Probanda's development machine.
//
//   node triage.mjs list [--all]
//   node triage.mjs show <suggestion_id>
//   node triage.mjs set-review <suggestion_id> [<n>]
//   node triage.mjs set-item <suggestion_id> <item> approved --reason "<text>"
//   node triage.mjs set-item <suggestion_id> <item> declined --reason "<text>" --category "<category>"
//   node triage.mjs set-issue <suggestion_id> <n>
//
// `list` prints the suggestions still submitted (not yet opened by triage),
// oldest first, as JSON; `list --all` prints every suggestion, whatever its
// status, oldest first. Each row carries its badge and item_list, its items in
// order with their text and decisions. `show` prints the one row with that id,
// the cloud record that triage reads (design decision 16), or fails when the
// Suggestion Box holds no such row.
//
// `set-review` opens a suggestion for review, with the issue it is filed under
// when given, as triage step 1 does.
//
// `set-item` records the maintainer's decision on one item, with a short reason
// a practitioner reads, and for a decline one of the fixed categories
// (cloud/legal-commons/supabase/functions/suggestion-set-status/shape.ts). A
// decided item is never decided again; the function refuses a second call.
// Every decision names its item: the old whole-suggestion `set-status` is
// retired (lifecycle plan Phase 7).
//
// `set-issue` records the issue a suggestion is filed under, as intake does,
// without changing its status; the function refuses a different issue once
// one is recorded.
//
// The secret key comes from the environment variable POOL_SECRET_KEY, set by
// the person running this in their own terminal. This script prints no key.

const BASE = "https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/";
const USAGE = 'usage: node triage.mjs list [--all]' +
  ' | show <suggestion_id>' +
  ' | set-review <suggestion_id> [<n>]' +
  ' | set-item <suggestion_id> <item> <approved|declined> --reason "<text>" [--category "<category>"]' +
  ' | set-issue <suggestion_id> <n>';
const NUMBER = /^[1-9][0-9]*$/;

// Flags after the positional arguments, as { name: value }; null when a flag is
// unknown, repeated or has no value.
function flags(args, allowed) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.startsWith("--") ? args[i].slice(2) : null;
    if (!name || !allowed.includes(name) || name in out || args[i + 1] === undefined) return null;
    out[name] = args[i + 1];
  }
  return out;
}

const [command, ...args] = process.argv.slice(2);
let fn;
let body;
if (command === "list") {
  if (args.length > 1 || (args.length && args[0] !== "--all")) throw new Error(USAGE);
  fn = "suggestion-list";
  body = args.length ? {} : { status: "submitted" };
} else if (command === "show") {
  if (args.length !== 1 || !args[0]) throw new Error(USAGE);
  fn = "suggestion-list";
  body = {};
} else if (command === "set-review") {
  const [id, issue] = args;
  if (!id || args.length > 2 || (issue !== undefined && !NUMBER.test(issue))) throw new Error(USAGE);
  fn = "suggestion-set-status";
  body = { suggestion_id: id, status: "under review" };
  if (issue !== undefined) body.issue_number = Number(issue);
} else if (command === "set-item") {
  const [id, item, status, ...rest] = args;
  const f = flags(rest, ["reason", "category"]);
  if (!id || !NUMBER.test(item ?? "") || !["approved", "declined"].includes(status) || !f || !f.reason) {
    throw new Error(USAGE);
  }
  fn = "suggestion-set-status";
  body = { suggestion_id: id, item: Number(item), status, reason: f.reason };
  if (f.category !== undefined) body.category = f.category;
} else if (command === "set-issue") {
  const [id, issue] = args;
  if (!id || !NUMBER.test(issue ?? "") || args.length !== 2) throw new Error(USAGE);
  fn = "suggestion-set-status";
  body = { suggestion_id: id, issue_number: Number(issue) };
} else {
  throw new Error(USAGE);
}

const key = process.env.POOL_SECRET_KEY;
if (!key) throw new Error("set POOL_SECRET_KEY first");

const res = await fetch(BASE + fn, {
  method: "POST",
  headers: { apikey: key, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const reply = JSON.parse(await res.text());
if (!res.ok) {
  console.error(`${res.status} ${JSON.stringify(reply)}`);
  process.exit(1);
}
if (command === "show") {
  const row = reply.suggestions.find((s) => s.suggestion_id === args[0].toLowerCase());
  if (!row) {
    console.error(`the Suggestion Box holds no suggestion ${args[0]}`);
    process.exit(1);
  }
  console.log(JSON.stringify(row, null, 1));
} else {
  console.log(command === "list" ? JSON.stringify(reply.suggestions, null, 1) : JSON.stringify(reply));
}
