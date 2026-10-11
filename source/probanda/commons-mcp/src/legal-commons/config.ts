import { join } from "node:path";

import { BAKED_SUPABASE_URL } from "../config.js";
import { defaultStateDir, readProtectedJson, writeProtectedJson } from "../dpapi-store.js";

// Layer-3 legal-commons runtime config (spec §7 1a / §9). The pool is served by
// a SINGLE STATIC Supabase credential — no per-session login, no key unlock.
// Possession of that credential IS the write protection (spec §9: "write
// protection is key custody"), so it must be a non-public key (service_role /
// sb_secret_…), never the baked public anon key: the public key deliberately
// has no grants on the legal_commons schema.
//
// Delivery (handover 135 / Check 7): Cowork does not inject `${user_config.*}`
// values into a plugin's spawned MCP server process (confirmed platform gap,
// anthropics/claude-code #39125, duplicate #45613) — an env-only credential is
// therefore unreachable from Cowork's GUI. The static key is instead accepted
// once via the legal_commons__configure_credential tool call (tool args are not
// subject to the injection gap) and persisted to a host-backed, DPAPI-encrypted
// file this process reads on every call — see dpapi-store.ts. `env` remains
// the first-checked source so an explicit env var (Claude Code CLI, developer
// testing) still overrides the persisted file.
//
// Retrieval is zero-vendor (lexical + Claude-generated query expansion, in
// Postgres) — there is NO embedding provider and NO embedding key. See the spec
// §9 amendment (2026-07-13): candidate retrieval moved off external embeddings.

export interface LegalCommonsConfig {
  supabaseUrl: string;
  staticKey: string; // service_role / sb_secret_ key; empty until configured
  schema: string; // PostgREST profile / Postgres schema name
  // Set when a credential file exists but could not be read. Rides on every
  // "not configured" error so the cause is named rather than guessed at.
  credentialError?: string;
  // A second client instance (the troubleshooting store) names itself in its
  // errors with these. Both unset for the pool, which keeps its own wording.
  label?: string;
  notConfiguredHint?: string;
}

interface PersistedCredential {
  staticKey: string;
}

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultStateDir(env), "credential.json.dpapi");
}

function loadFromEnv(env: NodeJS.ProcessEnv): LegalCommonsConfig {
  return {
    supabaseUrl: env.SUPABASE_URL || BAKED_SUPABASE_URL,
    // Deliberately NOT falling back to the public anon key: it has no grants on
    // legal_commons, so a fallback would only turn "not configured" into a
    // confusing "permission denied". Fail with a clear message instead.
    staticKey: env.LEGAL_COMMONS_SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
    schema: env.LEGAL_COMMONS_SCHEMA || "legal_commons",
  };
}

// Async: env wins outright; only when env is blank do we pay the cost of a
// DPAPI unprotect (a spawned powershell.exe round trip) to check the persisted
// credential file.
//
// This runs during server startup, so it must not throw on a credential file
// that exists but cannot be decrypted or parsed — DPAPI keys are tied to the
// Windows profile, so a password reset, profile rebuild, or machine migration
// invalidates one, and letting that propagate would crash start() before it
// registers the very tool that lets the practitioner re-supply the key. It
// degrades to unconfigured instead, but loudly: the reason is written to
// stderr here and carried on every later "not configured" error. The unreadable
// file is deliberately left in place, never deleted or overwritten.
export async function loadLegalCommonsConfig(env: NodeJS.ProcessEnv = process.env): Promise<LegalCommonsConfig> {
  const config = loadFromEnv(env);
  if (config.staticKey) return config;

  try {
    const persisted = await readProtectedJson<PersistedCredential>(credentialPath(env), null);
    if (persisted?.staticKey) config.staticKey = persisted.staticKey;
  } catch (error) {
    // stderr carries the whole thing (a DPAPI failure drags a PowerShell stack
    // trace with it, which is what you want when debugging); the tool-facing
    // error carries only the first line, which is the actionable part.
    const detail = error instanceof Error ? error.message : String(error);
    config.credentialError = detail.split("\n")[0].trim();
    process.stderr.write(
      `legal-commons: stored credential at ${credentialPath(env)} could not be read — ` +
      `${detail}\nStarting unconfigured; call legal_commons__configure_credential to replace it.\n`
    );
  }
  return config;
}

// Called by legal_commons__configure_credential. Persists the static key to the
// host-backed DPAPI file so the next process launch (next Cowork session) picks
// it up via loadLegalCommonsConfig without the caller re-entering it.
//
// `protect` is forced true rather than left to default off-platform: this is a
// real secret, and the default would silently write it as PLAINTEXT into a file
// still named `.dpapi` on any non-Windows host. Failing loudly there is correct.
export async function persistLegalCommonsCredential(
  staticKey: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const value: PersistedCredential = { staticKey };
  await writeProtectedJson(credentialPath(env), value, true);
}
