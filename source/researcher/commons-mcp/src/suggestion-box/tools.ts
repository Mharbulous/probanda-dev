import { readFileSync } from "node:fs";
import { ValidationError } from "../errors.js";
import type { LegalCommonsClient } from "../legal-commons/client.js";
import { findSuggestionHits } from "../troubleshoot/redact.js";

// Runtime logic for the Suggestion Box namespace: a suggestion about the plugin
// that the practitioner expressly submits is saved in Probanda's Cloud through
// the suggestion-submit Edge Function, with the same key the legal-commons
// tools use. A post carries a title, a body, its source (user, llm or
// assisted), the researcher plugin's version, the skill it is about when the
// model names one, and optionally its items (one per pain) and UI Previews, and
// nothing else. suggestion-status reads back only the status and triage time of
// suggestions whose IDs the caller holds. Tool definitions live in schema-gen.ts.

const NOT_CONFIGURED_HINT =
  "the Suggestion Box has no key on this computer: call legal_commons__configure_credential once " +
  "and have the practitioner paste the key Probanda gave them on the page it serves";

const SOURCES = new Set(["user", "llm", "assisted"]);
const ORIGINS = new Set(["probanda", "lawyer"]);
const MAX_ITEMS = 10;
const MAX_PREVIEWS = 4;
const MAX_STATUS_IDS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The researcher plugin's version, from its own plugin.json, never from the
// model. The bundle runs as <plugin root>/commons-mcp/dist/legal-commons-mcp.js,
// so the manifest is two folders up. Read once per submit, so a version bump
// needs no server restart to show.
const MANIFEST = new URL("../../.claude-plugin/plugin.json", import.meta.url);

function pluginVersion(): string {
  let version: unknown;
  try {
    version = JSON.parse(readFileSync(MANIFEST, "utf-8")).version;
  } catch {
    throw new ValidationError("submit could not read the researcher plugin's version from its plugin.json, so nothing was sent");
  }
  if (typeof version !== "string" || !version) {
    throw new ValidationError("the researcher plugin's plugin.json names no version, so nothing was sent");
  }
  return version;
}

export function isSuggestionBoxToolName(name: string): boolean {
  return name.startsWith("suggestion_box__");
}

export function callSuggestionBoxTool(
  client: LegalCommonsClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "suggestion_box__submit":
      return submit(client, args);
    case "suggestion_box__status":
      return status(client, args);
    default:
      throw new ValidationError(`Unknown suggestion_box tool "${name}"`);
  }
}

// submit — the one post. The redaction screen runs first and refuses before any
// network call; its message names the kinds hit, never the text.
async function submit(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  if (!client.hasStaticKey()) throw new ValidationError(NOT_CONFIGURED_HINT);
  const title = String(args.title ?? "").trim();
  const body = String(args.body ?? "").trim();
  if (!title) throw new ValidationError("submit requires a title");
  if (!body) throw new ValidationError("submit requires a body");
  const source = String(args.source ?? "");
  if (!SOURCES.has(source)) throw new ValidationError("submit requires source: user, llm or assisted");
  const skill = args.skill === undefined ? undefined : String(args.skill).trim();
  if (skill === "") throw new ValidationError("submit's skill, when given, must name a skill");
  const items = args.items === undefined ? undefined : checkItems(args.items);
  const previews = args.previews === undefined ? undefined : checkPreviews(args.previews);
  const hits = findSuggestionHits({ title, body, items, previews });
  if (hits.length > 0) {
    throw new ValidationError(`submit refused: ${hits.join(", ")}; rewrite the suggestion generically and resubmit`);
  }

  const post = {
    title, body, source, plugin_version: pluginVersion(),
    ...(skill ? { skill } : {}), ...(items ? { items } : {}), ...(previews ? { previews } : {}),
  };
  const saved = (await client.callFunction("suggestion-submit", post)) as {
    suggestion_id?: unknown; items_saved?: unknown; previews_saved?: unknown;
  };
  if (typeof saved?.suggestion_id !== "string") {
    throw new ValidationError("Probanda's Cloud did not confirm the suggestion, so it may not have been saved");
  }
  // A cloud that predates items and Previews saves the title and body and says
  // nothing of either, which reads here as not saved.
  return {
    suggestion_id: saved.suggestion_id,
    items_saved: saved.items_saved === true,
    previews_saved: saved.previews_saved === true,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(label: string, value: Record<string, unknown>, keys: string[]): void {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra) throw new ValidationError(`${label} has an unknown field "${extra}"`);
}

function nonEmpty(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${label} must be non-empty text`);
  return value.trim();
}

// items: one entry per pain, each with its done-test, its constraints and the
// changes that can each be decided on their own.
function checkItems(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS) {
    throw new ValidationError(`submit's items, when given, must be a list of 1 to ${MAX_ITEMS} items`);
  }
  return value.map((item, i) => {
    const label = `items[${i}]`;
    if (!isObject(item)) throw new ValidationError(`${label} must be an object`);
    onlyKeys(label, item, ["pain", "where", "done_test", "constraints", "changes"]);
    if (!Array.isArray(item.constraints)) throw new ValidationError(`${label}.constraints must be a list`);
    if (!Array.isArray(item.changes)) throw new ValidationError(`${label}.changes must be a list`);
    return {
      pain: nonEmpty(`${label}.pain`, item.pain),
      where: nonEmpty(`${label}.where`, item.where),
      done_test: nonEmpty(`${label}.done_test`, item.done_test),
      constraints: item.constraints.map((c, j) => nonEmpty(`${label}.constraints[${j}]`, c)),
      changes: item.changes.map((change, j) => {
        const at = `${label}.changes[${j}]`;
        if (!isObject(change)) throw new ValidationError(`${at} must be an object`);
        onlyKeys(at, change, ["change", "origin"]);
        if (typeof change.origin !== "string" || !ORIGINS.has(change.origin)) {
          throw new ValidationError(`${at}.origin must be probanda or lawyer`);
        }
        return { change: nonEmpty(`${at}.change`, change.change), origin: change.origin };
      }),
    };
  });
}

