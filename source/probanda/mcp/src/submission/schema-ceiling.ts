// What schema version THIS bundle can actually read (#812).
//
// Before this module, every "ahead of the installed bundle" guard compared the database
// against currentSchemaVersion() -- TARGET_SCHEMA_VERSION read live out of the working
// tree's migrate_engine.py. That is the number a migration would apply, not the number
// this bundle's renderers understand, so the guard could never fire for the failure it was
// written for (#352): the moment migrations.sql gained a hop the ceiling rose with it, a
// database pushed to that hop read as healthy, and the bundle's own baked SQL still named
// the old columns. That is how matter L8145 was migrated to v26 by a read-only baseline call
// and then rendered `no such column: s.dropped_on` (#804, #812).
//
// scripts/bundle.mjs now reads TARGET_SCHEMA_VERSION at build time and injects it through
// esbuild `define`, exactly as it injects the build stamp. A bundle therefore STATES what it
// understands, and that statement cannot drift with the working tree.
//
// The guard keys on this number rather than on whether migrations.sql is committed
// (#812 decision 1). Committedness is the wrong test twice over: an uncommitted hop is
// necessarily newer than any built bundle and so is already caught here, while a hop that
// is committed but not yet packaged -- the repo's state for most of 2026-09-22 -- passes a
// git check and still breaks every renderer.

import { DataServerError } from "../errors.js";

declare const __LITIGATION_SUBMISSION_SCHEMA_VERSION__: number;

/** Null only in the unbundled tsc build/ output (the test suite and dev runs), which esbuild
 * never defined -- the same shape, and the same reason, as build-stamp.ts's BUILD_STAMP. */
const BAKED_SCHEMA_VERSION: number | null =
  typeof __LITIGATION_SUBMISSION_SCHEMA_VERSION__ === "undefined"
    ? null
    : __LITIGATION_SUBMISSION_SCHEMA_VERSION__;

/**
 * The deliberate act that lets a developer apply an in-progress hop anyway (#812 decision 3).
 *
 * Read from the environment, never from a tool argument. Setting it takes a server restart,
 * which no model can perform mid-session; a tool argument would be reachable by the very
 * drafting_forms__open_session call this guard exists to stop, which is exactly how L8145
 * was migrated in the first place.
 */
export const OVERRIDE_ENV = "COCLERK_SUBMISSION_ALLOW_UNBUILT_SCHEMA";

/**
 * Test seam only: states the ceiling when there is no baked one.
 *
 * Deliberately LOSES to the baked value, so it is not a production bypass -- on a real
 * bundled server it does nothing at all. The escape hatch is OVERRIDE_ENV above.
 */
export const CEILING_SEAM_ENV = "COCLERK_SUBMISSION_BUNDLE_SCHEMA_VERSION";

const OFF = new Set(["", "0", "false", "no", "off"]);

export function overrideActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[OVERRIDE_ENV];
  return typeof value === "string" && !OFF.has(value.trim().toLowerCase());
}

/** This bundle's stated ceiling, or null when it has none (unbundled, and no seam set). */
export function bundleSchemaVersion(env: NodeJS.ProcessEnv = process.env): number | null {
  if (BAKED_SCHEMA_VERSION !== null) return BAKED_SCHEMA_VERSION;
  const seam = Number(env[CEILING_SEAM_ENV]);
  return Number.isInteger(seam) ? seam : null;
}

/**
 * The highest schema version this process can actually read.
 *
 * Unbundled code carries no declaration, so it falls back to the engine's target -- the
 * pre-#812 behaviour, which is what the test suite and dev runs already expect.
 */
export function renderableSchemaVersion(engineTarget: number, env: NodeJS.ProcessEnv = process.env): number {
  return bundleSchemaVersion(env) ?? engineTarget;
}

export interface SchemaSourceStatus {
  /** TARGET_SCHEMA_VERSION in the working tree's migrate_engine.py -- what a migration would apply. */
  schema_target_version: number;
  /** The schema version this bundle was built against; null when running unbundled. */
  bundle_schema_version: number | null;
  /** True only when both are known and a migration would push a database past this bundle. */
  schema_source_ahead: boolean;
  /** Present when the source is ahead, or when the override is in force -- says which. */
  schema_note?: string;
}

/**
 * Migration-source divergence, reported on every bootstrap response whether or not a
 * migration was attempted (#812) -- the same spirit as build-stamp.ts's stale-server report,
 * which rides along on every response including refusals.
 */
export function schemaSourceStatus(engineTarget: number, env: NodeJS.ProcessEnv = process.env): SchemaSourceStatus {
  const ceiling = bundleSchemaVersion(env);
  const ahead = ceiling !== null && engineTarget > ceiling;
  const override = overrideActive(env);

  if (ahead && override) {
    return {
      schema_target_version: engineTarget,
      bundle_schema_version: ceiling,
      schema_source_ahead: true,
      schema_note:
        `The migration source targets schema version ${engineTarget}; this bundle was built against ${ceiling}. ` +
        `${OVERRIDE_ENV} is set, so migrations are NOT being withheld -- a database migrated now will be on a ` +
        "schema this bundle cannot read, and cannot be rendered until the plugin is rebuilt and reinstalled.",
    };
  }
  if (ahead) {
    return {
      schema_target_version: engineTarget,
      bundle_schema_version: ceiling,
      schema_source_ahead: true,
      schema_note:
        `The migration source targets schema version ${engineTarget}; this bundle was built against ${ceiling}. ` +
        "Migrations are being withheld until the plugin is rebuilt and reinstalled, so no database is pushed to a " +
        "schema this bundle cannot read.",
    };
  }
  if (override) {
    return {
      schema_target_version: engineTarget,
      bundle_schema_version: ceiling,
      schema_source_ahead: false,
      schema_note: `${OVERRIDE_ENV} is set, but the migration source is not ahead of this bundle, so it changes nothing.`,
    };
  }
  return { schema_target_version: engineTarget, bundle_schema_version: ceiling, schema_source_ahead: false };
}

/**
 * Throws when a migration would push dbPath past what this bundle can read.
 *
 * Called before the data lock and before any spawn, so a withheld migration leaves the
 * database file, its recorded version and its backup set untouched -- nothing is copied
 * aside for a migration that never ran.
 */
export function assertMigrationWithinBundle(
  dbPath: string,
  engineTarget: number,
  env: NodeJS.ProcessEnv = process.env
): void {
  const ceiling = bundleSchemaVersion(env);
  if (ceiling === null || engineTarget <= ceiling || overrideActive(env)) return;

  throw new DataServerError(
    `Migration withheld for ${dbPath}: the migration source would take this database to schema version ` +
      `${engineTarget}, but this plugin bundle was built against ${ceiling} and cannot read ${engineTarget}. ` +
      "The database, its recorded schema version and its backups are unchanged; nothing was copied aside. " +
      "Rebuild and reinstall the Probanda plugin so its bundle matches the migration source, then start a new " +
      `session. To apply an in-progress hop on purpose, set ${OVERRIDE_ENV}=1 in the server's environment and ` +
      "restart it -- every database migrated that way stays unrenderable until a matching bundle is installed.",
    "schema_ahead_of_bundle"
  );
}
