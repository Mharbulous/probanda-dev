// The maintainer's side of the key-request queue, for /view-key-requests
// (source/skills/view-key-requests/SKILL.md). Run from Probanda's development
// machine.
//
//   node key-requests.mjs list [--all]
//   node key-requests.mjs set-status <request_id> <issued|declined>
//
// `list` prints the requests still `pending`, oldest first, as JSON; `list --all`
// prints every request, whatever its status. `set-status` records an outcome
// once, after the key has been minted and delivered or refused, and clears the
// details the practitioner typed; the function refuses a second call on the
// same row. The secret key comes from the environment variable POOL_SECRET_KEY,
// set by the person running this in their own terminal. This script prints no
// key.

const BASE = "https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/";
const key = process.env.POOL_SECRET_KEY;
if (!key) throw new Error("set POOL_SECRET_KEY first");
const USAGE = "usage: node key-requests.mjs list [--all] | set-status <request_id> <issued|declined>";

async function call(fn, body) {
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
  return reply;
}

const [command, ...args] = process.argv.slice(2);
if (command === "list") {
  if (args.length > 1 || (args.length && args[0] !== "--all")) throw new Error(USAGE);
  const { requests } = await call("key-request-list", args.length ? {} : { status: "pending" });
  console.log(JSON.stringify(requests, null, 1));
} else if (command === "set-status") {
  const [id, status, ...rest] = args;
  if (!id || !status || rest.length) throw new Error(USAGE);
  console.log(JSON.stringify(await call("key-request-set-status", { request_id: id, status })));
} else {
  throw new Error(USAGE);
}
