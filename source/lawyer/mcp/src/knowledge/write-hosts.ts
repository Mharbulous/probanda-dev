// ------------------------------------------------------------ firm hosts --

import { DataServerError, ValidationError } from "../errors.js";
import { admittedHost, readHostEntries } from "../sources/hosts.js";
import { withFileLock, writeTextAtomic } from "../file-lock.js";
import { entryType, type KnowledgePath } from "./tree.js";
import { provenance, today } from "./common.js";
import { refuseArgs, rowString, writableOverlayPath, type Args, type Json, type WriteSeams } from "./overlay.js";

/** The one reserved overlay entry knowledge__write writes: the firm's approved fetch hosts. */
export const HOSTS_FILE = "_hosts.json";

/** The official-source categories a firm host is approved under (#948 item 5): the venue's own publications, the official statute publisher, a regulator. */
const HOST_CATEGORIES: readonly string[] = ["venue", "statute", "regulator"];

/** A DNS name of two or more labels whose last label is not all digits, so never an IP address, a port or a URL. */
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?=[a-z0-9-]*[a-z])[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Record the practitioner's yes to a fetch host: one `{host, category, page_url}` row, to
 * which the runtime adds `added` and `approved_by: "practitioner"` (#989 section 6). Keyed
 * by host under a lock; an entry already there for the host is left as it is.
 */
export async function writeHostEntry(kp: KnowledgePath, args: Args, seams: WriteSeams, label: string): Promise<Record<string, unknown>> {
  if (args.operation !== "create") throw new ValidationError(`knowledge__write: ${HOSTS_FILE} takes operation "create" with one row`);
  refuseArgs(args, ["content", "overwrite", "rule_ref", "value", "saved_copy"], `to ${HOSTS_FILE}, which is written one host row at a time`);
  const row = args.row;
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new ValidationError(`knowledge__write.row must be one ${HOSTS_FILE} entry: {host, category, page_url}`);
  }
  const extra = Object.keys(row).filter((key) => !["host", "category", "page_url"].includes(key));
  if (extra.length) throw new ValidationError(`knowledge__write.row: ${extra.join(", ")} is not a caller field of a ${HOSTS_FILE} entry; the runtime stamps added and approved_by`);
  const host = rowString(row as Json, "host").toLowerCase();
  if (!HOSTNAME.test(host)) throw new ValidationError(`knowledge__write.row.host must be a hostname, such as civilresolutionbc.ca; got ${JSON.stringify((row as Json).host)}`);
  const category = rowString(row as Json, "category");
  if (!HOST_CATEGORIES.includes(category)) {
    throw new ValidationError(`knowledge__write.row.category must be one of ${HOST_CATEGORIES.join(", ")} (the admitted official sources); got ${JSON.stringify(category)}`);
  }
  const page_url = rowString(row as Json, "page_url");

  const target = writableOverlayPath(kp, seams, label);
  return withFileLock(target.abs, () => {
    if (entryType(target, label, kp.path) === "dir") throw new DataServerError(`${label}: ${kp.path} is a folder in the overlay`, "not_a_file");
    const entries = readHostEntries(target.abs);
    const known = entries.find((entry) => typeof entry === "object" && entry !== null && String((entry as Json).host).toLowerCase() === host);
    if (known && admittedHost(known) === null) {
      throw new DataServerError(
        `${target.abs}: the entry for ${host} lacks a category or approved_by "practitioner", so it is not admitted, and only the practitioner corrects it by hand. Nothing was written.`,
        "invalid_hosts_file"
      );
    }
    if (known) return { path: kp.path, host, status: "exists", entry: known, ...provenance(null, seams) };
    const entry = { host, category, page_url, added: today(), approved_by: "practitioner" };
    writeTextAtomic(target.abs, JSON.stringify([...entries, entry], null, 2) + "\n");
    return { path: kp.path, host, status: "created", entry, ...provenance(null, seams) };
  });
}
