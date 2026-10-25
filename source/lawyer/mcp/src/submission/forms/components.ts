// Shared component engines for the submission form renderers (build ticket
// #297, issue #299's ratified six-engine list). Pure string builders -- no
// DB access here; callers pass already-fetched rows.

/** A blank to fill: a header value not known yet. */
export const BLANK_UNDERLINE = "________";

export interface FrontmatterFields {
  matterNo: string;
  matterDescription: string;
  clientName: string;
  clientNo: string;
  /** The type file's title for a general Writing; a bespoke renderer's own document label. */
  documentType: string;
  /** The Writing's title (filings.title). */
  documentName: string;
  /** The Writing's date as written, else BLANK_UNDERLINE. */
  documentDate: string;
  venue: string;
  proceedingFileNo: string;
  revision: number;
  rendered: string; // "YYYY-MM-DD HH:mm"
  /** Optional fields after `Rendered`, each a YAML list printed only when it has items. */
  lists?: { label: string; items: string[] }[];
}

/** Component 1: the YAML frontmatter header, practitioner-facing, every document. The "Document …"
 * labels name the Writing being drafted (GLOSSARY.md, Document). The `Revision:` line is parsed by
 * forms.ts readExistingRevision. */
export function frontmatterHeader(f: FrontmatterFields): string {
  const lists = (f.lists ?? []).filter((l) => l.items.length > 0).flatMap((l) => [`${l.label}:`, ...l.items.map((item) => `  - ${item}`)]);
  return [
    "---",
    `Matter no: ${f.matterNo}`,
    `Matter Description: ${f.matterDescription}`,
    `Client Name: ${f.clientName}`,
    `Client no: ${f.clientNo}`,
    `Document Type: ${f.documentType}`,
    `Document Name: ${f.documentName}`,
    `Document Date: ${f.documentDate}`,
    `Venue: ${f.venue}`,
    `Proceeding File no: ${f.proceedingFileNo}`,
    `Revision: ${f.revision}`,
    `Rendered: ${f.rendered}`,
    ...lists,
    "---",
  ].join("\n");
}

export interface CaptionParty {
  name: string;
  role: string;
  ordinal: number;
}

/** The venue.md heading fields a caption prints (shared/declared-layout.md section 8). */
export interface CaptionHeading {
  /** The court-name line or lines, each a bold row. */
  caption_lines: string | string[];
  file_number_label: string;
  /** Null where the venue has no registry: then no registry row prints, and the file-number row prints only when a file number is stored. */
  registry_label: string | null;
}

export interface CaptionOptions {
  heading: CaptionHeading;
  registry?: string | null;
  fileNumber?: string | null;
  /** Bold title line rendered as the caption's last row, e.g. "NOTICE OF APPLICATION"; absent, no title row prints. */
  titleLine?: string;
  /** BCSC consent order's fuller caption includes a counterclaim party group the requisition caption omits (issue #293 §2) -- callers filter `parties` before calling, this flag only controls whether the registry/file-number rows render. */
}

/** Pluralizes a forum role for display when more than one party shares it (e.g. BCCA's
 * "Respondents"). Exported (build ticket following #436) so the BCCA response renderer's
 * boilerplate lines can share this instead of the hardcoded "(s)" hedge every other renderer
 * inherited before it. */
export function pluralizeRole(role: string, count: number): string {
  if (count <= 1) return role;
  return role.endsWith("s") ? role : `${role}s`;
}

/** Exported alongside pluralizeRole for the same reason -- the caption already groups parties
 * by role correctly; the fix is reuse, not a second implementation. */
export function groupPartiesByRole(parties: CaptionParty[]): { role: string; names: string[] }[] {
  const sorted = [...parties].sort((a, b) => a.ordinal - b.ordinal);
  const groups: { role: string; names: string[] }[] = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.role === p.role) {
      last.names.push(p.name);
    } else {
      groups.push({ role: p.role, names: [p.name] });
    }
  }
  return groups;
}

/** "A" / "A and B" / "A, B, and C" -- the multi-party name join every boilerplate line needs
 * (BCCA response boilerplate, cover-page party blocks). Oxford comma on 3+, matching the
 * house style already used elsewhere in this plugin's drafted prose. */
