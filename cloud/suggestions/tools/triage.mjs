// The maintainer's side of the Suggestion Box, for /suggestion-triage,
// /adversarial-triage and /view-suggestions (.claude/skills/<name>/SKILL.md). Run
// from Probanda's development machine.
//
//   node triage.mjs list [--all]
//   node triage.mjs set-status <suggestion_id> <approved|"approved in part"|rejected> [--issue <n>]
//
// `list` prints the suggestions still `new`, oldest first, as JSON; `list --all`
// prints every suggestion, whatever its status, oldest first. `set-status`
// records a triage outcome once; the function refuses a second call on the
// same row. The secret key comes from the environment variable POOL_SECRET_KEY,
// set by the person running this in their own terminal. This script prints no
// key. In a cloud session, POOL_KEY_FROM_PROXY=1 sends no key: the cloud
// environment's network secret for the project host adds it outside the session.

const BASE = "https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/";
const key = process.env.POOL_SECRET_KEY;
const keyFromProxy = process.env.POOL_KEY_FROM_PROXY === "1";
if (!key && !keyFromProxy) throw new Error("set POOL_SECRET_KEY first");
const USAGE = 'usage: node triage.mjs list [--all] | set-status <suggestion_id> <status> [--issue <n>]';

async function call(fn, body) {
  const res = await fetch(BASE + fn, {
    method: "POST",
    headers: key ? { apikey: key, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const reply = JSON.parse(await res.text());
  if (!res.ok) {
    console.error(`${res.status} ${JSON.stringify(reply)}`);
    process.exit(1);
  }
  return reply;
}

const [command, ...args] = process.argv.slice(2);
if (command === "list") {
  if (args.length > 1 || (args.length && args[0] !== "--all")) throw new Error(USAGE);
  const { suggestions } = await call("suggestion-list", args.length ? {} : { status: "new" });
  console.log(JSON.stringify(suggestions, null, 1));
} else if (command === "set-status") {
  const [id, status, flag, issue] = args;
  if (!id || !status || (flag !== undefined && (flag !== "--issue" || !issue))) throw new Error(USAGE);
  const body = { suggestion_id: id, status };
  if (issue) body.issue_number = Number(issue);
  console.log(JSON.stringify(await call("suggestion-set-status", body)));
} else {
  throw new Error(USAGE);
}
