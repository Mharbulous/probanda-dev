import { join } from "node:path";

import { defaultStateDir, readProtectedJson } from "./dpapi-store.js";

// The one Probanda's Cloud credential: the static Supabase key that the commons
// server's legal_commons__configure_credential tool saves. Shared by the commons
// server and the lawyer plugin's data server, so both read the same file with the same
// overrides (docs/Plans/2026-10-14_practice-db-conversion.md, step 3). Plain
// JavaScript for the reason given in dpapi-store.js.

// Public, non-secret Supabase project URL. After the three-layer teardown (B5,
// 2026-07-14) the only remaining Supabase consumer is the layer-3 legal-commons
// client (legal-commons/config.ts), which reads this as the default host for its
// static-credential PostgREST calls. The cloud anon key, per-session auth config,
// and matter_id UUID validation were removed with the retired case-data surface.
export const BAKED_SUPABASE_URL = "https://nbzkuhgiqscjkypedqff.supabase.co";

export function credentialPath(env = process.env) {
  return join(defaultStateDir(env), "credential.json.dpapi");
}

// Env wins outright; only when env is blank do we pay the cost of a DPAPI
// unprotect (a spawned powershell.exe round trip) to check the persisted
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
export async function loadCommonsKey(env = process.env) {
  const key = {
    supabaseUrl: env.SUPABASE_URL || BAKED_SUPABASE_URL,
    // Deliberately NOT falling back to the public anon key: it has no grants on
    // legal_commons, so a fallback would only turn "not configured" into a
    // confusing "permission denied". Fail with a clear message instead.
    staticKey: env.LEGAL_COMMONS_SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
  if (key.staticKey) return key;

  try {
    const persisted = await readProtectedJson(credentialPath(env), null);
    if (persisted?.staticKey) key.staticKey = persisted.staticKey;
  } catch (error) {
    // stderr carries the whole thing (a DPAPI failure drags a PowerShell stack
    // trace with it, which is what you want when debugging); the tool-facing
    // error carries only the first line, which is the actionable part.
    const detail = error instanceof Error ? error.message : String(error);
    key.credentialError = detail.split("\n")[0].trim();
    process.stderr.write(
      `legal-commons: stored credential at ${credentialPath(env)} could not be read — ` +
      `${detail}\nStarting unconfigured; call the commons server's configure_credential tool to replace it.\n`
    );
  }
  return key;
}
