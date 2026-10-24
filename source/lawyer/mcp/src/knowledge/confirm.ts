// ------------------------------------------------------------ confirm and correct --

import { DataServerError, ValidationError } from "../errors.js";
import { pluginVersion } from "../repo-root.js";
import { readFrontMatter } from "../sources/check.js";
import { firm_profile, type FirmProfile } from "../tools/practice/firm-profile.js";
import { extractJsonBlock, substituteLayout, type BlockKind } from "./declared-layout.js";
import { substituteFormat } from "./declared-format.js";
import { passageHash, upsertSidecarRow, type SidecarRow } from "./sidecar.js";
import { indexAt, parseKnowledgePath, readServed, SIDECAR_SUFFIX, type KnowledgePath } from "./tree.js";
import { provenance, today } from "./common.js";
import { blockKindOf, itemsOf } from "./items.js";
import { grammarCheck, refuseArgs, writableOverlayPath, type Args, type Json, type WriteSeams } from "./overlay.js";

/** What a roster-lawyer check guards, as its refusals word it: `unset` finishes "so ...", `act`
 * finishes "only a roster lawyer ...", and `why` follows it on the not-a-lawyer refusal. */
export interface LawyerAct {
  unset: string;
  act: string;
  why: string;
}

const CONFIRM_ACT: LawyerAct = { unset: "a confirmation has no author", act: "confirms or corrects", why: ", because a confirmation lifts the filed refusal" };

/** This machine's `person`, which must be an active lawyer on the firm roster (section 10). Shared
 * with the Sent write (submission/forms/sent-write.ts). */
export function rosterLawyer(profile: FirmProfile, what: LawyerAct): string {
  if (profile.person === null) {
    throw new DataServerError(
      `person is not set: this machine's probanda.json names no firm roster key ("person"), so ${what.unset}. ` +
        "Set it with practice_data__upsert_firm_profile, then retry.",
      "person_unset"
    );
  }
  const entry = profile.roster.find((candidate) => candidate.key === profile.person);
  const role = entry?.role;
  if (role !== "lawyer") {
    throw new DataServerError(
      `person "${profile.person}" is ${role === "staff" ? "staff" : `not a lawyer (role ${JSON.stringify(role)})`} on the firm roster; ` +
        `only a roster lawyer ${what.act}${what.why}`,
      "not_a_lawyer"
    );
  }
  if (entry!.active === false) {
    throw new DataServerError(
      `person "${profile.person}" (${String(entry!.name)}) is a lawyer marked inactive on the firm roster; only an active roster lawyer ${what.act}`,
      "not_active"
    );
  }
  return profile.person;
}

/** `by`: this machine's `person`, which must be a lawyer on the firm roster (section 10). */
async function confirmingLawyer(env: NodeJS.ProcessEnv): Promise<string> {
  return rosterLawyer(await firm_profile(env), CONFIRM_ACT);
}

/** Substitute every correction into the merged file's block and run that tree's validator, failing hard. */
function validateCorrections(kp: KnowledgePath, content: string, kind: BlockKind | "format", noVenue: boolean, rows: SidecarRow[]): void {
  const corrections = rows.filter((row) => row.status === "corrected").map(({ rule_ref, value }) => ({ rule_ref, value }));
  if (kind === "format") {
    substituteFormat(extractJsonBlock(content, kp.path, false, "invalid_format") as Json, corrections, kp.path);
  } else {
    substituteLayout(extractJsonBlock(content, kp.path, true) as Json, kind, corrections, kp.path, { noVenue });
  }
}

export async function confirmItem(kp: KnowledgePath, args: Args, operation: "confirm" | "correct", seams: WriteSeams, label: string): Promise<Record<string, unknown>> {
  refuseArgs(args, ["content", "row", "overwrite", "saved_copy"], `to ${operation}`);
  if (operation === "confirm") refuseArgs(args, ["value"], "to confirm; value appears only on a correction");
  else if (!Object.hasOwn(args, "value")) {
    throw new ValidationError("knowledge__write.value is required to correct: the item's value, in the shape its file contract declares");
  }
  const ruleRef = args.rule_ref;
  if (typeof ruleRef !== "string" || ruleRef === "") throw new ValidationError(`knowledge__write.rule_ref is required to ${operation}`);
  if (kp.path.endsWith(SIDECAR_SUFFIX)) throw new DataServerError(`${label}: name the knowledge file itself; its sidecar follows from it (${kp.path})`, "reserved_suffix");
  if (indexAt(kp)) throw new DataServerError(`${label}: ${kp.path} is an index file, whose rows carry no rule_ref`, "not_confirmable");

  const by = await confirmingLawyer(seams.env ?? process.env);
  const served = readServed(kp, seams, label);
  const content = served.served.text;
  const { items } = itemsOf(kp, readFrontMatter(content, kp.path), seams, label);
  const item = items.find((candidate) => candidate.rule_ref === ruleRef);
  if (!item) {
    throw new DataServerError(`${kp.path}: no item of the merged file carries rule_ref ${JSON.stringify(ruleRef)}`, "rule_ref_not_found");
  }
  const kindOf = blockKindOf(kp);
  if (operation === "correct") {
    if (kp.rest.length === 5 && kp.rest[3] === "Sources") {
      throw new DataServerError(`${kp.path}: a Sources\\ excerpt is not correctable; its passage is fixed by refresh`, "not_correctable");
    }
    if (!kindOf) {
      throw new DataServerError(
        `${kp.path}: the runtime holds no validator for this file's contract, so its items are not correctable here ` +
          "(a /draft type file or venue.md, or a /publish format.md, is)",
        "not_correctable"
      );
    }
  }

  const row: SidecarRow = {
    rule_ref: ruleRef,
    status: operation === "confirm" ? "confirmed" : "corrected",
    by,
    on: today(),
    confirmed_against: { passage_hash: passageHash(item.passage), currency: item.currency },
    ...(operation === "correct" ? { value: args.value } : {}),
    // The writer's stamp (#992 item 9): the plugin that served the copy the passage hash binds to.
    // A skill-tree path always has a shipped layer, so shipped_from is never null here.
    plugin_version: pluginVersion(seams.installRoot),
    shipped_from: served.shipped_from!,
  };
  const sidecarKp = parseKnowledgePath(`${kp.path}${SIDECAR_SUFFIX}`, label);
  grammarCheck(sidecarKp, "file", label);
  const target = writableOverlayPath(sidecarKp, seams, label);
  const rows = await upsertSidecarRow(target.abs, kp.path, row, (next) => {
    if (operation === "correct") validateCorrections(kp, content, kindOf!.kind, kindOf!.noVenue, next);
  });
  return { path: kp.path, sidecar: sidecarKp.path, row, rows: rows.length, ...provenance(served.shipped_from, seams) };
}
