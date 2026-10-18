// Budgets for one host Python call. spawnSync blocks the event loop, so an unbounded call
// freezes every tool on this server, not just its own.

import { ValidationError } from "./errors.js";

/** Issue #517. Reads sit well inside the Cowork bridge's 60s limit, so a hung interpreter
 * surfaces as a named error rather than a bridge timeout. Migrates get longer: the bridge giving
 * up does not stop a slow but healthy migrate, whereas killing it can leave it between hops. */
export const READ_TIMEOUT_MS = 20_000;
export const WRITE_TIMEOUT_MS = 120_000;

/** Issue #612. A healthy case-data or timecamping-data execute is one sub-second transaction, so
 * its budget sits under the bridge's 60s: the named timeout then reaches a caller still waiting.
 * Practice-data writes and time-pipeline set/delete take it too (#693); time-pipeline bulk_apply
 * takes WRITE_TIMEOUT_MS. */
export const EXECUTE_TIMEOUT_MS = 45_000;

/** `variable` overrides every budget of one namespace (tests use it to force expiry). */
export function pythonTimeoutMs(env: NodeJS.ProcessEnv, defaultMs: number, variable: string): number {
  const override = env[variable];
  if (override === undefined) return defaultMs;
  const ms = Number(override);
  if (!(ms > 0)) throw new ValidationError(`${variable} must be a positive number of milliseconds: ${override}`);
  return ms;
}
