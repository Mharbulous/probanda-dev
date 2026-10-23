// write_email's recipients read from case data (spec 2026-10-23, write_email addresses the email
// itself): counsel of record on a proceeding's service list, or a saved Writing's own recipients, so
// no address passes through the model. Counsel are read as the general renderer reads them
// (draftingParties, fetchFilingRecipients) and merged as it merges them (mergeSharedRecipients).
//
// Case data holds each lawyer's email as one text value with no role per address, and no convention
// says which address is whose. So the first address of a `to` recipient goes in To and every other
// address held with it (a paralegal's, an assistant's) in Cc; a `cc` recipient's all go in Cc. No
// address is ever guessed: a recipient with none is reported in not_addressed and never written.

import { dirname } from "node:path";

import { DataServerError } from "../errors.js";
import { readFirmProfile } from "../tools/practice/firm-profile.js";
import { draftingParties } from "./parties-drift.js";
import {
  fetchAllProceedings,
  fetchFiling,
  fetchFilingRecipients,
  fetchParties,
  fetchProceeding,
  fetchSentParties,
  fetchServiceListCounsel,
  mergeSharedRecipients,
  type FilingRecipientRow,
} from "./forms/query.js";

export interface NotAddressed {
  name: string | null;
  capacity: string | null;
  reason: string;
}

export interface EmailRecipients {
  to: string[];
  cc: string[];
  /** Each recipient no address was written for, and why: tell the practitioner. */
  not_addressed: NotAddressed[];
  note?: string;
}

/** "Name <a@b>", the name quoted so a comma in it cannot split the address. */
function named(name: string | null, address: string): string {
  return name ? `"${name.replace(/["\\]/g, "\\$&")}" <${address}>` : address;
}

/** A stored email value's addresses, split on ";" and ",". */
function addressesOf(email: string | null): string[] {
  return (email ?? "")
    .split(/[;,]/)
    .map((a) => a.trim())
    .filter((a) => a !== "");
}

/** Builds the To and Cc lists, each address once (ignoring case), To first. */
class Lists {
  readonly to: string[] = [];
  readonly cc: string[] = [];
  readonly not_addressed: NotAddressed[] = [];
  private readonly seen = new Set<string>();

  add(list: "to" | "cc", name: string | null, address: string): void {
    const key = address.toLowerCase();
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this[list].push(named(name, address));
  }

  recipient(r: Pick<FilingRecipientRow, "name" | "capacity" | "email" | "role" | "unrecorded">, why?: string): void {
    const addresses = addressesOf(r.email);
    if (addresses.length === 0) {
      const reason = r.unrecorded ? "no name or address was recorded for it when the Writing was sent" : (why ?? "case data holds no email for it");
      this.not_addressed.push({ name: r.name, capacity: r.capacity, reason });
      return;
    }
    const [first, ...rest] = addresses;
    this.add(r.role === "to" ? "to" : "cc", r.name, first);
    for (const address of rest) this.add("cc", null, address);
  }

  result(note?: string): EmailRecipients {
    return { to: this.to, cc: this.cc, not_addressed: this.not_addressed, ...(note ? { note } : {}) };
  }
}

export type RecipientSource = { filing_id: number } | { proceeding_id?: number };

/**
 * The To and Cc lists for an email addressed from case data, with the firm's cc_on_counsel_email
 * people (firm.json roster keys, the sender left out) added to Cc. `{ proceeding_id }` is counsel of
 * record on that proceeding's service list, or, with none named, on every proceeding's, merged, with
 * a note saying so; `{ filing_id }` is that saved Writing's own `to` and `cc` recipients, and one
 * with a `bcc` recipient is refused, because write_email writes no Bcc. Counsel are read live from
 * the case data in the folder holding the database, or from a sent Writing's snapshot.
 */
export function emailRecipients(dbPath: string, source: RecipientSource, senderKey: string, env: NodeJS.ProcessEnv): EmailRecipients {
  const lists = new Lists();
  let note: string | undefined;
  if ("filing_id" in source) {
    const filing = fetchFiling(dbPath, source.filing_id);
    const parties = filing.filed_on
      ? fetchSentParties(dbPath, filing)
      : draftingParties(dirname(dbPath), fetchProceeding(dbPath, filing.proceeding_id), fetchParties(dbPath, filing.proceeding_id), env).parties;
    const recipients = mergeSharedRecipients(fetchFilingRecipients(dbPath, filing, parties));
    if (recipients.some((r) => r.role === "bcc")) {
      throw new DataServerError(
        `"${filing.title}" has a blind copy recipient, and this step writes no Bcc. Move that recipient to cc, or address the email with to and cc. Nothing was written.`,
        "bcc_unsupported"
      );
    }
    for (const r of recipients) lists.recipient(r);
  } else {
    const proceedings = source.proceeding_id === undefined ? fetchAllProceedings(dbPath) : [fetchProceeding(dbPath, source.proceeding_id)];
    const rows: FilingRecipientRow[] = [];
    const drifted = new Map<number, string>();
    for (const proceeding of proceedings) {
      const { parties, drift } = draftingParties(dirname(dbPath), proceeding, fetchParties(dbPath, proceeding.id), env);
      const counsel = fetchServiceListCounsel(dbPath, proceeding.id, parties);
      for (const d of drift.rows) {
        const why =
          d.kind === "unlinked"
            ? `${d.name} is not linked to a party in case data, so its counsel cannot be read`
            : d.kind === "not_of_record"
              ? `${d.name} is linked to a party case data does not hold for this proceeding`
              : `counsel were not read from case data: ${d.reason}`;
        for (const r of counsel) if (r.party_id === d.party_id) drifted.set(r.id, why);
      }
      rows.push(...counsel);
    }
    for (const r of mergeSharedRecipients(rows)) lists.recipient(r, drifted.get(r.id));
    if (source.proceeding_id === undefined && proceedings.length > 1) {
      note = `No proceeding was named, so this addresses counsel on the service lists of all ${proceedings.length} proceedings, each once.`;
    }
  }

  const profile = readFirmProfile(env);
  for (const key of profile.cc_on_counsel_email ?? []) {
    if (key === senderKey) continue;
    const entry = profile.roster.find((e) => e.key === key);
    const name = typeof entry?.name === "string" ? entry.name : key;
    if (entry === undefined || entry.active === false) {
      lists.not_addressed.push({ name, capacity: "firm copy", reason: "not an active person on the firm roster" });
    } else if (typeof entry.email !== "string" || entry.email.trim() === "") {
      lists.not_addressed.push({ name, capacity: "firm copy", reason: "the firm roster holds no email for them" });
    } else {
      lists.add("cc", name, entry.email.trim());
    }
  }
  return lists.result(note);
}
