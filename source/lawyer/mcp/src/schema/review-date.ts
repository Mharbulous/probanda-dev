import { type ToolDefinition, objectSchema } from "./shared.js";

const ROUTE =
  " Only the /time-pipeline-data skill may call this tool -- see time_pipeline__get for how a caller from another skill's workflow satisfies that.";

// Per-date review records on billing's `timekeeping` server (issue 284, ticket 279). A date is
// judged, in progress (a live claim) or not started; a claim lasts 60 minutes.
export function reviewDateToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "review_date__claim",
      description:
        "Claim one date for review. `holder` names the claimant: the bill id, or timecamping:<UTC stamp> for a run with no bill. Returns one of: { status: \"claimed\", token, expires_at } -- keep the token, which renew, judge and release need and which is given only here; { status: \"judged\", judged_at, judged_by } -- do not review the date; { status: \"held\", holder, expires_at } -- another run holds it, do not review it or wait. A claim lasts 60 minutes; a lapsed one can be claimed by another run." + ROUTE,
      inputSchema: objectSchema([
        { name: "date", type: "str" },
        { name: "holder", type: "str" },
      ], ["date", "holder"]),
    },
    {
      name: "review_date__rejudge",
      description:
        "Open a date that was judged before the review page existed, so it has no staged block, for one more judgment that builds its blocks. Call it only when the practitioner has said to judge that date again. Returns { status: \"claimed\", token, expires_at } -- as review_date__claim does, and the earlier judgment stays on the record; { status: \"not_judged\" } -- claim the date instead; { status: \"has_blocks\", blocks } -- the date is already staged, so read it and do not judge it again; { status: \"held\", holder, expires_at } -- another run holds it." + ROUTE,
      inputSchema: objectSchema([
        { name: "date", type: "str" },
        { name: "holder", type: "str" },
      ], ["date", "holder"]),
    },
    {
      name: "review_date__renew",
      description:
        "Renew this run's claim on a date to a full 60 minutes from now. Works after the claim lapsed if no other run has claimed the date since. Returns { status: \"renewed\", expires_at }, or { status: \"claim_lost\" } when the claim is no longer this token's." + ROUTE,
      inputSchema: objectSchema([
        { name: "date", type: "str" },
        { name: "token", type: "str" },
      ], ["date", "token"]),
    },
    {
      name: "review_date__judge",
      description:
        "Mark a claimed date judged, with judged_by the claim's holder. Works after the claim lapsed if no other run has claimed the date since. Returns { status: \"judged\", judged_at, judged_by }, or { status: \"claim_lost\" } when the claim is no longer this token's." + ROUTE,
      inputSchema: objectSchema([
        { name: "date", type: "str" },
        { name: "token", type: "str" },
      ], ["date", "token"]),
    },
    {
      name: "review_date__release",
      description:
        "Give up this run's claim on a date without marking it judged, so another run can claim it. Returns { status: \"released\" }, or { status: \"claim_lost\" } when the claim is no longer this token's." + ROUTE,
      inputSchema: objectSchema([
        { name: "date", type: "str" },
        { name: "token", type: "str" },
      ], ["date", "token"]),
    },
    {
      name: "review_date__status",
      description:
        "The review status of each date: { date, status: \"not_started\" }, { date, status: \"in_progress\", holder, expires_at } or { date, status: \"judged\", judged_at, judged_by }. Writes nothing." + ROUTE,
      inputSchema: {
        type: "object",
        properties: { dates: { type: "array", items: { type: "string" } } },
        required: ["dates"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "review_date__export",
      description:
        "Write every judged date from `from` to `to` (YYYY-MM-DD, inclusive) to `out_path`, an absolute path on this machine, one line per date, {\"date\", \"judged_at\"}, sorted by date: the file vet-billable-time's tie_out.py reads as --judged. The server creates the parent folder and overwrites any file there. Returns { path, count, sha256 } of the file." + ROUTE,
      inputSchema: objectSchema([
        { name: "from", type: "str" },
        { name: "to", type: "str" },
        { name: "out_path", type: "str" },
      ], ["from", "to", "out_path"]),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    {
      name: "review_date__import_file",
      description:
        "Read a matter's judged-dates.jsonl (one {\"date\", \"judged_at\"} per line) at `path`, an absolute path on this machine, and mark judged each date not judged yet, with `judged_by`. Returns { dry_run, added, skipped }: the dates marked (or, with dry_run true, that would be) and those already judged. dry_run true writes nothing. The file is never changed." + ROUTE,
      inputSchema: objectSchema([
        { name: "path", type: "str" },
        { name: "judged_by", type: "str" },
        { name: "dry_run", type: "bool" },
      ], ["path", "judged_by", "dry_run"]),
    },
  ];
}
