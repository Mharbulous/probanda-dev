// drafting_forms__form_currency (ADR 0038): whether an enactment change on record amends a BC
// Supreme Court form whose shipped template, emitter and type file are not recorded as conformed
// to it. Two records, both shipped with the plugin and read here, host-side, so no skill reads
// another skill's file:
//
//   the change   docket-clerk's shared/docket-clerk/references/rule-freshness.json, each pending_changes[] entry's `forms`,
//                the official form numbers the amending instrument repeals, substitutes or adds;
//   conformance  the form's /publish identity files, each one's `conformed_to:` list of amending regs.
//
// Facts only. The warning names the change and its commencement date, which is not a deadline,
// and never says whether the change affects a filing: that is /legal-research's. Read-only.

import { DataServerError } from "../errors.js";
import { skillSourceRead } from "../files/skill-source.js";
import type { KnowledgeSeams } from "../knowledge/tree.js";
import { readFrontMatter, type FrontMatter } from "../sources/check.js";

/** The Writing kinds whose venue document is a BC Supreme Court form, by that form's key. */
export const KIND_FORM_KEYS: Readonly<Partial<Record<string, string>>> = { notice_of_application: "form-32", application_response: "form-33" };

/** The repo-session checklist that conforms a form, as a skill-source path. */
const UPDATE_DOC = "publish/subskills/publish-bcsc-form/references/form-update.md";

/** publish/SKILL.md "Form identity": Forms 32 and 33 are named for their Writing, Form 17 for each requisition
 * that fills it, every other form for its key. A form with several identity files is conformed to a reg only
 * when every one of them lists it. */
const STEMS: Readonly<Partial<Record<string, string[]>>> = {
  "form-17": ["requisition-consent", "requisition-default-judgment"],
  "form-32": ["notice-of-application"],
  "form-33": ["application-response"],
};

export interface UnconformedChange {
  amending_reg: string;
  amending_oic: string | null;
  commencement_date: string;
  enactment: string;
}

export interface FormCurrency {
  form_key: string;
  /** The identity file's form number; with no identity file, the number in a `form-<n>` key. */
  form_number: string | null;
  today: string;
  /** The identity files' knowledge paths, comma-joined, or null when none ships for this form. */
  identity_file: string | null;
  conformed_to: string[];
  /** Each change in force by `today` that names this form and is not in `conformed_to`. */
  unconformed: UnconformedChange[];
  /** One sentence naming each unconformed change, or that no identity file ships; null when neither. */
  warning: string | null;
  update_doc: typeof UPDATE_DOC;
}

interface PendingChange {
  amending_reg?: string;
  amending_oic?: string;
  commencement_date?: string;
  forms?: string[];
}

/** `today` is the caller's local date, YYYY-MM-DD. `seams` is the test hook pointing at a scratch skills tree. */
export function formCurrency(formKey: string, today: string, seams: KnowledgeSeams = {}): FormCurrency {
  const read = (path: string) => skillSourceRead(path, seams.env, undefined, undefined, seams.installRoot).content;
  const record = JSON.parse(read("shared/docket-clerk/references/rule-freshness.json")) as {
    enactments: { name: string; pending_changes?: PendingChange[] }[];
  };

  // The identity file /publish reads with knowledge__read, read here as shipped: conformance is
  // recorded in a repo session, never in the firm's overlay.
  const identityFiles: string[] = [];
  const lists: string[][] = [];
  let front: FrontMatter | null = null;
  for (const stem of STEMS[formKey] ?? [formKey]) {
    const identityFile = `publish/CAN/BC/BCSC/Documents/${stem}.md`;
    let file: FrontMatter;
    try {
      file = readFrontMatter(read(`publish/references/CAN/BC/BCSC/Documents/${stem}.md`), identityFile) ?? {};
    } catch (err) {
      if (!(err instanceof DataServerError && err.code === "not_found")) throw err;
      lists.push([]);
      continue;
    }
    identityFiles.push(identityFile);
    front ??= file;
    // A bare `conformed_to:` reads as null, a filled one as a block list.
    const listed = file.conformed_to;
    lists.push(Array.isArray(listed) ? listed.filter((reg): reg is string => typeof reg === "string") : []);
  }
  let formNumber: string | null;
  if (front === null) formNumber = /^form-(\d+(?:\.\d+)?)$/.exec(formKey)?.[1] ?? null;
  else formNumber = typeof front.form_number === "string" ? front.form_number : null;
  const conformedTo = lists[0].filter((reg) => lists.every((list) => list.includes(reg)));

  const unconformed: UnconformedChange[] = [];
  for (const enactment of record.enactments) {
    for (const change of enactment.pending_changes ?? []) {
      if (formNumber === null || !change.forms?.includes(formNumber)) continue;
      if (!change.amending_reg || !change.commencement_date || change.commencement_date > today) continue;
      if (conformedTo.includes(change.amending_reg)) continue;
      unconformed.push({
        amending_reg: change.amending_reg,
        amending_oic: change.amending_oic ?? null,
        commencement_date: change.commencement_date,
        enactment: enactment.name,
      });
    }
  }

  const label = formNumber === null ? formKey : `Form ${formNumber}`;
  let warning: string | null = null;
  if (unconformed.length > 0) {
    const clauses = unconformed.map(
      (c) =>
        `${c.amending_reg}${c.amending_oic ? ` (${c.amending_oic})` : ""}, in force ${c.commencement_date}, is recorded as amending this form, ` +
        `and the shipped ${label} template, emitter and type file are not recorded as conformed to it`
    );
    warning = `${label}: ${clauses.join("; ")}.`;
  } else if (front === null) {
    warning = `${label}: no identity file ships for this form, so its conformance to the enactment changes on record cannot be read.`;
  }

  return {
    form_key: formKey,
    form_number: formNumber,
    today,
    identity_file: front === null ? null : identityFiles.join(", "),
    conformed_to: conformedTo,
    unconformed,
    warning,
    update_doc: UPDATE_DOC,
  };
}
