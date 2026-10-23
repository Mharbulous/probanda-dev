import { type CloudKeyStore, loadCommonsKey } from "../../../mcp-shared/commons-key.js";

// Probanda's Cloud credential for the data server: the same Credential Manager
// entry, env override and baked URL as the commons server (source/mcp-shared/commons-key.js), so
// the practitioner configures one credential for both, through this server's
// cloud_key__configure_credential (src/key-request/save-key.ts)
// (docs/Plans/2026-10-14_practice-db-conversion.md, decision 3 and step 3).
// The practice writes use it (practice/cloud.ts), and config_status reports it.

export type CloudKey =
  | { configured: true; supabaseUrl: string; staticKey: string }
  | { configured: false; supabaseUrl: string; reason: string };

export async function loadCloudKey(env: NodeJS.ProcessEnv = process.env, store?: CloudKeyStore): Promise<CloudKey> {
  const { supabaseUrl, staticKey, credentialError } = await loadCommonsKey(env, store);
  if (staticKey) return { configured: true, supabaseUrl, staticKey };
  const reason = credentialError
    ? `the stored credential could not be read (${credentialError})`
    : "no credential is configured";
  return {
    configured: false,
    supabaseUrl,
    reason: `${reason}; set it with cloud_key__configure_credential, or ask Probanda for a key with key_request__submit`,
  };
}
