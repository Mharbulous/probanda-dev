// The shape of a withdrawal, for suggestion-withdraw. It imports nothing, so it
// runs under Node as well as Deno. checkWithdrawRequest returns the id to
// withdraw, lower case, or a guiding question about the request when nothing
// would be withdrawn (COMMANDMENTS.md, Commandment 6).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Checked<T> = { ok: T } | { question: string };

export function checkWithdrawRequest(body: Record<string, unknown>): Checked<string> {
  const id = body.suggestion_id;
  if (Object.keys(body).some((key) => key !== "suggestion_id") || typeof id !== "string" || !UUID.test(id)) {
    return { question: "Not withdrawn. Which suggestion, by the suggestion_id submit returned, should be withdrawn?" };
  }
  return { ok: id.toLowerCase() };
}
