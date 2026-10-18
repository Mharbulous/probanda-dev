import { readFileSync } from "node:fs";
import { ValidationError } from "../errors.js";
import type { LegalCommonsClient } from "../legal-commons/client.js";
import { findRedactionHits } from "../troubleshoot/redact.js";

// Runtime logic for the Suggestion Box namespace: a suggestion about the plugin
// that the practitioner expressly submits is saved in Probanda's Cloud through
// the suggestion-submit Edge Function, with the same key the legal-commons
// tools use. A post carries a title, a body, its source (user or llm), the
// researcher plugin's version and, when the model names one, the skill it is
// about, and nothing else. The function can only insert a suggestion: it never reads one
// back. Tool definitions live in schema-gen.ts.

const NOT_CONFIGURED_HINT =
  "the Suggestion Box has no key on this computer: call legal_commons__configure_credential once " +
  "and have the practitioner paste the key Probanda gave them on the page it serves";

const SOURCES = new Set(["user", "llm"]);

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
  if (!SOURCES.has(source)) throw new ValidationError("submit requires source: user or llm");
  const skill = args.skill === undefined ? undefined : String(args.skill).trim();
  if (skill === "") throw new ValidationError("submit's skill, when given, must name a skill");
  const hits = findRedactionHits({ title, body });
  if (hits.length > 0) {
    throw new ValidationError(`submit refused: ${hits.join(", ")}; rewrite the suggestion generically and resubmit`);
  }

  const post = { title, body, source, plugin_version: pluginVersion(), ...(skill ? { skill } : {}) };
  const saved = (await client.callFunction("suggestion-submit", post)) as { suggestion_id?: unknown };
  if (typeof saved?.suggestion_id !== "string") {
    throw new ValidationError("Probanda's Cloud did not confirm the suggestion, so it may not have been saved");
  }
  return { suggestion_id: saved.suggestion_id };
}
