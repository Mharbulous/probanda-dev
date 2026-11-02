// The host Python driver every SQLite store's migrate tool spawns (case, timecamping and
// submission migrate.ts), and the two steps each wraps around it: turning a refusal into a
// DataServerError and warning when a stale write lock was broken. Three copies of each used to sit
// in those files.

import { DataServerError } from "./errors.js";

// Pure plumbing: one JSON request in on stdin, one JSON response out on stdout.
// Contains no SQL, no schema, no migration knowledge.
export const MIGRATE_DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    from migrate_engine import MigrateError, run
    try:
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except MigrateError as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": exc.as_dict()}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": {
                "code": "internal_error",
                "message": "Unexpected migrate driver failure",
                "details": {"exception": type(exc).__name__, "reason": str(exc)},
            },
        }))


main()
`.trim();

export interface DriverResponse {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

/** Throws the refusal in a response whose ok is false, using fallbackMessage when it carries none. */
export function throwDriverRefusal(parsed: DriverResponse, fallbackMessage: string): never {
  const error = parsed.error ?? {};
  // DataServerError carries no details field, and these details are the
  // difference between a usable refusal ("backup 2026...-9f2c1a is
  // available") and a mystery -- so fold them into the message.
  const details = error.details && Object.keys(error.details).length
    ? ` [${JSON.stringify(error.details)}]`
    : "";
  throw new DataServerError(
    `${error.message ?? fallbackMessage}${details}`,
    error.code ?? "migrate_error"
  );
}

/** Appends the warning that a stale write lock on store (e.g. "matter-data") was broken; subject
 * names what was locked ("matter" or "database"). */
export function pushStaleLockWarning(result: Record<string, unknown>, store: string, subject: string, why = ">15 min old"): void {
  const warnings = Array.isArray(result.warnings) ? (result.warnings as string[]) : [];
  warnings.push(
    `broke a stale ${store} write lock (${why}) before running; if another session ` +
      `is still writing to or migrating this ${subject}, stop and reconcile before continuing`
  );
  result.warnings = warnings;
}
