// The shape of a status read, for suggestion-status. It imports nothing, so it
// runs under Node as well as Deno. checkStatusRequest returns the ids to look
// up, lower case and each once, or a question about the request.

export const MAX_IDS = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Checked<T> = { ok: T } | { question: string };

export function checkStatusRequest(body: Record<string, unknown>): Checked<string[]> {
  const ids = body.suggestion_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return { question: `Which suggestions, by the 1 to ${MAX_IDS} suggestion IDs submit returned, should be looked up?` };
  }
  return { ok: [...new Set(ids.map((id: string) => id.toLowerCase()))] };
}