export function formatNameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Component 2: style of proceeding -- the caption block, three-column table, role-grouped party listing. */
export function styleOfProceedingCaption(parties: CaptionParty[], opts: CaptionOptions): string {
  const lines: string[] = [];
  lines.push("| | | |");
  lines.push("| :--- | :---: | ---: |");
  const { heading } = opts;
  if (heading.registry_label !== null) lines.push(`| | | ${opts.registry ?? ""} ${heading.registry_label} |`);
  if (heading.registry_label !== null || opts.fileNumber) lines.push(`| | | ${heading.file_number_label} ${opts.fileNumber ?? ""} |`);
  for (const line of [heading.caption_lines].flat()) lines.push(`| | **${line}** | |`);
  const groups = groupPartiesByRole(parties);
  groups.forEach((group, i) => {
    lines.push(`| ${i === 0 ? "BETWEEN:" : "AND:"} | | |`);
    lines.push(`| | ${group.names.map((n) => n.toUpperCase()).join(" and ")} | |`);
    lines.push(`| | | *${pluralizeRole(group.role, group.names.length)}* |`);
  });
  if (opts.titleLine !== undefined) lines.push(`| | **${opts.titleLine}** | |`);
  return lines.join("\n");
}

/** Component 3: signature block. officerSigned=true renders the capacity-checkbox tail (Form 32 style); false renders a bare lawyer signature line (requisition style). */
export function signatureBlock(party: { name: string; role: string; counselName: string | null }, officerSigned: boolean): string {
  const lines: string[] = [];
  lines.push(`Date: ________________`);
  if (party.counselName) {
    lines.push(`Signature of ${party.counselName}, lawyer for the ${party.role}, ${party.name}`);
  } else {
    lines.push(`Signature of ${party.name}, ${party.role} (self-represented)`);
  }
  if (officerSigned) {
    lines.push("");
    lines.push("[ ] Party  [ ] Lawyer for party  [ ] Legal representative for party");
  }
  return lines.join("\n");
}

/** Component 4: address for service, always paired with the signature block. */
export function addressForServiceBlock(party: { addressForService: string | null }): string {
  return `Address for service: ${party.addressForService ?? "________________"}`;
}

export interface RequisitionWrapperFields {
  captionMarkdown: string;
  titleLine: string; // "REQUISITION - GENERAL" | "REQUISITION FOR CONSENT ORDER"
  filedBy: string; // "{role}, {client name}"
  required: string;
  checklistLeadIn?: string; // own paragraph between Required: and the list -- default judgment's "This requisition is supported by the following:"; consent's list is statements, not enclosures, so it has none
  checklist: string[]; // rendered as a numbered list, glyph already appended per item where applicable
}

/** Component 5: requisition wrapper (Filed by: / Required: / numbered checklist), used by both requisition subkinds. */
export function requisitionWrapper(f: RequisitionWrapperFields): string {
  const lines: string[] = [];
  lines.push(f.captionMarkdown);
  lines.push("");
  lines.push(`**Filed by:** ${f.filedBy}`);
  lines.push("");
  lines.push(`**Required:** ${f.required}`);
  lines.push("");
  if (f.checklistLeadIn) {
    lines.push(f.checklistLeadIn);
    lines.push("");
  }
  f.checklist.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
  return lines.join("\n");
}

/** The two lines that close every Form 32 Part 4 and Form 33 Part 6 material list, word for word.
 * Template text, never a document row: they carry no marker, no trace and no criterion glyph. */
export const STANDARD_MATERIAL_LINES = ["Pleadings filed in this proceeding", "Such further affidavits or filed court documents as this honourable court may allow"] as const;

export interface CheckboxOrderBlockRow {
  text: string;
  marker?: string; // work-marker glyph, appended after the row text
}

/** Component 6a: checkbox court-order block (Form 32 Part 5 style -- "in the terms requested / with variations"). */
export function checkboxOrderBlock(rows: CheckboxOrderBlockRow[]): string {
  const lines: string[] = [];
  lines.push("[ ] The order(s) set out in Part 1 of this notice were made in the terms requested in Part 1 of this notice.");
  lines.push("[ ] The order(s) set out in Part 1 of this notice were made with the following variations and additional terms:");
  lines.push("");
  rows.forEach((r) => lines.push(`- ${r.text}${r.marker ? ` ${r.marker}` : ""}`));
  return lines.join("\n");
}

/** Component 6b: narrative court-order block (default judgment / consent order style -- ends in a bare registrar signature). */
export function narrativeOrderBlock(paragraphs: string[]): string {
  return paragraphs.join("\n\n");
}

