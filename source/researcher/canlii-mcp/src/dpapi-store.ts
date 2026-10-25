import { join } from "node:path";

import { defaultStateDir, readProtectedJson, writeProtectedJson } from "../../../mcp-shared/dpapi-store.js";

// Host-backed local persistence for the CanLII API key.
//
// Cowork spawns this plugin's MCP server inside a LocalSystem VM service
// (CoworkVMService), which cannot read the practitioner's User-scope
// CANLII_API_KEY environment variable at all — and the ${user_config.*}
// injection path is broken upstream (anthropics/claude-code #39125, duplicate
// #45613). So in Cowork the key can only arrive as a tool-call argument.
// configure_credential accepts it once and persists it here, DPAPI-encrypted,
// read on every later server start. env still wins outright, so Claude Code CLI
// — which does inherit the user env — is unaffected.
//
// The DPAPI store itself is shared: source/mcp-shared/dpapi-store.js.

export interface ResolvedKey {
  key: string;
  source: "env" | "stored" | "none";
  error?: string;
}

interface PersistedCredential {
  apiKey: string;
}

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultStateDir(env, "canlii"), "credential.json.dpapi");
}

// env wins outright; only when env is blank do we pay for a DPAPI unprotect (a
// spawned powershell.exe round trip) to check the persisted credential file.
//
// Never throws on an unreadable credential file: a DPAPI key is tied to the
// Windows profile, so a password reset, profile rebuild, or machine migration
// invalidates one, and letting that propagate would crash start() before it can
// register the very tool that lets the practitioner re-supply the key. It
// degrades to unconfigured instead, but loudly — the reason rides back on the
// result and is written to stderr by the caller. The unreadable file is left in
// place, never deleted or overwritten.
export async function loadApiKey(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedKey> {
  const fromEnv = (env.CANLII_API_KEY ?? "").trim();
  if (fromEnv) return { key: fromEnv, source: "env" };

  try {
    const persisted = await readProtectedJson<PersistedCredential>(credentialPath(env), null);
    if (persisted?.apiKey) return { key: persisted.apiKey, source: "stored" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { key: "", source: "none", error: detail.split("\n")[0].trim() };
  }
  return { key: "", source: "none" };
}

// Called by configure_credential. Persists the key to the host-backed DPAPI file
// so the next process launch (next Cowork session) picks it up via loadApiKey
// without the caller re-entering it. `protect` is forced true rather than left to
// default off-platform: this is a real secret, and the default would silently
// write it as PLAINTEXT into a file still named `.dpapi` on any non-Windows host.
export async function persistApiKey(apiKey: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await writeProtectedJson(credentialPath(env), { apiKey }, true);
}

// A key is a secret, so no tool ever returns it. Show only enough to recognize
// which key is stored: first 4 / last 4, the middle masked.
export function redactedKeyHint(key: string): string | null {
  if (!key) return null;
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
