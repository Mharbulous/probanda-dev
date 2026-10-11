// Which hosts the sources module may contact (spec §3.3 "Allowed hosts", #989).
//
// Two layers: the shipped constant below, and the firm's own `_hosts.json` in
// its knowledge overlay, where a host is added only on a practitioner's yes.
// fetch.ts joins them for every request (overlayFirmHosts).
//
// Kept as a plain exported array literal so /plugin-packager's
// `sources-host-guard` check can extract it from the built bundle and compare
// it with its own expected set. Adding a host is one line here and one line in
// that check (`SOURCES_ALLOWED_HOSTS` in direct_mode.py).
//
// The two bclaws hosts are spec §3.3's. `vaniac.org` goes beyond it: the
// practitioner confirmed it as plan Phase 2's named HITL confirmation (#989),
// because the VanIAC sources are checked from the shipped tree.
// `laws-lois.justice.gc.ca` (Justice Laws, the federal publisher) serves
// legislation-fetcher's federal statutes and regulations.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { configPath } from "../config-path.js";
import { DataServerError, ValidationError } from "../errors.js";
import { resolveCaseDataRoot } from "../practice/backend.js";

export const SOURCES_ALLOWED_HOSTS: readonly string[] = ["www.bclaws.gov.bc.ca", "bclaws.gov.bc.ca", "vaniac.org", "laws-lois.justice.gc.ca"];

/**
 * The hosts a firm has approved in its `_hosts.json`: a JSON array of
 * `{host, category, page_url, added, approved_by}` entries. An entry is admitted
 * only with a `host`, a `category` and `approved_by` exactly "practitioner"
 * (shared/knowledge-tree.md); any other entry is ignored. A missing file means no firm
 * hosts. Read afresh on every call, so an approval takes effect without a
 * restart. A file that is not a JSON array fails hard rather than reading as
 * "no firm hosts".
 */
export function loadFirmHosts(path: string): string[] {
  const hosts = new Set<string>();
  for (const entry of readHostEntries(path)) {
    const host = admittedHost(entry);
    if (host !== null) hosts.add(host);
  }
  return [...hosts];
}

/** An entry's host, lower-cased, when the entry is admitted; null when it is ignored. */
export function admittedHost(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { host, category, approved_by } = entry as Record<string, unknown>;
  if (!filled(host) || !filled(category) || approved_by !== "practitioner") return null;
  return host.toLowerCase();
}

/**
 * The entries of a `_hosts.json`, unfiltered; a missing file holds none. A file that is
 * not a JSON array fails hard, for the loader and for knowledge__write alike.
 */
export function readHostEntries(path: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let entries: unknown;
  try {
    entries = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
  } catch (err) {
    throw new DataServerError(`${path} is not valid JSON: ${(err as Error).message}`, "invalid_hosts_file");
  }
  if (!Array.isArray(entries)) {
    throw new DataServerError(`${path} must hold a JSON array of host entries`, "invalid_hosts_file");
  }
  return entries;
}

function filled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The firm's approved hosts from its knowledge overlay,
 * `<case_data_root>\_practice\knowledge\_hosts.json`, read afresh on every call.
 * Without a configured case data root there is no overlay, so no firm hosts: the
 * shipped constant alone applies, and a fetch to a firm host is refused, naming it.
 * A configuration that is present but broken (coclerk.json not JSON, the configured
 * root missing) fails hard rather than reading as "no firm hosts".
 */
export function overlayFirmHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  let root: string;
  try {
    root = resolveCaseDataRoot(env);
  } catch (err) {
    if (err instanceof ValidationError && !caseDataRootConfigured(env)) return [];
    throw err;
  }
  return loadFirmHosts(join(root, "_practice", "knowledge", "_hosts.json"));
}

/**
 * Whether coclerk.json (where resolveCaseDataRoot reads it) exists and names a
 * case_data_root. A file that does not parse counts as configured, so its error surfaces.
 */
function caseDataRootConfigured(env: NodeJS.ProcessEnv): boolean {
  const configFile = configPath(env);
  if (!existsSync(configFile)) return false;
  try {
    const root = (JSON.parse(readFileSync(configFile, "utf-8")) as Record<string, unknown>).case_data_root;
    return typeof root === "string" && root !== "";
  } catch {
    return true;
  }
}
