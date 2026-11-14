// Merges cards in the address book that are the same contact. The scan and the plan write
// nothing to the address book. The apply tools carry out a plan, one group at a
// time, in this order: save every card of the group to a backup file on this machine, write
// the merged card, read it back, add the kept card to any contact group the other was in,
// and only then take the other card out. A removed card comes back with the restore tool.

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { normalizeName } from "../contact-match.js";
import { DataServerError, ValidationError } from "../errors.js";
import { getObject, requireDav, type DavContext } from "../dav/session.js";
import type { MailCredential } from "../mail/config.js";
import type { Tool } from "../tool-list.js";
import { readBook } from "./book.js";
import { createCard, removeCard, replaceCard } from "./card-write.js";
import { findGroups, mergeGroup, type Group, type GroupClass } from "./merge-cards.js";
import { deadline, loadPlan, newPlanId, requireRunnable, revNow, sameEtag, savePlan, stateFolder, type Plan } from "./plans.js";
import { addLines, lostProperties } from "./vcard-edit.js";
import { parseContact } from "./vcard.js";

type Args = Record<string, unknown>;

export const contactsMergeTools: Tool<DavContext>[] = [
  { name: "contacts__merge_scan", handler: (_args, context) => mergeScan(context) },
  { name: "contacts__merge_plan", handler: (args, context) => mergePlan(context, args) },
  { name: "contacts__merge_apply", handler: (args, context) => mergeApply(context, args, true) },
  { name: "contacts__merge_apply_continue", handler: (args, context) => mergeApply(context, args, false) },
  { name: "contacts__restore_card", handler: (args, context) => restoreCard(context, args) },
];

interface Saved {
  url: string;
  etag?: string;
  text: string;
  name: string;
}

interface MergePlan extends Plan {
  kind: "merge";
  groups: Array<{ group_id: string; name: string; keep: Saved; others: Saved[]; merged_text: string; state?: "done" | "stopped"; why?: string }>;
}

const SHOWN = 20;
const ORDER: GroupClass[] = ["exact", "mergeable", "needs_choice", "possible"];

const shown = (group: Group) => ({
  group_id: group.group_id,
  class: group.class,
  keep: group.keep,
  conflicts: group.conflicts,
  contacts: group.members.map(({ url, contact }) => ({
    url, name: contact.name, organization: contact.organization,
    emails: contact.emails.map((entry) => entry.value), phones: contact.phones.map((entry) => entry.value),
  })),
});

async function mergeScan(context: DavContext): Promise<unknown> {
  const credential = requireDav(context.mail, "carddav");
  const groups = findGroups((await readBook(context, credential)).cards).sort((a, b) => ORDER.indexOf(a.class) - ORDER.indexOf(b.class));
  const reportPath = join(stateFolder("plans"), `merge-scan-${newPlanId()}.txt`);
  writeFileSync(reportPath, groups.map((group) =>
    `${group.group_id} (${group.class}${group.conflicts.length ? `: ${group.conflicts.join(", ")} differ` : ""})\r\n` +
    shown(group).contacts.map((c) => `  ${c.url === group.keep ? "keep" : "    "} ${c.name} | ${[...c.emails, ...c.phones].join(", ")}\r\n`).join("")
  ).join("\r\n"), "utf-8");
  return {
    counts: Object.fromEntries(ORDER.map((name) => [name, groups.filter((group) => group.class === name).length])),
    group_count: groups.length,
    groups: groups.slice(0, SHOWN).map(shown),
    report_path: reportPath,
  };
}

