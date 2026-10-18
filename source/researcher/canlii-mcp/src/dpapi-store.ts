import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
// Ported from plugins/legal-commons/mcp/src/dpapi-store.ts + legal-commons/config.ts,
// which is the proven pattern for exactly this Cowork delivery gap.

export interface ResolvedKey {
  key: string;
  source: "env" | "stored" | "none";
  error?: string;
}

interface PersistedCredential {
  apiKey: string;
}

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.LOCALAPPDATA || env.APPDATA || homedir();
  return join(root, "Coclerk", "canlii");
}

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultStateDir(env), "credential.json.dpapi");
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

// ---------------------------------------------------------------------------
// DPAPI-backed JSON at rest (ported verbatim from legal-commons/dpapi-store.ts)
// ---------------------------------------------------------------------------

export async function readProtectedJson<T>(
  path: string,
  fallback: T | null,
  protect = process.platform === "win32"
): Promise<T | null> {
  try {
    const stored = await readFile(path);
    const data = protect ? await unprotectLocalSecret(stored) : stored;
    return JSON.parse(data.toString("utf8")) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeProtectedJson(
  path: string,
  value: unknown,
  protect = process.platform === "win32"
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const data = Buffer.from(JSON.stringify(value), "utf8");
  const stored = protect ? await protectLocalSecret(data) : data;
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, stored);
  await rename(tmp, path);
}

async function protectLocalSecret(data: Buffer): Promise<Buffer> {
  if (process.platform !== "win32") {
    throw new Error("Persistent local secret storage is supported only on Windows");
  }
  return runDpapi("Protect", data);
}

async function unprotectLocalSecret(data: Buffer): Promise<Buffer> {
  if (process.platform !== "win32") {
    throw new Error("Persistent local secret storage is supported only on Windows");
  }
  return runDpapi("Unprotect", data);
}

async function runDpapi(action: "Protect" | "Unprotect", data: Buffer): Promise<Buffer> {
  const script = action === "Protect" ? protectScript : unprotectScript;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Windows DPAPI ${action} failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });

  child.stdin.end(data.toString("base64"));
  await done;
  return Buffer.from(Buffer.concat(stdout).toString("utf8").trim(), "base64");
}

// Windows PowerShell 5.1 does not load System.Security by default, so
// [System.Security.Cryptography.ProtectedData] is an unresolvable type without
// the Add-Type line — omitting it fails every call with "Unable to find type".
// $ErrorActionPreference makes that class of failure terminating, so a broken
// call exits non-zero and surfaces below rather than returning empty stdout that
// would silently persist as an empty credential file.
const scriptPreamble = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($inputText)`;

const protectScript = `${scriptPreamble}
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const unprotectScript = `${scriptPreamble}
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($plain))
`;
