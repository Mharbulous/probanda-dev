import { join } from "node:path";

import { BAKED_SUPABASE_URL } from "../config.js";
import { defaultStateDir, readProtectedJson, writeProtectedJson } from "../dpapi-store.js";
import type { LegalCommonsConfig } from "../legal-commons/config.js";

// Troubleshooting store config. The store is a SECOND, separate Supabase
// project holding generic tooling fixes (no client or matter content), served
// by a second LegalCommonsClient instance. Delivery mirrors the pool (env
// first, then a DPAPI file written by troubleshoot__configure_credential) with
// two differences: its own state folder, and no baked URL. The store must never
// be the pool's project, so an unconfigured store has no URL at all.

interface PersistedCredential {
  projectUrl: string;
  staticKey: string;
}

const NOT_CONFIGURED_HINT =
  "the troubleshooting store is not configured: call troubleshoot__configure_credential once with " +
  "the store project's URL and its sb_secret_ key, or set TROUBLESHOOT_SUPABASE_URL and " +
  "TROUBLESHOOT_SUPABASE_KEY in the runtime environment (Claude Code CLI / dev).";

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultStateDir(env, "troubleshoot"), "credential.json.dpapi");
}

// Separation is checked by host, so a trailing slash, a path such as /rest/v1,
// or letter case cannot carry the pool's project past the guard.
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// True when `host` is the pool's: the baked URL, or any other URL the caller
// knows the pool by (its env override, its live client URL).
export function isPoolHost(host: string, poolUrls: ReadonlyArray<string | undefined>): boolean {
  return [BAKED_SUPABASE_URL, ...poolUrls].some((url) => hostOf(url) === host);
}

function envRefusal(url: string, key: string, pool: Pick<LegalCommonsConfig, "supabaseUrl" | "staticKey">): string | null {
  const host = hostOf(url);
  if (host !== null && isPoolHost(host, [pool.supabaseUrl])) {
    return "TROUBLESHOOT_SUPABASE_URL is the legal-commons pool's project";
  }
  if (pool.staticKey && key === pool.staticKey) return "TROUBLESHOOT_SUPABASE_KEY is the legal-commons pool's key";
  return null;
}

// `pool` is the pool's already-loaded config, passed in by the caller so the
// env guard can compare against it without loading the pool's credential twice.
//
// Same startup discipline as loadLegalCommonsConfig: nothing here throws, so
// start() always reaches the tool that fixes the credential. A refused or
// unreadable credential degrades to unconfigured, says why on stderr, and
// carries the reason on every later "not configured" error.
export async function loadTroubleshootConfig(
  env: NodeJS.ProcessEnv,
  pool: Pick<LegalCommonsConfig, "supabaseUrl" | "staticKey">
): Promise<LegalCommonsConfig> {
  const config: LegalCommonsConfig = {
    supabaseUrl: "",
    staticKey: "",
    schema: "troubleshoot",
    label: "troubleshoot",
    notConfiguredHint: NOT_CONFIGURED_HINT,
  };
  const envUrl = env.TROUBLESHOOT_SUPABASE_URL;
  const envKey = env.TROUBLESHOOT_SUPABASE_KEY;
  if (envUrl && envKey) {
    const refusal = envRefusal(envUrl, envKey, pool);
    if (refusal) {
      // Not credentialError: the client words that as a stored file it could
      // not read, which this is not.
      config.notConfiguredHint = `${NOT_CONFIGURED_HINT} The environment credential was refused: ${refusal}.`;
      process.stderr.write(`troubleshoot: ${refusal}, so it was refused. Starting unconfigured.\n`);
      return config;
    }
    config.supabaseUrl = envUrl;
    config.staticKey = envKey;
    return config;
  }
  if (envUrl || envKey) {
    process.stderr.write(
      `troubleshoot: only ${envUrl ? "TROUBLESHOOT_SUPABASE_URL" : "TROUBLESHOOT_SUPABASE_KEY"} is set; both are ` +
      "needed, so the environment is ignored and the stored credential, if any, is used.\n"
    );
  }

  try {
    const persisted = await readProtectedJson<PersistedCredential>(credentialPath(env), null);
    if (persisted?.projectUrl && persisted.staticKey) {
      config.supabaseUrl = persisted.projectUrl;
      config.staticKey = persisted.staticKey;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    config.credentialError = detail.split("\n")[0].trim();
    process.stderr.write(
      `troubleshoot: stored credential at ${credentialPath(env)} could not be read — ` +
      `${detail}\nStarting unconfigured; call troubleshoot__configure_credential to replace it.\n`
    );
  }
  return config;
}

// Called by troubleshoot__configure_credential. `protect` is forced true for the
// same reason as the pool's: never write a real secret as plaintext.
export async function persistTroubleshootCredential(
  projectUrl: string,
  staticKey: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const value: PersistedCredential = { projectUrl, staticKey };
  await writeProtectedJson(credentialPath(env), value, true);
}
