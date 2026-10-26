// The shape of a suggestion, for suggestion-submit. It imports nothing, so it
// runs under Node as well as Deno. checkSubmit returns the record
// suggestions.submit saves (cloud/suggestions/suggestions.sql), or a guiding
// question about the suggestion when it would not be saved (COMMANDMENTS.md,
// Commandment 6). The plugin screens every string for personal and matter
// details first; this checks only the shape.
//
// The pain point (decisions 2 and 6) is sent as pain_point or, as before, as
// body; either way it is saved in body, which still carries it.
//
// context_lines are the card's constraint and evidence lines, in order, each
// { "kind": "constraint" | "evidence", "text" }, with no status (decision 23).
//
// items is either the card's items, in order, as a list of texts (decision 23
// of docs/Plans/2026-10-25_suggestion-design.md), or the earlier structured
// items, one object per pain, which are saved as they are. A suggestion with no
// item texts is saved with one item holding its body.

export const MAX_TEXT = 2000;
export const MAX_TAG = 100;
export const MAX_ITEMS = 10;
export const MAX_ITEMS_JSON = 50_000;
export const MAX_PREVIEWS = 4;
export const MAX_HTML = 200_000;
export const MAX_OBSERVATION = 4000;
export const MAX_FACTS_JSON = 100_000;
export const MAX_MOCKUP_BYTES = 1_000_000;
export const MAX_CONTEXT_LINES = 20;
export const MAX_CONTEXT_JSON = 20_000;

const CONTEXT_KINDS = new Set(["constraint", "evidence"]);

const ORIGINS = new Set(["probanda", "lawyer"]);
const SOURCES = new Set(["user", "llm", "assisted"]);
const CARD_ORIGINS = new Set(["practitioner", "probanda"]);