async function mergePlan(context: DavContext, args: Args): Promise<unknown> {
  const credential = requireDav(context.mail, "carddav");
  const wanted = args.groups as Array<{ group_id?: unknown; keep?: unknown; choices?: unknown; same_person?: unknown }>;
  if (!Array.isArray(wanted) || wanted.length === 0) throw new ValidationError("contacts__merge_plan requires groups");
  const { bookUrl, cards } = await readBook(context, credential);
  const found = new Map(findGroups(cards).map((group) => [group.group_id, group]));
  const rev = revNow();
  const plan: MergePlan = {
    kind: "merge", plan_id: newPlanId(), created_at: new Date().toISOString(), book_url: bookUrl, status: "planned",
    groups: wanted.map((want) => {
      const group = found.get(String(want.group_id));
      if (!group) throw new DataServerError(`Group ${String(want.group_id)} is not in the address book as it is now. Scan again.`, "contacts_plan_stale");
      const keep = want.keep === undefined ? group.keep : String(want.keep);
      if (!group.members.some((member) => member.url === keep)) throw new ValidationError(`Group ${group.group_id}: keep must be the url of one of its contacts`);
      if (group.class === "possible" && want.same_person !== true) {
        throw new ValidationError(
          `Group ${group.group_id}: its contacts share only a name. Show them to the practitioner and pass same_person: true ` +
          `only if they say the contacts are the same person.`
        );
      }
      const choices = (want.choices ?? {}) as Record<string, string>;
      const open = mergeGroup(group.members, keep, {}, rev).conflicts;
      for (const [word, url] of Object.entries(choices)) {
        if (!open.includes(word)) throw new ValidationError(`Group ${group.group_id}: its contacts do not differ on ${word}; choices may name only ${open.join(", ") || "nothing"}`);
        if (!group.members.some((member) => member.url === url)) throw new ValidationError(`Group ${group.group_id}: the choice for ${word} must be the url of one of its contacts`);
      }
      const merged = mergeGroup(group.members, keep, choices, rev);
      if (merged.conflicts.length) {
        throw new ValidationError(
          `Group ${group.group_id}: the contacts differ on ${merged.conflicts.join(", ")}. Ask the practitioner which contact's ` +
          `value stays, then pass choices, for example {"${merged.conflicts[0]}": "<that contact's url>"}.`
        );
      }
      const saved = ({ url, etag, text, contact }: Group["members"][number]): Saved => ({ url, etag, text, name: contact.name });
      const kept = group.members.find((member) => member.url === keep) as Group["members"][number];
      return { group_id: group.group_id, name: kept.contact.name, keep: saved(kept), others: group.members.filter((member) => member !== kept).map(saved), merged_text: merged.text };
    }),
  };
  savePlan(plan);
  return {
    plan_id: plan.plan_id,
    group_count: plan.groups.length,
    remove_count: plan.groups.reduce((sum, group) => sum + group.others.length, 0),
    groups: plan.groups.slice(0, SHOWN).map((group) => ({ group_id: group.group_id, keep: group.keep.name, remove: group.others.map((other) => other.name) })),
  };
}

const codeOf = (error: unknown): string | undefined => (error instanceof DataServerError ? error.code : undefined);

/** The card at `url` now, or undefined when it is gone. */
async function current(context: DavContext, credential: MailCredential, url: string): Promise<{ text: string; etag: string | null } | undefined> {
  try {
    return await getObject(context, credential, "carddav", url);
  } catch (error) {
    if (!/^Nothing found/.test((error as Error).message)) throw error;
    return undefined;
  }
}

const backupFolder = (plan: MergePlan): string => stateFolder("backups", `${plan.created_at.slice(0, 10)}_${plan.plan_id}`);
const fileOf = (url: string): string => decodeURIComponent(url.split("/").pop() ?? "").replace(/[^\w.-]/g, "_");
const runsFile = (): string => join(stateFolder("backups"), "runs.jsonl");
const uidOf = (text: string): string => parseContact(text).uid ?? "";
const MEMBER = "X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:";

async function mergeOne(context: DavContext, credential: MailCredential, plan: MergePlan, group: MergePlan["groups"][number], groupCards: string[]): Promise<void> {
  const changed = "changed since the scan, so the group was left as it is";
  const stop = (why: string) => {
    group.state = "stopped";
    group.why = why;
  };
  // 1. The backup, before any request that changes anything.
  const folder = backupFolder(plan);
  for (const card of [group.keep, ...group.others]) writeFileSync(join(folder, fileOf(card.url)), card.text, "utf-8");

  // 2. The kept card. A run that stopped after writing it finds it already merged.
  const kept = await current(context, credential, group.keep.url);
  if (!kept) return stop("the contact to keep is no longer in the address book");
  if (lostProperties(group.merged_text, kept.text).length > 0) {
    if (!sameEtag(kept.etag, group.keep.etag)) return stop(changed);
    try {
      await replaceCard(context, credential, plan.book_url, group.keep.url, kept.etag, group.merged_text);
    } catch (error) {
      if (codeOf(error) !== "dav_stale") throw error;
      return stop(changed);
    }
    const lost = lostProperties(group.merged_text, (await getObject(context, credential, "carddav", group.keep.url)).text);
    if (lost.length) return stop(`merged, but the address book holds the result differently (${lost.join(", ")}), so nothing was removed`);
  }

  // 3. Contact groups the others were in gain the kept card. A card with no identifier is in no group.
  const keepUid = uidOf(group.keep.text);
  const otherUids = group.others.map((other) => uidOf(other.text)).filter((uid) => uid !== "");
  for (const url of keepUid && otherUids.length ? groupCards : []) {
    const card = await current(context, credential, url);
    if (!card || card.text.includes(MEMBER + keepUid) || !otherUids.some((uid) => card.text.includes(MEMBER + uid))) continue;
    try {
      await replaceCard(context, credential, plan.book_url, url, card.etag, addLines(card.text, [MEMBER + keepUid], revNow()));
    } catch (error) {
      if (codeOf(error) !== "dav_stale") throw error;
      return stop("a contact group changed during the merge, so nothing was removed");
    }
  }

  // 4. The others come out, each only if it is still the card that was backed up.
  for (const other of group.others) {
    const now = await current(context, credential, other.url);
    if (!now) continue;
    if (!sameEtag(now.etag, other.etag)) return stop(`${other.name} ${changed.replace("the group", "it")}; the merged contact holds its earlier details`);
    try {
      await removeCard(context, credential, plan.book_url, other.url, now.etag);
    } catch (error) {
      if (codeOf(error) !== "dav_stale") throw error;
      return stop(`${other.name} ${changed.replace("the group", "it")}; the merged contact holds its earlier details`);
    }
    if (await current(context, credential, other.url)) return stop(`${other.name} is still in the address book after it was removed`);
  }
  appendFileSync(runsFile(), JSON.stringify({
    at: new Date().toISOString(), plan_id: plan.plan_id, group_id: group.group_id,
    kept: { name: group.keep.name, url: group.keep.url },
    removed: group.others.map((other) => ({ name: other.name, path: join(folder, fileOf(other.url)) })),
  }) + "\n", "utf-8");
  group.state = "done";
}