/** One party's counsel-contact column on a BCCA cover page's two-column table (e-CI §1.3
 * Cover Page row / tpl_ca_book_cover_page.dotx field 10): party name(s), counsel, firm,
 * address, phone, email, "Counsel for the {role}". A gap marker (caller-supplied, so this
 * module stays free of markers.ts) fills any missing field rather than a guessed blank. */
export interface BccaCoverPageContact {
  role: string;
  names: string[];
  /** The parties row the counsel fields belong to, which keys each blank cell's open item (#1226). */
  partyId: number;
  counselName: string | null;
  counselFirm: string | null;
  addressForService: string | null;
  counselPhone: string | null;
  counselEmail: string | null;
}

export interface BccaCoverPageFields {
  /** The venue's heading fields; the cover prints its registry and file-number labels. */
  heading: CaptionHeading;
  registry?: string | null;
  fileNumber?: string | null;
  /** Top-right short label (tpl's third top-right row), e.g. "Response Book" / "Memorandum of Argument". */
  recordLabel: string;
  /** Bold centered title row, e.g. "RESPONSE BOOK" / "WRITTEN ARGUMENT OF THE RESPONDENTS ON A STAY APPLICATION". */
  titleLine: string;
  /** Centered "name of filing party" line beneath titleLine (both templates carry this field; omit for a joint book). */
  filingPartyPhrase?: string | null;
  /** "ON APPEAL FROM the order of [judge] of the [court] pronounced on [date]" -- outer cover only, omitted (not blanked) when any part is unknown rather than rendering a partial sentence. */
  onAppealFrom?: { judge: string | null; court: string | null; pronounced: string | null } | null;
  /** Verbatim sealing-order/publication-ban/anonymity-order line(s) -- outer cover only, omitted entirely when none apply (template's own "remove placeholder if none" instruction). */
  accessRestrictions?: string | null;
  /** Lower-court role shown under each party group, e.g. "(Plaintiffs)" -- keyed by role so every party in a group shares it; omit a role to render nothing for that group. */
  lowerCourtRoleByRole?: Record<string, string>;
  contacts: BccaCoverPageContact[];
  gapMarker: string;
}

export interface LowerCourtRolePartyInput {
  role: string;
  lower_court_role: string | null;
}

/** Builds bccaCoverPage's lowerCourtRoleByRole map from parties.lower_court_role (schema
 * v14, one value per party) -- grouped by appeal role the same way groupPartiesByRole
 * groups names. A role's bracketed lower-court-role line renders only when every party
 * sharing that appeal role agrees on the same non-null value; a group that disagrees, or
 * has no value recorded at all, is omitted entirely (never guessed, never concatenated). */
export function buildLowerCourtRoleByRole(parties: LowerCourtRolePartyInput[]): Record<string, string> {
  const valuesByRole = new Map<string, (string | null)[]>();
  for (const p of parties) {
    const list = valuesByRole.get(p.role) ?? [];
    list.push(p.lower_court_role);
    valuesByRole.set(p.role, list);
  }
  const result: Record<string, string> = {};
  for (const [role, values] of valuesByRole) {
    const first = values[0];
    if (first !== null && values.every((v) => v === first)) result[role] = first;
  }
  return result;
}

/** The counsel rows of a cover page's contact table, in print order: the counsel-of-record field each
 * reads and the name of what a blank one is missing. */
const CONTACT_COLUMNS = [
  { column: "counsel_firm", missing: "firm" },
  { column: "counsel_name", missing: "counsel" },
  { column: "address_for_service", missing: "address for service" },
  { column: "counsel_phone", missing: "telephone" },
  { column: "counsel_email", missing: "email" },
] as const;

/** One contact's counsel cells exactly as bccaCoverPage prints them, so a caller records each 🧩
 * cell from the printed string (#1226). */
export function contactCells(c: BccaCoverPageContact, gapMarker: string): { column: string; missing: string; text: string }[] {
  const texts = [c.counselFirm ?? gapMarker, `Attn: ${c.counselName ?? gapMarker}`, c.addressForService ?? gapMarker, `Tel: ${c.counselPhone ?? gapMarker}`, c.counselEmail ?? gapMarker];
  return CONTACT_COLUMNS.map((col, i) => ({ ...col, text: texts[i] }));
}

