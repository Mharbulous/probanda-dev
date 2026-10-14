import { loadCommonsKey } from "../../../mcp-shared/commons-key.js";

// Probanda's Cloud credential for the data server: the same file, env override
// and baked URL as the commons server (source/mcp-shared/commons-key.js), so
// the practitioner configures one credential for both
// (docs/Plans/2026-10-14_practice-db-conversion.md, decision 3 and step 3).
// Nothing calls this yet: the practice writes use it from step 5.

export type CloudKey =
  | { configured: true; supabaseUrl: string; staticKey: string }
  | { configured: false; supabaseUrl: string; reason: string };

export async function loadCloudKey(env: NodeJS.ProcessEnv = process.env): Promise<CloudKey> {
  const { supabaseUrl, staticKey, credentialError } = await loadCommonsKey(env);
  if (staticKey) return { configured: true, supabaseUrl, staticKey };
  const reason = credentialError
    ? `the stored credential could not be read (${credentialError})`
    : "no credential is configured";
  return {
    configured: false,
    supabaseUrl,
    reason: `${reason}; set it with the commons server's legal_commons__configure_credential tool`,
  };
}
