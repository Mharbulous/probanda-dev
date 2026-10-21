import type { DispatchContext } from "../dispatch.js";
import { ValidationError } from "../errors.js";
import type { LegalCommonsClient } from "../legal-commons/client.js";
import { isPoolHost, persistTroubleshootCredential } from "./config.js";
import { findRedactionHits } from "./redact.js";

// Runtime logic for the troubleshooting store namespace: known fixes for tool,
// connector, plugin and MCP failures, held in a SEPARATE Supabase project from
// the legal-commons pool and reached through its own client instance. The
// store holds generic tooling knowledge only — never client or matter content.
// Tool definitions live in schema-gen.ts.
//
// Routing takes the whole dispatch context, not just the store client, because
// configure_credential must compare the supplied key against the pool's.

export function isTroubleshootToolName(name: string): boolean {
  return name.startsWith("troubleshoot__");
}

export function callTroubleshootTool(
  context: DispatchContext,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "troubleshoot__search":
      return search(context.troubleshoot, args);
    case "troubleshoot__record":
      return record(context.troubleshoot, args);
    case "troubleshoot__confirm_fix":
      return confirmFix(context.troubleshoot, args);
    case "troubleshoot__configure_credential":
      return configureCredential(context, args);
    case "troubleshoot__configure_status":
      return configureStatus(context.troubleshoot);
    default:
      throw new ValidationError(`Unknown troubleshoot tool "${name}"`);
  }
}

// search — an empty list means the store answered and had nothing. A store that
// did not answer throws, so the caller can never mistake one for the other.
async function search(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const entries = await client.rpc("search_entries", {
    p_query: String(args.query),
    p_tools: Array.isArray(args.tools) ? args.tools : [],
    p_k: clampK(args.k),
  });
  return { entries };
}

// k is a row count: whole, 1 to 50, default 10. search_entries clamps the same
// way, so a direct RPC call gets the same bounds.
function clampK(k: unknown): number {
  return typeof k === "number" ? Math.min(50, Math.max(1, Math.trunc(k))) : 10;
}

// The input validator does not check array items, and the redaction screen
// reads only strings, so a non-string item would reach the store unscreened.
function stringArray(label: string, value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`troubleshoot__record.${label} must be an array of strings`);
  }
  return value as string[];
}

// record — the one insert. The redaction screen runs first and refuses before
// any network call; its message names the kinds hit, never the text.
async function record(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const tools = stringArray("tools", args.tools);
  const errorStrings = stringArray("error_strings", args.error_strings);
  const hits = findRedactionHits(args);
  if (hits.length > 0) {
    throw new ValidationError(`record refused: ${hits.join(", ")}; rewrite the entry generically and resubmit`);
  }

  const [row] = await client.insert("entry", {
    symptom: String(args.symptom),
    tools,
    error_strings: errorStrings,
    cause: String(args.cause),
    fix: String(args.fix),
    source_url: args.source_url ?? null,
  });
  return { entry_id: row.entry_id, confirmed_count: row.confirmed_count };
}

// confirm_fix — bumps the counter atomically in the confirm_entry RPC, which
// raises when the id is unknown.
async function confirmFix(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  return client.rpc("confirm_entry", { p_entry_id: String(args.entry_id) });
}

// configure_credential — set live, probe, restore on failure, persist, report a
// failed persist, plus
// a URL, because the store has no baked one, and two separation guards: the
// store must never be pointed at the pool's project or handed the pool's key.
async function configureCredential(context: DispatchContext, args: Record<string, unknown>): Promise<unknown> {
  const client = context.troubleshoot;
  const projectUrl = String(args.project_url || "").trim();
  const staticKey = String(args.static_key || "").trim();
  if (!projectUrl) throw new ValidationError("configure_credential requires project_url");
  if (!staticKey) throw new ValidationError("configure_credential requires static_key");
  if (staticKey.startsWith("sb_publishable_")) {
    throw new ValidationError(
      "that is the publishable (anon) key, which has no grants on the troubleshoot schema — " +
      "supply the store project's sb_secret_ key instead"
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(projectUrl);
  } catch {
    throw new ValidationError("project_url is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new ValidationError("project_url must be an https:// URL");
  }
  // By host, against every URL the pool is known by: baked, env, and live.
  if (isPoolHost(parsed.host, [process.env.SUPABASE_URL, context.legalCommons.projectUrl()])) {
    throw new ValidationError(
      "that is the legal-commons pool's project URL — the troubleshooting store must be a separate Supabase project"
    );
  }
  if (staticKey === context.legalCommons.staticKey()) {
    throw new ValidationError(
      "that is the legal-commons pool's key — the troubleshooting store must use its own project's sb_secret_ key"
    );
  }

  const previousUrl = client.projectUrl();
  const previousKey = client.staticKey();
  client.setProjectUrl(projectUrl);
  client.setStaticKey(staticKey);

  try {
    await client.get("entry", { select: "entry_id" }, { limit: 1 });
  } catch (error) {
    client.setProjectUrl(previousUrl);
    client.setStaticKey(previousKey);
    throw new ValidationError(
      `those credentials did not work against the troubleshooting store, so they were not saved: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    await persistTroubleshootCredential(projectUrl, staticKey);
  } catch (error) {
    return {
      configured: true,
      persisted: false,
      warning:
        "the credentials work and are active for this session, but could not be saved to disk, so they " +
        `must be supplied again after a restart: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { configured: true, persisted: true };
}

// configure_status — answers rather than throwing when nothing is configured,
// and never returns the key itself.
async function configureStatus(client: LegalCommonsClient): Promise<unknown> {
  return {
    configured: client.hasStaticKey(),
    project_url: client.projectUrl() || null,
    key_hint: client.redactedKeyHint(),
  };
}
