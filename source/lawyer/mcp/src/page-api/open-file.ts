// Opens one file in its default app, for the page API's file link (server.ts). No shell parses the path:
// a law folder's names hold commas, ampersands and spaces. On Windows the path reaches PowerShell through
// the environment, because explorer.exe splits an argument at a comma.

import { execFile } from "node:child_process";

const OPEN_TIMEOUT_MS = 15_000;

/** Resolves once the default app has been asked to open the file. Rejects when nothing could open it. */
export function openFile(path: string): Promise<void> {
  const [command, args, env]: [string, string[], NodeJS.ProcessEnv] =
    process.platform === "win32"
      ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Invoke-Item -LiteralPath $env:PROBANDA_OPEN_FILE -ErrorAction Stop"], { ...process.env, PROBANDA_OPEN_FILE: path }]
      : [process.platform === "darwin" ? "open" : "xdg-open", [path], process.env];
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, timeout: OPEN_TIMEOUT_MS, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}
