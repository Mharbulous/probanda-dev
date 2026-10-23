import { runPowerShell } from "./dpapi-store.js";

// Windows Credential Manager, reached through the same powershell.exe spawn the
// DPAPI store uses (dpapi-store.js), with CredReadW, CredWriteW and CredDeleteW
// bound by Add-Type. A generic credential is per Windows user, not per file, so a
// packaged Claude app and a plain process see the same one, and it survives the
// app's reinstall; a file under %LOCALAPPDATA% does neither, because an MSIX
// package redirects that folder into its own LocalCache and deletes it with the
// package. One Add-Type compile per spawn costs about 0.7 s, so callers cache
// what they read (commons-key.js). Windows only, like the DPAPI store: a native
// binding was rejected for the native dependency it would add to two bundles
// (Brahm, 2026-10-22).
//
// The secret travels to and from PowerShell as base64 on stdin and stdout, never
// on the command line, and is stored as the UTF-16LE blob Credential Manager
// shows in Control Panel. Errors are plain Error objects naming the Win32 code.

const TARGET = /^[A-Za-z0-9/_.-]{1,256}$/;
const ERROR_NOT_FOUND = 1168;

function checkTarget(target) {
  if (!TARGET.test(target)) throw new Error(`credential target "${target}" is not a plain name`);
  return target;
}

function requireWindows() {
  if (process.platform !== "win32") {
    throw new Error("Persistent local secret storage is supported only on Windows in v1");
  }
}

/** The stored secret, or null when no credential has that target. */
export async function readCredential(target) {
  requireWindows();
  const out = await runPowerShell("Credential Manager read", readScript(checkTarget(target)));
  if (out === "absent") return null;
  if (!out.startsWith("found:")) throw new Error(`Credential Manager read returned nothing usable`);
  return Buffer.from(out.slice("found:".length), "base64").toString("utf16le");
}

/** Saves the secret as a generic credential of the current user, replacing any under that target. */
export async function writeCredential(target, secret) {
  requireWindows();
  if (typeof secret !== "string" || !secret) throw new Error("a credential needs a secret");
  await runPowerShell("Credential Manager write", writeScript(checkTarget(target)), Buffer.from(secret, "utf16le").toString("base64"));
}

/** Removes the credential; a missing one counts as removed. */
export async function deleteCredential(target) {
  requireWindows();
  await runPowerShell("Credential Manager delete", deleteScript(checkTarget(target)));
}

// Windows PowerShell 5.1 compiles the C# once per process; $ErrorActionPreference
// makes every failure terminating, so a broken call exits non-zero with its
// message on stderr instead of printing an empty result.
const preamble = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ProbandaCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDeleteW(string target, uint type, uint flags);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr credential);
}
"@
$CRED_TYPE_GENERIC = 1
$CRED_PERSIST_LOCAL_MACHINE = 2
function Win32Error($what) {
  $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "$what failed with Win32 error $code"
}`;

const readScript = (target) => `${preamble}
$handle = [IntPtr]::Zero
if (-not [ProbandaCred]::CredReadW('${target}', $CRED_TYPE_GENERIC, 0, [ref]$handle)) {
  $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($code -eq ${ERROR_NOT_FOUND}) { [Console]::Out.Write('absent'); exit 0 }
  throw "CredReadW failed with Win32 error $code"
}
try {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($handle, [type][ProbandaCred+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  if ($cred.CredentialBlobSize -gt 0) { [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize) }
  [Console]::Out.Write('found:' + [Convert]::ToBase64String($bytes))
} finally {
  [ProbandaCred]::CredFree($handle)
}
`;

const writeScript = (target) => `${preamble}
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$blob = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
try {
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
  $cred = New-Object ProbandaCred+CREDENTIAL
  $cred.Type = $CRED_TYPE_GENERIC
  $cred.TargetName = '${target}'
  $cred.Comment = 'Saved by the Probanda plugins. Remove it here to forget the key on this computer.'
  $cred.CredentialBlobSize = $bytes.Length
  $cred.CredentialBlob = $blob
  $cred.Persist = $CRED_PERSIST_LOCAL_MACHINE
  $cred.UserName = 'Probanda'
  if (-not [ProbandaCred]::CredWriteW([ref]$cred, 0)) { Win32Error 'CredWriteW' }
} finally {
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
}
`;

const deleteScript = (target) => `${preamble}
if (-not [ProbandaCred]::CredDeleteW('${target}', $CRED_TYPE_GENERIC, 0)) {
  $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($code -ne ${ERROR_NOT_FOUND}) { throw "CredDeleteW failed with Win32 error $code" }
}
`;
