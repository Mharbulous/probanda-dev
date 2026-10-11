import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { ValidationError } from "./errors.js";

// Host-backed local secret persistence for the layer-3 static credential
// (Check-7 / handover 135). Cowork does not inject `${user_config.*}` values
// into a plugin's spawned MCP server process (confirmed platform gap,
// GitHub anthropics/claude-code #39125, duplicate #45613) — there is no
// Settings/Connectors surface that resolves it. The workaround ported here
// from the retired pre-B5 cloud runtime (git history) never
// depended on that injection path in the first place: the secret is accepted
// once through an ordinary tool-call argument (not subject to the env-var
// gap) and persisted to a host-backed path this same process reads directly
// on every later call, encrypted at rest via Windows DPAPI (this runtime's
// plugin MCP servers run as native Windows Node processes spawned by the
// desktop app — confirmed by the sibling litigation runtime's working,
// production use of `process.env.APPDATA` for its own local SQLite path).

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env, name = "legal-commons"): string {
  const root = env.LOCALAPPDATA || env.APPDATA || homedir();
  return join(root, "Coclerk", name);
}

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

export async function protectLocalSecret(data: Buffer): Promise<Buffer> {
  if (process.platform !== "win32") {
    throw new ValidationError("Persistent local secret storage is supported only on Windows in v1");
  }
  return runDpapi("Protect", data);
}

export async function unprotectLocalSecret(data: Buffer): Promise<Buffer> {
  if (process.platform !== "win32") {
    throw new ValidationError("Persistent local secret storage is supported only on Windows in v1");
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
      else reject(new ValidationError(`Windows DPAPI ${action} failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
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
// call exits non-zero and surfaces below rather than returning empty stdout
// that would silently persist as an empty credential file.
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
