// The shape of the maintainer's read, for suggestion-list. It imports nothing,
// so it runs under Node as well as Deno. checkListRequest returns the status to
// filter on, or null for every suggestion. "new", the status a submitted
// suggestion had before items, still names 'submitted' for the callers that
// ask for it until the triage skill and intake change (lifecycle plan Phase 7).

export const STATUSES = ["submitted", "under review", "withdrawn"];

export type Checked<T> = { ok: T } | { question: string };

export function checkListRequest(body: Record<string, unknown>): Checked<string | null> {
  const status = body.status;
  if (status === undefined) return { ok: null };
  if (status === "new") return { ok: "submitted" };
  if (typeof status !== "string" || !STATUSES.includes(status)) {
    return { question: `Which suggestions should be listed: every one, or those ${STATUSES.join(", ")}?` };
  }
  return { ok: status };
}
