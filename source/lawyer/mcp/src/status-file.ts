// A rename-replace write that retries while another process holds the target. It lives apart from
// submission/render-job.ts so the files server can use it without carrying the render job (#186).

import { renameSync, unlinkSync, writeFileSync } from "node:fs";

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Writes `text` to `target` through a sibling temp file and a rename, so a reader never sees half a
 * file. A rename refused because another process holds the target (the OneDrive client, typically)
 * is retried; past the budget the temp file is removed and the error code returned. Never throws.
 */
export function writeStatusFile(
  target: string,
  text: string,
  { attempts = 10, delayMs = 50 }: { attempts?: number; delayMs?: number } = {}
): string | null {
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text, "utf-8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
  }
  let code = "UNKNOWN";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      renameSync(temp, target);
      return null;
    } catch (err) {
      code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
      if (!["EPERM", "EBUSY", "EACCES"].includes(code)) break;
      if (attempt < attempts - 1) sleepSync(delayMs);
    }
  }
  try {
    unlinkSync(temp);
  } catch {
    // Already gone.
  }
  return code;
}