// What would make a mockup load or run anything (decision 26): a script, a
// link, an embedded page or object, a src attribute, a stylesheet import, or
// any address.
const MOCKUP_REFUSED = /<script|<link|<iframe|<object|<embed|<a\s[^>]*\bhref|\bsrc\s*=|@import|http|url\(\s*['"]?\/\//i;

export type Checked<T> = { ok: T } | { question: string };

type Obj = Record<string, unknown>;

/** The record suggestions.submit saves, by column name, plus the item texts. */
export interface Submission {
  title: string;
  body: string;
  source: string;
  plugin_version: string;
  skill?: string;
  items?: unknown[];
  previews?: unknown[];
  item_texts?: string[];
  origin?: string;
  fingerprint?: Record<string, string>;
  raw_observation?: string;
  environment_facts?: Obj;
  comment?: string;
  context_lines?: Array<{ kind: string; text: string }>;
  mockup_html?: string;
}

const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const hasOnly = (v: Obj, keys: string[]) => Object.keys(v).every((key) => keys.includes(key));
const isText = (v: unknown, max = MAX_TEXT): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const field = (v: unknown) => (typeof v === "string" ? v.trim() : "");

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

/** The earlier structured items: one object per pain. */
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

/** The card's items, in order, as texts. */
export function checkItemTexts(v: unknown[]): Checked<string[]> {
  if (v.length < 1 || v.length > MAX_ITEMS || !v.every((t) => isText(t))) {
    return { question: `What does each of this suggestion's 1 to ${MAX_ITEMS} items ask for, each in 1 to ${MAX_TEXT} characters?` };
  }
  return { ok: (v as string[]).map((t) => t.trim()) };
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

function checkFingerprint(v: unknown): Checked<Record<string, string>> {
  const question = `Which plugin, version, skill and kind of observation, each in 1 to ${MAX_TAG} characters, does this suggestion's fingerprint name?`;
  if (!isObject(v) || !hasOnly(v, ["plugin", "version", "skill", "kind"])) return { question };
  const out: Record<string, string> = {};
  for (const key of ["plugin", "version", "kind", "skill"]) {
    if (key === "skill" && v.skill === undefined) continue;
    if (!isText(v[key], MAX_TAG)) return { question };
    out[key] = (v[key] as string).trim();
  }
  return { ok: out };
}

function checkContextLines(v: unknown): Checked<Array<{ kind: string; text: string }>> {
  const question = `What are this suggestion's 1 to ${MAX_CONTEXT_LINES} constraint and evidence lines, each marked constraint or evidence, in 1 to ${MAX_TEXT} characters?`;
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_CONTEXT_LINES) return { question };
  if (!v.every((line) => isObject(line) && hasOnly(line, ["kind", "text"]) &&
    typeof line.kind === "string" && CONTEXT_KINDS.has(line.kind) && isText(line.text))) return { question };
  const lines = v.map((line) => ({ kind: line.kind as string, text: (line.text as string).trim() }));
  if (JSON.stringify(lines).length > MAX_CONTEXT_JSON) {
    return { question: "Could the constraint and evidence lines say the same in fewer words?" };
  }
  return { ok: lines };
}

function checkMockup(v: unknown): Checked<string> {
  if (typeof v !== "string" || !v.trim() || new TextEncoder().encode(v).length > MAX_MOCKUP_BYTES) {
    return { question: "Could the mockup be one page of HTML under 1 MB?" };
  }
  if (MOCKUP_REFUSED.test(v)) {
    return { question: "Could the mockup show the page with inline styles alone, with no script, link, address or outside resource?" };
  }
  return { ok: v };
}

export function checkSubmit(body: Obj): Checked<Submission> {
  const title = field(body.title);
  if (body.pain_point !== undefined && body.body !== undefined) {
    return { question: "Is this suggestion's pain point the one in pain_point or the one in body?" };
  }
  const text = field(body.pain_point !== undefined ? body.pain_point : body.body);
  const source = field(body.source);
  const pluginVersion = field(body.plugin_version);
  const skill = field(body.skill);
  if (!title || !text || title.length > MAX_TEXT || text.length > MAX_TEXT) {
    return { question: `What is this suggestion's title, and what is its pain point, each in 1 to ${MAX_TEXT} characters?` };
  }
  if (!SOURCES.has(source)) {
    return { question: "Whose words are in this suggestion: the person's own (user), drafted by Probanda and confirmed by the person (assisted), or a vetted loose thread (llm)?" };
  }
  if (!pluginVersion || pluginVersion.length > MAX_TAG) {
    return { question: `Which plugin version, in 1 to ${MAX_TAG} characters, is this suggestion about?` };
  }
  if (body.skill !== undefined && (!skill || skill.length > MAX_TAG)) {
    return { question: `Which skill, named in 1 to ${MAX_TAG} characters, is this suggestion about?` };
  }
  const out: Submission = { title, body: text, source, plugin_version: pluginVersion };
  if (skill) out.skill = skill;

  if (Array.isArray(body.items) && body.items.length > 0 && body.items.some((t) => typeof t === "string")) {
    const texts = checkItemTexts(body.items);
    if ("question" in texts) return texts;
    out.item_texts = texts.ok;
  } else {
    const items = checkItems(body.items);
    if ("question" in items) return items;
    if (items.ok) out.items = items.ok;
  }
  const previews = checkPreviews(body.previews);
  if ("question" in previews) return previews;
  if (previews.ok) out.previews = previews.ok;

  if (body.origin !== undefined) {
    if (typeof body.origin !== "string" || !CARD_ORIGINS.has(body.origin)) {
      return { question: "Who started this suggestion: the practitioner (practitioner) or Probanda, noticing something (probanda)?" };
    }
    out.origin = body.origin;
  }
  if (body.fingerprint !== undefined) {
    const fingerprint = checkFingerprint(body.fingerprint);
    if ("question" in fingerprint) return fingerprint;
    out.fingerprint = fingerprint.ok;
  }
  if (body.raw_observation !== undefined) {
    if (!isText(body.raw_observation, MAX_OBSERVATION)) {
      return { question: `What did Probanda observe, in 1 to ${MAX_OBSERVATION} characters?` };
    }
    out.raw_observation = body.raw_observation.trim();
  }
  if (body.environment_facts !== undefined) {
    if (!isObject(body.environment_facts) || JSON.stringify(body.environment_facts).length > MAX_FACTS_JSON) {
      return { question: "Which plugins, tools, host and operating system does this computer have, as one JSON object of a modest size?" };
    }
    out.environment_facts = body.environment_facts;
  }
  if (body.comment !== undefined) {
    if (!isText(body.comment)) {
      return { question: `What does the practitioner's comment say, in 1 to ${MAX_TEXT} characters?` };
    }
    out.comment = body.comment.trim();
  }
  if (body.context_lines !== undefined) {
    const lines = checkContextLines(body.context_lines);
    if ("question" in lines) return lines;
    out.context_lines = lines.ok;
  }
  if (body.mockup !== undefined) {
    const mockup = checkMockup(body.mockup);
    if ("question" in mockup) return mockup;
    out.mockup_html = mockup.ok;
  }
  return { ok: out };
}
