import { readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { deleteCredential, readCredential, writeCredential } from "./credential-manager.js";
import { defaultStateDir, readProtectedJson } from "./dpapi-store.js";

// The one Probanda's Cloud credential: the static Supabase key that the lawyer
// plugin's data server saves through cloud_key__configure_credential. Shared by
// the commons server and the data server, so both read the same store with the same
// overrides (docs/Plans/2026-10-14_practice-db-conversion.md, step 3). Plain
// JavaScript for the reason given in dpapi-store.js.
//
// Since 2026-10-22 the key lives in Windows Credential Manager as the generic
// credential CLOUD_KEY_TARGET (credential-manager.js), not in a file: the packaged
// Claude app redirects %LOCALAPPDATA% into its own LocalCache, so a file saved from
// inside the app was lost with the package and unseen from outside it. A key an
// earlier version saved as a DPAPI file, at the real path or a redirected one, is
// moved into the store the first time it is read, and the file is then deleted.

// Public, non-secret Supabase project URL. After the three-layer teardown (B5,
// 2026-07-14) the only remaining Supabase consumer is the layer-3 legal-commons
// client (legal-commons/config.ts), which reads this as the default host for its
// static-credential PostgREST calls. The cloud anon key, per-session auth config,
// and matter_id UUID validation were removed with the retired matter-data surface.
export const BAKED_SUPABASE_URL = "https://nbzkuhgiqscjkypedqff.supabase.co";

/** The credential's name in Credential Manager (Control Panel, Windows Credentials, Generic Credentials). */
export const CLOUD_KEY_TARGET = "Probanda/cloud-key";

/** The store every server reads: Credential Manager, under CLOUD_KEY_TARGET. */
export const credentialManagerStore = {
  read: () => readCredential(CLOUD_KEY_TARGET),
  write: (secret) => writeCredential(CLOUD_KEY_TARGET, secret),
  delete: () => deleteCredential(CLOUD_KEY_TARGET),
};

let activeStore = credentialManagerStore;

/** Tests swap in a fake with the same three methods, so no test touches the practitioner's Credential Manager. Returns the previous store. */
export function setCloudKeyStore(store) {
  const previous = activeStore;
  activeStore = store;
  return previous;
}

// A read costs a PowerShell spawn (about 1 s), so each process keeps the key it
// read or saved, per store. Only presence is cached: a missing key is looked for
// again on every call, which is how a key saved by the data server reaches the
// commons server in the same session.
const cached = new WeakMap();

/** Where versions before 2026-10-22 kept the key: the legacy file, read only to migrate it. */
export function credentialPath(env = process.env) {
  return join(defaultStateDir(env), "credential.json.dpapi");
}

// Env wins outright; only when env is blank do we pay for the store.
//
// This runs during server startup, so it must not throw on a store or legacy file
// that cannot be read: DPAPI keys are tied to the Windows profile, so a password
// reset, profile rebuild, or machine migration invalidates a legacy file, and
// letting that propagate would crash start() before it registers the very tool
// that lets the practitioner re-supply the key. It degrades to unconfigured
// instead, but loudly: the reason is written to stderr here and carried on every
// later "not configured" error. An unreadable legacy file is left in place.
export async function loadCommonsKey(env = process.env, store = activeStore) {
  const key = {
    supabaseUrl: env.SUPABASE_URL || BAKED_SUPABASE_URL,
    // Deliberately NOT falling back to the public anon key: it has no grants on
    // legal_commons, so a fallback would only turn "not configured" into a
    // confusing "permission denied". Fail with a clear message instead.
    staticKey: env.LEGAL_COMMONS_SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
  if (key.staticKey) return key;
  if (cached.has(store)) return { ...key, staticKey: cached.get(store) };

  try {
    const stored = (await store.read()) || (await migrateLegacyFile(env, store));
    if (stored) {
      cached.set(store, stored);
      key.staticKey = stored;
    }
  } catch (error) {
    // stderr carries the whole thing (a PowerShell failure drags a stack trace
    // with it, which is what you want when debugging); the tool-facing error
    // carries only the first line, which is the actionable part.
    const detail = error instanceof Error ? error.message : String(error);
    key.credentialError = detail.split("\n")[0].trim();
    process.stderr.write(
      `legal-commons: the stored credential (${CLOUD_KEY_TARGET}) could not be read: ` +
      `${detail}\nStarting unconfigured; call cloud_key__configure_credential to replace it.\n`
    );
  }
  return key;
}

// Saves the key where loadCommonsKey reads it, and forgets any legacy file, which
// would otherwise keep an old secret on disk for ever.
export async function saveCommonsKey(staticKey, env = process.env, store = activeStore) {
  await store.write(staticKey);
  cached.set(store, staticKey);
  await removeLegacyFiles(await legacyFiles(env), () => {});
}

/** The legacy file's real path and every copy a packaged app redirected into its LocalCache. */
async function legacyFiles(env) {
  const packages = join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Packages");
  let names = [];
  try {
    names = await readdir(packages);
  } catch {
    // No Packages folder: nothing was redirected.
  }
  return [
    credentialPath(env),
    ...names.map((name) => join(packages, name, "LocalCache", "Local", "Coclerk", "legal-commons", "credential.json.dpapi")),
  ];
}

// Reads each legacy file; the first key found is written to the store, then every
// file that was read is deleted. With no key found, the first read error is
// rethrown, so an undecryptable file is reported as before, not reported absent.
async function migrateLegacyFile(env, store) {
  let found = "";
  let firstError;
  const readable = [];
  for (const path of await legacyFiles(env)) {
    try {
      const persisted = await readProtectedJson(path, null);
      if (persisted === null) continue;
      readable.push(path);
      if (!found && persisted?.staticKey) found = persisted.staticKey;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (!found) {
    if (firstError) throw firstError;
    return "";
  }
  await store.write(found);
  await removeLegacyFiles(readable, (error) => {
    throw new Error(`the key was moved into Credential Manager, but its old file could not be deleted: ${error.message}`);
  });
  return found;
}

async function removeLegacyFiles(paths, onError) {
  for (const path of paths) {
    try {
      await unlink(path);
    } catch (error) {
      if (error?.code !== "ENOENT") onError(error);
    }
  }
}