/** Component 7: BCCA cover page (e-CI §1.2/§2.1 "Cover Page -- Required", both the book's
 * outer cover and the written argument's own cover -- one builder, two call sites, per
 * tpl_ca_book_cover_page.dotx and tpl_written_argument_general.dotx sharing the same field
 * shape apart from onAppealFrom/accessRestrictions (outer cover only). */
export function bccaCoverPage(parties: CaptionParty[], fields: BccaCoverPageFields): string {
  const lines: string[] = [];
  lines.push("| | | |");
  lines.push("| :--- | :---: | ---: |");
  if (fields.heading.registry_label !== null) {
    lines.push(`| | | ${fields.registry ?? ""} ${fields.heading.registry_label} |`);
    lines.push(`| | | ${fields.heading.file_number_label} ${fields.fileNumber ?? ""} |`);
  }
  lines.push(`| | | ${fields.recordLabel} |`);
  lines.push("| | **COURT OF APPEAL** | |");
  if (fields.onAppealFrom && fields.onAppealFrom.judge && fields.onAppealFrom.court && fields.onAppealFrom.pronounced) {
    lines.push(
      `| | ON APPEAL FROM the order of ${fields.onAppealFrom.judge} of the ${fields.onAppealFrom.court} pronounced on ${fields.onAppealFrom.pronounced} | |`
    );
  }
  const groups = groupPartiesByRole(parties);
  groups.forEach((group, i) => {
    lines.push(`| ${i === 0 ? "BETWEEN:" : "AND:"} | | |`);
    lines.push(`| | ${group.names.map((n) => n.toUpperCase()).join(" and ")} | |`);
    lines.push(`| | | *${pluralizeRole(group.role, group.names.length)}* |`);
    const lowerCourtRole = fields.lowerCourtRoleByRole?.[group.role];
    if (lowerCourtRole) lines.push(`| | | *${lowerCourtRole}* |`);
  });
  if (fields.accessRestrictions) {
    for (const line of fields.accessRestrictions.split("\n")) lines.push(`| | ${line} | |`);
  }
  lines.push(`| | **${fields.titleLine}** | |`);
  if (fields.filingPartyPhrase) lines.push(`| | ${fields.filingPartyPhrase} | |`);
  lines.push("");
  lines.push(`| ${fields.contacts.map((c) => formatNameList(c.names.map((n) => n.toUpperCase()))).join(" | ")} |`);
  lines.push(`| ${fields.contacts.map(() => ":---").join(" | ")} |`);
  const cells = fields.contacts.map((c) => contactCells(c, fields.gapMarker));
  for (let row = 0; row < CONTACT_COLUMNS.length; row++) lines.push(`| ${cells.map((c) => c[row].text).join(" | ")} |`);
  lines.push(`| ${fields.contacts.map((c) => `Counsel for the ${pluralizeRole(c.role, c.names.length)}`).join(" | ")} |`);
  return lines.join("\n");
}

/** "45"->"45 minutes", "60"->"1 hour", "90"->"1 hour 30 minutes" -- matches asm32's own _split_estimate
 * parser (looks for \d+\s*h(ou)?r and \d+\s*min). The mockups and both filed faces print it alike. */
export function formatTimeEstimate(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (mins > 0 || hours === 0) parts.push(`${mins} minute${mins === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** Wraps a verbatim excerpt in a quoted blockquote, one grammar-legal `> ` line per non-blank source
 * line -- a bare `>` fails the asm32 and asm33 grammars' `line.startswith("> ")` check, so blank
 * interior lines are dropped rather than emitted. The citation (ticket 2026-08-31: its own line,
 * never folded into the quote) follows as a citation line that already carries its own leading
 * `> ` or `>> ` (spec 2026-10-09: asm32 sets an excerpt and its citation in different styles).
 * Residual risk, accepted: an excerpt containing "**"/"__"/markdown-link syntax hard-rejects at
 * asm32 (its disallowed-markdown check runs on blockquote lines too) -- unsanitizable without
 * altering quoted text; fails loud, practitioner rewords. */
export function pushExcerptBlockquote(lines: string[], excerpt: string | null, citationLine: string | null): void {
  if (!excerpt) return;
  // No surrounding quotation marks -- the blockquote already marks the text as verbatim.
  for (const line of excerpt.split("\n")) {
    if (line.trim() === "") continue;
    lines.push(`> ${line}`);
  }
  if (citationLine) lines.push(citationLine);
}
