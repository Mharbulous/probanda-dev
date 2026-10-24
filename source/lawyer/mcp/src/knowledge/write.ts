// ------------------------------------------------------------ knowledge__write --
//
// Granted only to the /localize helper. It writes the firm's overlay and nothing else:
// a document file whole (create, with an explicit overwrite for a refresh), one index
// row, or one confirmation sidecar row (confirm, correct).

import { DataServerError, ValidationError } from "../errors.js";
import { indexAt, parseKnowledgePath, SIDECAR_SUFFIX } from "./tree.js";
import { grammarCheck, matterOf, refuseArgs, type Args, type WriteSeams } from "./overlay.js";
import { HOSTS_FILE, writeHostEntry } from "./write-hosts.js";
import { confirmItem } from "./confirm.js";
import { writeIndexRow } from "./write-index.js";
import { writeDocument } from "./write-document.js";

export async function knowledgeWrite(args: Args, seams: WriteSeams = {}): Promise<Record<string, unknown>> {
  const label = "knowledge__write.path";
  const matter = matterOf(args.matter, "knowledge__write");
  const kp = parseKnowledgePath(args.path, label);
  if (kp.path === HOSTS_FILE) return writeHostEntry(kp, args, seams, label);
  if (!kp.skill) {
    throw new DataServerError(
      `${label}: knowledge__write writes a skill's tree and ${HOSTS_FILE} only; "${kp.head}" is written by its own tool (knowledge__retire, sources__fetch) or by the practitioner`,
      "reserved_entry"
    );
  }
  const name = kp.segments[kp.segments.length - 1];
  if (args.operation === "confirm" || args.operation === "correct") return confirmItem(kp, args, args.operation, seams, label);
  if (args.operation !== "create") throw new ValidationError('knowledge__write.operation must be "create", "confirm" or "correct"');

  refuseArgs(args, ["rule_ref", "value"], "to create");
  if (name.endsWith(SIDECAR_SUFFIX)) {
    throw new DataServerError(`${label}: the ${SIDECAR_SUFFIX} suffix is reserved for confirm and correct, and create refuses it (${kp.path})`, "reserved_suffix");
  }
  if (name === "venues.json" || name === "kinds.json") {
    throw new DataServerError(`${label}: the overlay never holds ${name}; write one row to ${name.replace(".json", ".local.json")} beside it (${kp.path})`, "grammar_violation");
  }
  grammarCheck(kp, "file", label);
  const index = indexAt(kp);
  if (index) return writeIndexRow(kp, index, args, seams, label);
  return writeDocument(kp, args, matter, seams, label);
}
