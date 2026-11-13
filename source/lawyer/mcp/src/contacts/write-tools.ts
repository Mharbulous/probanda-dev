// The contacts__* tools that change the address book. Each one that writes is held by the
// approval hook (source/lawyer/hooks/one-way-gate.py) until the practitioner approves it.

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { DataServerError } from "../errors.js";
import { getObject, requireDav, type DavContext } from "../dav/session.js";
import type { MailCredential } from "../mail/config.js";
import type { Tool } from "../tool-list.js";
import { readBook } from "./book.js";
import { createCard, removeCard, replaceCard } from "./card-write.js";
import { contactsImportTools } from "./import-tools.js";
import { contactsMergeTools } from "./merge-tools.js";
import { revNow, stateFolder } from "./plans.js";
import { addLines, lostProperties, newCard } from "./vcard-edit.js";

export const contactsWriteTools: Tool<DavContext>[] = [
  { name: "contacts__write_probe", handler: (_args, context) => writeProbe(context) },
  ...contactsImportTools,
  ...contactsMergeTools,
];

const PROBE_NAME = "ZZ Probanda test - safe to remove";

/** Whether a card is still at `url`. */
async function exists(context: DavContext, credential: MailCredential, url: string): Promise<boolean> {
  try {
    await getObject(context, credential, "carddav", url);
    return true;
  } catch (error) {
    if (error instanceof DataServerError && /^Nothing found/.test(error.message)) return false;
    throw error;
  }
}

/**
 * Finds out whether this account lets Probanda change the address book, and what the server
 * rewrites, on one test card: create it, read it back, add a phone, save a copy, remove it.
 */
async function writeProbe(context: DavContext): Promise<unknown> {
  const credential = requireDav(context.mail, "carddav");
  const { bookUrl } = await readBook(context, credential);
  const uid = randomUUID();
  const row = {
    row: 0, kind: "company" as const, name: PROBE_NAME, firstName: "", middleName: "", lastName: "", nickname: "",
    organization: PROBE_NAME, jobTitle: "", emails: [], phones: [{ label: "main", value: "604-555-0100" }], addresses: [],
    url: "", birthday: "", notes: "",
  };
  const sent = addLines(newCard(row, uid, revNow()), ["item1.TEL;type=pref:604-555-0101", "item1.X-ABLabel:Probe label", "X-PROBANDA-PROBE:kept"], revNow());
  const { url } = await createCard(context, credential, bookUrl, `${uid}.vcf`, sent);
  try {
    const created = await getObject(context, credential, "carddav", url);
    const edited = addLines(created.text, ["TEL;type=WORK;type=VOICE:604-555-0102"], revNow());
    await replaceCard(context, credential, bookUrl, url, created.etag, edited);
    const changed = await getObject(context, credential, "carddav", url);
    const backupPath = join(stateFolder("backups", "probe"), `${uid}.vcf`);
    writeFileSync(backupPath, changed.text, "utf-8");
    await removeCard(context, credential, bookUrl, url, changed.etag);
    return {
      can_write: true,
      altered_on_create: lostProperties(sent, created.text),
      altered_on_update: lostProperties(edited, changed.text),
      removed: !(await exists(context, credential, url)),
      backup_path: backupPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DataServerError(
      `The test stopped part-way: ${message} A test contact named "${PROBE_NAME}" may remain in the address book; it holds nothing real.`,
      error instanceof DataServerError ? error.code : "dav_error"
    );
  }
}