async function mergeApply(context: DavContext, args: Args, starting: boolean): Promise<unknown> {
  const credential = requireDav(context.mail, "carddav");
  const plan = loadPlan<MergePlan>(args.plan_id, "merge");
  const removeCount = plan.groups.reduce((sum, group) => sum + group.others.length, 0);
  if (starting && (args.group_count !== plan.groups.length || args.remove_count !== removeCount)) {
    throw new ValidationError(`group_count and remove_count must be the plan's: ${plan.groups.length} and ${removeCount}`);
  }
  const { bookUrl, cards } = await readBook(context, credential);
  requireRunnable(plan, starting, bookUrl, "contacts__merge_apply_continue");
  const groupCards = cards.filter((card) => parseContact(card.text).isGroup).map((card) => card.url);
  plan.status = "writing";
  savePlan(plan);
  const until = deadline(context);
  const pending = () => plan.groups.filter((group) => group.state === undefined);
  for (const group of pending()) {
    await mergeOne(context, credential, plan, group, groupCards);
    savePlan(plan);
    if (Date.now() >= until) break;
  }
  if (pending().length === 0) plan.status = "done";
  savePlan(plan);
  const done = plan.groups.filter((group) => group.state === "done");
  const stopped = plan.groups.filter((group) => group.state === "stopped");
  return {
    status: plan.status,
    merged: done.length,
    removed: done.reduce((sum, group) => sum + group.others.length, 0),
    remaining: pending().length,
    stopped: stopped.slice(0, SHOWN).map((group) => ({ name: group.name, why: group.why })),
    stopped_count: stopped.length,
    backup_dir: backupFolder(plan),
  };
}

/** Puts a card a merge removed back, from its backup file, at a new address. */
async function restoreCard(context: DavContext, args: Args): Promise<unknown> {
  const credential = requireDav(context.mail, "carddav");
  if (typeof args.name !== "string" || !args.name) throw new ValidationError("contacts__restore_card requires name");
  const wanted = normalizeName(args.name);
  let path = typeof args.path === "string" && args.path ? args.path : undefined;
  if (!path) {
    const removed = (existsSync(runsFile()) ? readFileSync(runsFile(), "utf-8").split("\n").filter(Boolean) : [])
      .map((line) => JSON.parse(line) as { at: string; removed: Array<{ name: string; path: string }> })
      .flatMap((run) => run.removed.map((entry) => ({ ...entry, at: run.at })))
      .filter((entry) => normalizeName(entry.name) === wanted);
    if (removed.length !== 1) {
      throw new DataServerError(
        removed.length ? `More than one removed contact has that name. Pass path, one of: ${removed.map((entry) => `${entry.path} (removed ${entry.at})`).join("; ")}`
          : "No removed contact of that name is on record on this computer.",
        "contacts_backup_not_found"
      );
    }
    path = removed[0].path;
  }
  const root = resolve(stateFolder("backups")) + sep;
  if (!resolve(path).startsWith(root) || !existsSync(path)) throw new ValidationError("path must be a backup file this tool family saved");
  const text = readFileSync(path, "utf-8");
  const contact = parseContact(text);
  if (normalizeName(contact.name) !== wanted) throw new ValidationError("name is not the name of the contact in that backup");
  const { bookUrl, cards } = await readBook(context, credential);
  if (contact.uid && cards.some((card) => parseContact(card.text).uid === contact.uid)) {
    throw new DataServerError("That contact is already in the address book.", "contacts_already_present");
  }
  const { url } = await createCard(context, credential, bookUrl, `${randomUUID()}.vcf`, text);
  const lost = lostProperties(text, (await getObject(context, credential, "carddav", url)).text);
  return { url, name: contact.name, altered: lost };
}
