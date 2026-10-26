// The shape of a specification sent after its suggestion, for
// suggestion-attach-specification. It imports nothing, so it runs under Node as
// well as Deno. checkAttachRequest returns what to save, or a guiding question
// about the suggestion when it would not be saved (COMMANDMENTS.md,
// Commandment 6). The plugin has already checked the specification against
// the card and removed any match (decision 18); this checks only the shape.

export const MAX_SPECIFICATION = 100_000;
export const MAX_BACKSTOP_JSON = 20_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = ["suggestion_id", "specification", "backstop_result"];

export type Checked<T> = { ok: T } | { question: string };

export interface Attachment {
  suggestion_id: string;
  specification: string;
  backstop_result: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function checkAttachRequest(body: Record<string, unknown>): Checked<Attachment> {
  const extra = Object.keys(body).find((key) => !FIELDS.includes(key));
  if (extra) return { question: `Not saved. What is "${extra}" for in this request?` };
  const id = body.suggestion_id;
  if (typeof id !== "string" || !UUID.test(id)) {
    return { question: "Not saved. Which suggestion, by the suggestion_id submit returned, is this specification for?" };
  }
  const spec = body.specification;
  if (typeof spec !== "string" || !spec.trim() || spec.length > MAX_SPECIFICATION) {
    return { question: `Not saved. What does the specification say, in 1 to ${MAX_SPECIFICATION} characters?` };
  }
  const backstop = body.backstop_result;
  if (!isObject(backstop) || JSON.stringify(backstop).length > MAX_BACKSTOP_JSON) {
    return { question: "Not saved. What did the backstop find when it checked this specification, as one JSON object of a modest size?" };
  }
  return { ok: { suggestion_id: id.toLowerCase(), specification: spec, backstop_result: backstop } };
}
