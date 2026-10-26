// The shape of a status write, for suggestion-set-status. It imports nothing,
// so it runs under Node as well as Deno. checkSetStatus returns which write the
// request is and its values, or a guiding question about it when it would not
// be saved (COMMANDMENTS.md, Commandment 6). Whether the write is allowed is
// for the functions in cloud/suggestions/suggestions.sql, which hold the rules;
// this checks only the shape.
//
// The five writes:
//   issue        { suggestion_id, issue_number }
//                Probanda's automation (intake) records the issue the suggestion
//                is filed under, without changing its status
//   item         { suggestion_id, item, status: "approved" | "declined", reason, category? }
//                the maintainer decides one item (category to decline)
//   implemented  { suggestion_id, item, status: "implemented", implemented_in: "<plugin> <version>" }
//                Probanda's automation marks one approved item shipped
//   review       { suggestion_id, status: "under review", issue_number? }
//                Probanda's automation opens the suggestion for review
//   legacy       { suggestion_id, status: "approved" | "approved in part" | "rejected",
//                  issue_number?, reason?, category? }
//                the old whole-suggestion decision, applied to every item, kept
//                until the triage skill decides per item

export const MAX_REASON = 200;
export const MAX_ITEM = 50;

// The same list as suggestions.decline_categories() in suggestions.sql; the
// Suggestion Box's Postgres test checks that the two agree.
export const DECLINE_CATEGORIES = [
  "not enough detail",
  "already works as asked",
  "already suggested",
  "outside what Probanda does",
  "cost outweighs benefit",
  "conflicts with how Probanda must work",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELEASE = /^[a-z][a-z-]* [0-9]+\.[0-9]+\.[0-9]+$/;
const LEGACY = new Set(["approved", "approved in part", "rejected"]);

export type Checked<T> = { ok: T } | { question: string };

export type SetStatus =
  | { form: "item"; suggestion_id: string; item: number; status: "approved" | "declined"; reason: string; category: string | null }
  | { form: "implemented"; suggestion_id: string; item: number; implemented_in: string }
  | { form: "issue"; suggestion_id: string; issue_number: number }
  | { form: "review"; suggestion_id: string; issue_number: number | null }
  | { form: "legacy"; suggestion_id: string; status: string; issue_number: number | null; reason: string | null; category: string | null };

type Obj = Record<string, unknown>;

const FORM_KEYS: Record<SetStatus["form"], string[]> = {
  item: ["suggestion_id", "item", "status", "reason", "category"],
  implemented: ["suggestion_id", "item", "status", "implemented_in"],
  issue: ["suggestion_id", "issue_number"],
  review: ["suggestion_id", "status", "issue_number"],
  legacy: ["suggestion_id", "status", "issue_number", "reason", "category"],
};

/** A reason as saved: trimmed, one line, 1 to MAX_REASON characters; or null. */
export function cleanReason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const reason = v.trim();
  return reason.length >= 1 && reason.length <= MAX_REASON && !/[\r\n]/.test(reason) ? reason : null;
}

export const REASON_QUESTION =
  `Not saved. In one short line of plain words (at most ${MAX_REASON} characters) that a practitioner could read, why was this item decided this way?`;

export const CATEGORY_QUESTION =
  `Not saved. Which of these best says why the item was declined: ${DECLINE_CATEGORIES.join("; ")}?`;

export function checkSetStatus(body: Obj): Checked<SetStatus> {
  const id = body.suggestion_id;
  if (typeof id !== "string" || !UUID.test(id)) {
    return { question: "Not saved. Which suggestion, by its suggestion_id, is this about?" };
  }
  const status = body.status;
  if (status === undefined && body.item === undefined && body.issue_number !== undefined) {
    const extra = Object.keys(body).find((key) => !FORM_KEYS.issue.includes(key));
    if (extra) return { question: `Not saved. What is "${extra}" for in this request?` };
    const issue = body.issue_number;
    if (!(Number.isInteger(issue) && (issue as number) > 0)) {
      return { question: "Not saved. Which issue number is this suggestion filed under?" };
    }
    return { ok: { form: "issue", suggestion_id: id, issue_number: issue as number } };
  }
  if (typeof status !== "string") {
    return { question: "Not saved. Is this suggestion under review, or is one of its items approved, declined or implemented?" };
  }
  let form: Exclude<SetStatus["form"], "issue">;
  if (body.item !== undefined) {
    if (!Number.isInteger(body.item) || (body.item as number) < 1 || (body.item as number) > MAX_ITEM) {
      return { question: "Not saved. Which of this suggestion's items, by its number, is this about?" };
    }
    if (status === "approved" || status === "declined") form = "item";
    else if (status === "implemented") form = "implemented";
    else return { question: "Not saved. Is this item approved, declined or implemented?" };
  } else if (status === "under review") {
    form = "review";
  } else if (LEGACY.has(status)) {
    form = "legacy";
  } else {
    return { question: "Not saved. Which item, by its number, is this decision about?" };
  }
  const extra = Object.keys(body).find((key) => !FORM_KEYS[form].includes(key));
  if (extra) return { question: `Not saved. What is "${extra}" for in this request?` };

  const issue = body.issue_number;
  if (issue !== undefined && !(Number.isInteger(issue) && (issue as number) > 0)) {
    return { question: "Not saved. Which issue number is this suggestion filed under?" };
  }
  const issueNumber = (issue as number | undefined) ?? null;
  const category = body.category;
  if (category !== undefined && (typeof category !== "string" || !DECLINE_CATEGORIES.includes(category))) {
    return { question: CATEGORY_QUESTION };
  }

  switch (form) {
    case "item": {
      const reason = cleanReason(body.reason);
      if (!reason) return { question: REASON_QUESTION };
      if (status === "declined" && category === undefined) return { question: CATEGORY_QUESTION };
      if (status === "approved" && category !== undefined) {
        return { question: "Not saved. Is this item approved, or declined for that reason?" };
      }
      return { ok: { form, suggestion_id: id, item: body.item as number, status: status as "approved" | "declined", reason, category: (category as string | undefined) ?? null } };
    }
    case "implemented": {
      const release = body.implemented_in;
      if (typeof release !== "string" || !RELEASE.test(release)) {
        return { question: "Not saved. Which plugin and version, such as lawyer 0.4.2, shipped this item's fix?" };
      }
      return { ok: { form, suggestion_id: id, item: body.item as number, implemented_in: release } };
    }
    case "review":
      return { ok: { form, suggestion_id: id, issue_number: issueNumber } };
    case "legacy": {
      const reason = body.reason === undefined ? null : cleanReason(body.reason);
      if (body.reason !== undefined && !reason) return { question: REASON_QUESTION };
      if (category !== undefined && status !== "rejected") {
        return { question: "Not saved. Is this suggestion approved, or rejected for that reason?" };
      }
      return { ok: { form, suggestion_id: id, status, issue_number: issueNumber, reason, category: (category as string | undefined) ?? null } };
    }
  }
}
