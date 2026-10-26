// The suggestion_box__* and suggestion_log__* tools, over the local suggestion store (store.ts).
//
// suggestion_box__submit saves the suggestion the practitioner said yes to, exactly, then sends it
// (send.ts). suggestion_box__status reads the badges of the suggestions this computer sent and, when
// one changed since it was last shown, writes the Past suggestions page (page.ts) for the session to
// show as a file card. suggestion_box__past_suggestions writes that page on request.
// suggestion_log__read lists what the store holds, and suggestion_log__write records a badge as shown
// and holds or releases a suggestion drafted while this computer had no Probanda key. Tool definitions
// live in schema/suggestions.ts.

import { randomUUID } from "node:crypto";

import { DataServerError, ValidationError } from "../errors.js";
import { type SendSeams, fieldsFromToolArgs, readStatuses, submitSuggestion } from "./send.js";
import { writePastSuggestionsPage } from "./page.js";
import { type HeldRecord, cardStatus, isHeld, isSuggestion, loadStore, withStore } from "./store.js";

type Args = Record<string, unknown>;

export function isSuggestionToolName(name: string): boolean {
  return name.startsWith("suggestion_box__") || name.startsWith("suggestion_log__");
}

export function callSuggestionTool(name: string, args: Args, env: NodeJS.ProcessEnv = process.env, seams: SendSeams = {}): Promise<unknown> {
  switch (name) {
    case "suggestion_box__submit":
      return submitSuggestion(fieldsFromToolArgs(args), env, seams);
    case "suggestion_box__status":
      return status(args, env, seams);
    case "suggestion_box__past_suggestions":
      return writePastSuggestionsPage(env).then((path) => ({ past_suggestions_path: path }));
    case "suggestion_log__read":
      return suggestionLogRead(env);
    case "suggestion_log__write":
      return suggestionLogWrite(args, env);
    default:
      return Promise.reject(new ValidationError(`Unknown suggestion tool "${name}"`));
  }
}

async function status(args: Args, env: NodeJS.ProcessEnv, seams: SendSeams): Promise<unknown> {
  const ids = args.suggestion_ids === undefined ? undefined : (args.suggestion_ids as string[]);
  const result = await readStatuses(ids, env, seams);
  return {
    ...result,
    past_suggestions_path: result.changed.length ? await writePastSuggestionsPage(env) : null,
  };
}

function text(raw: unknown, name: string): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new ValidationError(`${name} must be a non-empty string`);
  return raw.trim();
}

export async function suggestionLogRead(env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  const store = await loadStore(env);
  return {
    suggestions: store.records.filter(isSuggestion).map((r) => ({
      record_id: r.record_id,
      suggestion_id: r.suggestion_id,
      title: r.title,
      sent_on: r.created_at.slice(0, 10),
      status: r.withdrawn_at === null ? cardStatus(r) : "Withdrawn",
      badge: r.badge,
      shown_badge: r.shown_badge,
      withdrawn: r.withdrawn_at !== null,
    })),
    held: store.records.filter(isHeld).map((r) => ({ held_id: r.record_id, held_on: r.created_at.slice(0, 10), draft: r.draft })),
  };
}

export async function suggestionLogWrite(args: Args, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  if (args.op === "seen") {
    const ids = args.suggestion_ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && id.trim())) {
      throw new ValidationError("seen takes suggestion_ids: the ids suggestion_box__status returned as changed");
    }
    const wanted = new Set(ids.map((id: string) => id.trim().toLowerCase()));
    return withStore(env, (store) => {
      const records = store.records.filter(isSuggestion).filter((r) => r.suggestion_id !== null && wanted.has(r.suggestion_id.toLowerCase()));
      const missing = [...wanted].filter((id) => !records.some((r) => r.suggestion_id?.toLowerCase() === id));
      if (missing.length) throw new DataServerError(`no suggestion ${missing.join(", ")} on this computer`, "not_found");
      for (const r of records) r.shown_badge = r.badge;
      return { status: "updated", suggestions: records.map((r) => ({ suggestion_id: r.suggestion_id, shown_badge: r.shown_badge })) };
    });
  }
  if (args.op === "hold") {
    const draft = args.draft as Record<string, unknown> | undefined;
    if (typeof draft !== "object" || draft === null || Array.isArray(draft)) {
      throw new ValidationError("draft must be the suggestion as drafted: an object with title and body");
    }
    text(draft.title, "draft.title");
    text(draft.body, "draft.body");
    const record: HeldRecord = { kind: "held", record_id: randomUUID(), created_at: new Date().toISOString(), draft };
    return withStore(env, (store) => {
      store.records.push(record);
      return { status: "held", held_id: record.record_id };
    });
  }
  if (args.op === "release") {
    const heldId = text(args.held_id, "held_id");
    return withStore(env, (store) => {
      const index = store.records.findIndex((r) => isHeld(r) && r.record_id === heldId);
      if (index < 0) throw new DataServerError(`no held suggestion ${heldId} on this computer`, "not_found");
      store.records.splice(index, 1);
      return { status: "released", held_id: heldId };
    });
  }
  throw new ValidationError(`op must be "seen", "hold" or "release"`);
}
