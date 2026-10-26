// The suggestion_box__*, suggestion_card__* and suggestion_log__* tools, over the local suggestion
// store (store.ts).
//
// Nothing is sent by a tool: a suggestion is sent only by the practitioner's Submit Suggestion on its
// card (card.ts, through the page API), which is their approval (decision 10).
// suggestion_card__build builds the card from the session's scrubbed draft, refusing while the full
// check finds a match; suggestion_card__wait blocks until the practitioner submits, dismisses or asks
// for a mockup; suggestion_card__attach_mockup puts the session's mockup on the card.
// suggestion_card__check runs the click-time cross-check (crosscheck.ts) over a card's parts against
// this computer's own records (records.ts), and suggestion_card__environment_facts returns the
// environment facts (environment.ts); neither sends, stores or logs anything.
//
// suggestion_box__status reads the badges of the suggestions this computer sent and, when one
// changed since it was last shown, writes the Past suggestions page (page.ts) for the session to show
// as a file card. suggestion_box__past_suggestions writes that page on request. suggestion_log__read
// lists what the store holds, and suggestion_log__write records a badge as shown and releases a held
// draft, a suggestion an earlier version kept unposted for want of a key.
//
// suggestion_observation__record records what Probanda noticed about its own work as a structured
// observation (observation.ts), and suggestion_observation__next answers, under the daily cap and
// suppression, which observation this session may raise as its AI-noticed card now. Tool definitions
// live in schema/suggestions.ts.

import { DataServerError, ValidationError } from "../errors.js";
import { type SendSeams, readStatuses } from "./send.js";
import { writePastSuggestionsPage } from "./page.js";
import type { PracticeStore } from "../practice/store.js";
import { attachMockup, buildCard, cardInput, openCards, waitForCard } from "./card.js";
import { loadStopWords, runCrossCheck, type CardText } from "./crosscheck.js";
import { environmentFacts } from "./environment.js";
import { type ObservationSeams, nextObservation, recordObservation } from "./observation.js";
import { readRecordTexts } from "./records.js";
import { cardStatus, isHeld, isSuggestion, loadStore, withStore } from "./store.js";

type Args = Record<string, unknown>;

export function isSuggestionToolName(name: string): boolean {
  return name.startsWith("suggestion_box__") || name.startsWith("suggestion_log__") || name.startsWith("suggestion_observation__");
}

export function isSuggestionCardToolName(name: string): boolean {
  return name.startsWith("suggestion_card__");
}

export async function callSuggestionCardTool(store: PracticeStore, name: string, args: Args, env: NodeJS.ProcessEnv = store.env): Promise<unknown> {
  const deps = { env, records: () => readRecordTexts(store, env) };
  switch (name) {
    case "suggestion_card__check": {
      // The lists first: a check that cannot run says so before any record is read.
      const stopWords = loadStopWords(env);
      return runCrossCheck(args as CardText, await readRecordTexts(store, env), stopWords);
    }
    case "suggestion_card__environment_facts":
      return environmentFacts(args.tool_names as string[] | undefined, { env });
    case "suggestion_card__build": {
      const input = cardInput(args);
      const facts = environmentFacts(input.tool_names, { env }) as unknown as Record<string, unknown>;
      return buildCard(input, facts, deps);
    }
    case "suggestion_card__wait":
      return waitForCard(text(args.card_id, "card_id"), deps);
    case "suggestion_card__attach_mockup":
      return attachMockup(text(args.card_id, "card_id"), args.html, deps);
    default:
      throw new ValidationError(`Unknown suggestion tool "${name}"`);
  }
}

export function callSuggestionTool(name: string, args: Args, env: NodeJS.ProcessEnv = process.env, seams: ObservationSeams = {}): Promise<unknown> {
  switch (name) {
    case "suggestion_observation__record":
      return recordObservation(args, env, seams);
    case "suggestion_observation__next":
      return nextObservation(args, env, seams);
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
    open_cards: await openCards(env),
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
  if (args.op === "release") {
    const heldId = text(args.held_id, "held_id");
    return withStore(env, (store) => {
      const index = store.records.findIndex((r) => isHeld(r) && r.record_id === heldId);
      if (index < 0) throw new DataServerError(`no held suggestion ${heldId} on this computer`, "not_found");
      store.records.splice(index, 1);
      return { status: "released", held_id: heldId };
    });
  }
  throw new ValidationError(`op must be "seen" or "release"`);
}
