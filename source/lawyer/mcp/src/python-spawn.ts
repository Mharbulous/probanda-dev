// Every host Python helper call goes through runPythonDriver: one interpreter search, one budget,
// one set of failure messages. Eight copies of this loop used to drift apart.
//
// A host Python helper killed on timeout never runs its `finally`, so the staging folder it made in
// the OS temp dir -- a copy of the databases, privileged tables included -- would stay there
// (issue #703). Each call gets a random tag in COCLERK_STAGING_TAG, and helpers name those folders
// `coclerk_<kind>_<tag>_*`; once the server has killed a helper, it removes that tag's folders. The
// tag is not the pid because `python` can be a launcher whose pid is not the interpreter's (#1043).

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DataServerError, PythonTimeoutError } from "./errors.js";

/** Host Python processes started by runPythonDriver and the drafting-data query sidecar, read by
 * the bootstrap process-count test (issue #517). */
export const pythonStarts = { count: 0 };

export interface PythonDriverOptions {
  /** Names the helper in every error, e.g. "matter-data sqlite helper". */
  label: string;
  driver: string;
  payload: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  extraEnv?: NodeJS.ProcessEnv;
  /** Appended to the timeout error: what the kill may have left behind. */
  timeoutAdvice?: string;
  /** What the helper's tagged temp folders hold, named if one survives a kill (#1348). */
  stagingDescription?: string;
}

/** Runs `driver` on the first Python found, feeding `payload` on stdin; returns its parsed stdout. */
export function runPythonDriver(opts: PythonDriverOptions): unknown {
  const { label, driver, payload, env, timeoutMs, extraEnv, timeoutAdvice, stagingDescription } = opts;
  const candidates = [env.COCLERK_PYTHON, "python", "python3"].filter(Boolean) as string[];
  let lastErr = "";
  const tag = randomBytes(8).toString("hex");
  for (const py of candidates) {
    pythonStarts.count++;
    const res = spawnSync(py, [driver], {
      input: payload,
      encoding: "utf-8",
      // spawnSync's 1 MB default is too small: one time-pipeline value is ~1.6 MB after the
      // Chrometa import. Overflow still fails loudly, just at a realistic threshold.
      maxBuffer: 64 * 1024 * 1024,
      // PYTHONIOENCODING: host Python's stdout otherwise defaults to the Windows locale encoding,
      // which mangles a non-ASCII exception message on the error path. TMPDIR pins Python's temp
      // dir (it reads TMPDIR first) to Node's, so removeKilledStaging looks where the helper staged.
      env: { ...env, PYTHONIOENCODING: "utf-8", TMPDIR: tmpdir(), ...extraEnv, COCLERK_STAGING_TAG: tag },
      timeout: timeoutMs,
    });
    if (res.error) {
      lastErr = res.error.message;
      const code = (res.error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      if (code === "ETIMEDOUT") {
        throw new PythonTimeoutError(
          `${label} (${py}) did not finish within ${timeoutMs}ms and was killed.` +
            (timeoutAdvice ? ` ${timeoutAdvice}` : "") +
            removeKilledStaging(tag, stagingDescription)
        );
      }
      throw new DataServerError(`${label} failed (${py}): ${res.error.message}`);
    }
    if (res.status !== 0) {
      throw new DataServerError(`${label} (${py}) exited ${res.status}: ${(res.stderr || "").trim()}`);
    }
    try {
      return JSON.parse(res.stdout);
    } catch (err) {
      throw new DataServerError(
        `${label} (${py}) produced unparseable output: ${(err as Error).message}. ` +
          `Output began: ${JSON.stringify(res.stdout.slice(0, 200))}`
      );
    }
  }
  throw new DataServerError(
    `No Python interpreter found for the ${label} (tried ${candidates.join(", ")}). ` +
      `Install Python 3 or set COCLERK_PYTHON. Last error: ${lastErr}`
  );
}

/** Removes the staging folders of the killed helper call `tag`. Returns "" or a sentence naming what
 * could not be removed, for the caller to append to its timeout error. */
export function removeKilledStaging(tag: string, description = "staging copy of the database"): string {
  const pattern = new RegExp(`^coclerk_[a-z_]+_${tag}_`);
  const failed: string[] = [];
  for (const name of readdirSync(tmpdir())) {
    if (!pattern.test(name)) continue;
    const p = join(tmpdir(), name);
    try {
      rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (err) {
      failed.push(`${p} (${(err as Error).message})`);
    }
  }
  return failed.length ? ` Its ${description} could not be removed; delete it by hand: ${failed.join("; ")}.` : "";
}
