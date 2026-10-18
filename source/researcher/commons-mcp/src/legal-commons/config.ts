import { writeProtectedJson } from "../dpapi-store.js";
import { credentialPath, loadCommonsKey } from "../../../../mcp-shared/commons-key.js";

// The credential's path, env override and loading live in
// source/mcp-shared/commons-key.js, so the lawyer plugin's data server reads the same
// credential. This module adds the pool's schema and keeps the commons names.
export { credentialPath };

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

// Env wins outright over the persisted file; the reasoning is on
// loadCommonsKey. Never throws on an unreadable credential file.
export async function loadLegalCommonsConfig(env: NodeJS.ProcessEnv = process.env): Promise<LegalCommonsConfig> {
  return { ...(await loadCommonsKey(env)), schema: env.LEGAL_COMMONS_SCHEMA || "legal_commons" };
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
