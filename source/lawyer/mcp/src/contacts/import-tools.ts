// Adds the contacts of a spreadsheet export to the address book. The scan writes nothing
// to the address book: it sorts every row by fixed rules and saves a plan. The apply tools
// carry out that plan and nothing else: a new card, or lines added to an existing card.
// No value a card holds is removed or replaced, and an ambiguous row is never written.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { getObject, requireDav, type DavContext } from "../dav/session.js";
import type { MailCredential } from "../mail/config.js";
import type { Tool } from "../tool-list.js";
import { readBook } from "./book.js";
import { createCard, replaceCard } from "./card-write.js";
import { classify, type Outcome } from "./import-classify.js";
import { decodeCsv, readContactRows } from "./import-csv.js";
import { deadline, loadPlan, newPlanId, requireRunnable, revNow, sameEtag, savePlan, stateFolder, type Plan } from "./plans.js";
import { addLines, lostProperties, newCard } from "./vcard-edit.js";
import { parseContact } from "./vcard.js";

type Args = Record<string, unknown>;

export const contactsImportTools: Tool<DavContext>[] = [
  { name: "contacts__import_scan", handler: (args, context) => importScan(context, args) },
  { name: "contacts__import_apply", handler: (args, context) => importApply(context, args, true) },
  { name: "contacts__import_apply_continue", handler: (args, context) => importApply(context, args, false) },
];

interface Item {
  name: string;
  state?: "done" | "stopped";
  why?: string;
}

interface ImportPlan extends Plan {
  kind: "import";
  creates: Array<Item & { row: number; file_name: string; text: string }>;
  updates: Array<Item & { url: string; etag?: string; lines: string[]; rows: number[] }>;
}

const SHOWN = 20;

function reportLine(outcome: Outcome): string {
  const what =
    outcome.class === "new" ? "new contact" :
    outcome.class === "add_only" ? `add to the existing contact: ${outcome.added.join(", ")}` :
    outcome.class === "unchanged" ? "already in the address book" :
    outcome.class === "duplicate_row" ? `the same contact as row ${outcome.of_row}` :
    `not written, needs your decision: ${outcome.reason} (${outcome.candidates.join(", ")})`;
  const conflicts = "conflicts" in outcome && outcome.conflicts.length ? ` [left as it is: ${outcome.conflicts.join(", ")}]` : "";
  return `row ${outcome.row}: ${outcome.name} - ${what}${conflicts}`;
}

async function importScan(context: DavContext, args: Args): Promise<unknown> {
  const credential = requireDav(context.mail, "carddav");
  if (typeof args.path !== "string" || !args.path) throw new ValidationError("contacts__import_scan requires path");
  const decisions = (args.decisions ?? {}) as Record<string, string>;
  if (typeof decisions !== "object" || Object.values(decisions).some((value) => typeof value !== "string")) {
    throw new ValidationError("contacts__import_scan.decisions must map a row number to \"new\" or a contact url");
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(args.path);
  } catch {
    throw new ValidationError(`Could not read a file at ${args.path}`);
  }
  const { rows, skipped } = readContactRows(decodeCsv(bytes));
  const { bookUrl, cards } = await readBook(context, credential);
  const { outcomes, creates, updates } = classify(rows, cards, decisions);
  const nameAt = new Map(cards.map((card) => [card.url, parseContact(card.text).name]));
  const rev = revNow();
  const plan: ImportPlan = {
    kind: "import",
    plan_id: newPlanId(),
    created_at: new Date().toISOString(),
    book_url: bookUrl,
    status: "planned",
    creates: creates.map(({ row, incoming, lines }) => {
      const uid = randomUUID();
      return { row, name: incoming.name, file_name: `${uid}.vcf`, text: addLines(newCard(incoming, uid, rev), lines, rev) };
    }),
    updates: updates.map((update) => ({ ...update, name: nameAt.get(update.url) ?? "" })),
  };
  savePlan(plan);
  const reportPath = join(stateFolder("plans"), `${plan.plan_id}-report.txt`);
  writeFileSync(reportPath, [...outcomes.map(reportLine), ...skipped.map((row) => `row ${row.row}: left out, ${row.reason}`)].join("\r\n") + "\r\n", "utf-8");

  const count = (name: Outcome["class"]) => outcomes.filter((outcome) => outcome.class === name).length;
  const ambiguous = outcomes.filter((outcome) => outcome.class === "ambiguous");
  const conflicts = outcomes.flatMap((outcome) => "conflicts" in outcome && outcome.conflicts.length
    ? [{ row: outcome.row, name: outcome.name, conflicts: outcome.conflicts }] : []);
  return {
    plan_id: plan.plan_id,
    rows: rows.length + skipped.length,
    counts: {
      new: count("new"), add_only: count("add_only"), unchanged: count("unchanged"),
      duplicate_row: count("duplicate_row"), ambiguous: ambiguous.length, left_out: skipped.length,
    },
    create_count: plan.creates.length,
    update_count: plan.updates.length,
    ambiguous: ambiguous.slice(0, SHOWN),
    conflicts: conflicts.slice(0, SHOWN),
    conflict_count: conflicts.length,
    report_path: reportPath,
  };
}

