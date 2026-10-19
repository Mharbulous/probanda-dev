// The shape of a suggestion's optional items and previews, for suggestion-submit.
// It imports nothing, so it runs under Node as well as Deno. Each check returns
// the value to save, or a guiding question about the suggestion when it would
// not be saved (COMMANDMENTS.md, Commandment 6). The plugin screens every
// string for personal and matter details first; this checks only the shape.

export const MAX_TEXT = 2000;
export const MAX_ITEMS = 10;
export const MAX_ITEMS_JSON = 50_000;
export const MAX_PREVIEWS = 4;
export const MAX_HTML = 200_000;

const ORIGINS = new Set(["probanda", "lawyer"]);

export type Checked<T> = { ok: T } | { question: string };

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const hasOnly = (v: Obj, keys: string[]) => Object.keys(v).every((key) => keys.includes(key));
const isText = (v: unknown, max = MAX_TEXT): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

function isItem(v: unknown): boolean {
  if (!isObject(v) || !hasOnly(v, ["pain", "where", "done_test", "constraints", "changes"])) return false;
  if (!isText(v.pain) || !isText(v.where) || !isText(v.done_test)) return false;
  if (!Array.isArray(v.constraints) || !v.constraints.every((c) => isText(c))) return false;
  return Array.isArray(v.changes) && v.changes.every((c) =>
    isObject(c) && hasOnly(c, ["change", "origin"]) && isText(c.change) &&
    typeof c.origin === "string" && ORIGINS.has(c.origin)
  );
}

function isPreview(v: unknown): boolean {
  if (!isObject(v) || !hasOnly(v, ["label", "chosen", "reason", "html"])) return false;
  return isText(v.label) && typeof v.chosen === "boolean" &&
    (v.reason === undefined || isText(v.reason)) && isText(v.html, MAX_HTML);
}

export function checkItems(v: unknown): Checked<unknown[] | null> {
  if (v === undefined) return { ok: null };
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_ITEMS) {
    return { question: `Which of this suggestion's pains matter most, if it is to be told in 1 to ${MAX_ITEMS} items?` };
  }
  if (!v.every(isItem)) {
    return {
      question: "For each item, what is the pain, where does it arise, what would show it is solved, " +
        "what must stay true, and which changes would fix it, each marked as Probanda's idea or the lawyer's?",
    };
  }
  if (JSON.stringify(v).length > MAX_ITEMS_JSON) {
    return { question: "Could each item say the same in fewer words, so that the items together are shorter?" };
  }
  return { ok: v };
}

export function checkPreviews(v: unknown): Checked<unknown[] | null> {
  if (v === undefined) return { ok: null };
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_PREVIEWS) {
    return { question: `Which ${MAX_PREVIEWS} Previews or fewer best show the chosen design and the ones set aside?` };
  }
  if (!v.every(isPreview)) {
    return {
      question: "For each Preview, what is its label, is it the chosen one, why was it chosen or set aside, " +
        "and could its page be smaller?",
    };
  }
  return { ok: v };
}