// previews: UI Previews only, built from placeholder data: the chosen one and
// the rejected ones.
function checkPreviews(value: unknown): Array<{ label: string; chosen: boolean; reason?: string; html: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PREVIEWS) {
    throw new ValidationError(`submit's previews, when given, must be a list of 1 to ${MAX_PREVIEWS} Previews`);
  }
  return value.map((preview, i) => {
    const label = `previews[${i}]`;
    if (!isObject(preview)) throw new ValidationError(`${label} must be an object`);
    onlyKeys(label, preview, ["label", "chosen", "reason", "html"]);
    if (typeof preview.chosen !== "boolean") throw new ValidationError(`${label}.chosen must be true or false`);
    if (typeof preview.html !== "string" || !preview.html.trim()) throw new ValidationError(`${label}.html must be non-empty HTML`);
    return {
      label: nonEmpty(`${label}.label`, preview.label),
      chosen: preview.chosen,
      ...(preview.reason === undefined ? {} : { reason: nonEmpty(`${label}.reason`, preview.reason) }),
      html: preview.html,
    };
  });
}

// status — the status and triage time of suggestions whose IDs this device
// holds. Nothing else of a suggestion comes back, and an unknown ID is omitted.
async function status(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  if (!client.hasStaticKey()) throw new ValidationError(NOT_CONFIGURED_HINT);
  const ids = args.suggestion_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_STATUS_IDS) {
    throw new ValidationError(`status requires suggestion_ids: a list of 1 to ${MAX_STATUS_IDS} IDs`);
  }
  if (!ids.every((id) => typeof id === "string" && UUID.test(id))) {
    throw new ValidationError("status's suggestion_ids must each be a suggestion_id that submit returned");
  }
  const asked = new Set(ids.map((id: string) => id.toLowerCase()));
  const found = (await client.callFunction("suggestion-status", { suggestion_ids: [...asked] })) as { statuses?: unknown };
  if (!Array.isArray(found?.statuses)) {
    throw new ValidationError("Probanda's Cloud did not return the statuses");
  }
  // Only the three allowed fields of rows that were asked for pass, whatever the cloud sends.
  const statuses = found.statuses
    .filter((row): row is Record<string, unknown> =>
      isObject(row) && typeof row.suggestion_id === "string" && asked.has(row.suggestion_id.toLowerCase()))
    .map((row) => ({
      suggestion_id: row.suggestion_id,
      status: typeof row.status === "string" ? row.status : null,
      triaged_at: typeof row.triaged_at === "string" ? row.triaged_at : null,
    }));
  return { statuses };
}