const codeOf = (error: unknown): string | undefined => (error instanceof DataServerError ? error.code : undefined);

async function createOne(context: DavContext, credential: MailCredential, plan: ImportPlan, item: ImportPlan["creates"][number]): Promise<void> {
  const url = plan.book_url + item.file_name;
  try {
    await createCard(context, credential, plan.book_url, item.file_name, item.text);
  } catch (error) {
    if (codeOf(error) !== "dav_exists") throw error; // already there: a run that stopped after sending it
  }
  const lost = lostProperties(item.text, (await getObject(context, credential, "carddav", url)).text);
  item.state = lost.length ? "stopped" : "done";
  if (lost.length) item.why = `added, but the address book holds it differently (${lost.join(", ")})`;
}

async function updateOne(context: DavContext, credential: MailCredential, plan: ImportPlan, item: ImportPlan["updates"][number]): Promise<void> {
  const stop = (why: string) => {
    item.state = "stopped";
    item.why = why;
  };
  let current: { text: string; etag: string | null };
  try {
    current = await getObject(context, credential, "carddav", item.url);
  } catch (error) {
    if (!/^Nothing found/.test((error as Error).message)) throw error;
    return stop("no longer in the address book");
  }
  // Every line is already there: a run that stopped after sending it.
  if (lostProperties(item.lines.join("\r\n"), current.text).length === 0) {
    item.state = "done";
    return;
  }
  if (!sameEtag(current.etag, item.etag)) return stop("changed since the scan, so it was left as it is");
  const text = addLines(current.text, item.lines, revNow());
  try {
    await replaceCard(context, credential, plan.book_url, item.url, current.etag, text);
  } catch (error) {
    if (codeOf(error) !== "dav_stale") throw error;
    return stop("changed since the scan, so it was left as it is");
  }
  const lost = lostProperties(text, (await getObject(context, credential, "carddav", item.url)).text);
  if (lost.length) stop(`changed, but the address book holds it differently (${lost.join(", ")})`);
  else item.state = "done";
}

async function importApply(context: DavContext, args: Args, starting: boolean): Promise<unknown> {
  const credential = requireDav(context.mail, "carddav");
  const plan = loadPlan<ImportPlan>(args.plan_id, "import");
  if (starting) {
    if (args.create_count !== plan.creates.length || args.update_count !== plan.updates.length) {
      throw new ValidationError(`create_count and update_count must be the plan's: ${plan.creates.length} and ${plan.updates.length}`);
    }
    if (plan.creates.length + plan.updates.length === 0) throw new ValidationError("This plan changes nothing.");
  }
  requireRunnable(plan, starting, (await readBook(context, credential)).bookUrl, "contacts__import_apply_continue");
  plan.status = "writing";
  savePlan(plan);
  const until = deadline(context);
  const pending = () => [...plan.creates, ...plan.updates].filter((item) => item.state === undefined);
  for (const item of pending()) {
    if ("text" in item) await createOne(context, credential, plan, item);
    else await updateOne(context, credential, plan, item);
    savePlan(plan);
    if (Date.now() >= until) break;
  }
  if (pending().length === 0) plan.status = "done";
  savePlan(plan);
  const stopped = [...plan.creates, ...plan.updates].filter((item) => item.state === "stopped");
  return {
    status: plan.status,
    created: plan.creates.filter((item) => item.state === "done").length,
    updated: plan.updates.filter((item) => item.state === "done").length,
    remaining: pending().length,
    stopped: stopped.slice(0, SHOWN).map((item) => ({ name: item.name, why: item.why })),
    stopped_count: stopped.length,
  };
}
