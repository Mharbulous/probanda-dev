// The Cast of Characters board's model (Cast of Characters spec 4.2 to 4.6): one pure join of a
// matter's case data (case/cast-of-characters.ts) and its practice-data matter roles, with their
// contacts and affiliations, into four tabs of sections of cards. Side is derived, never stored.
// Nothing here reads a store or writes anything; cast-page.ts renders the model.

import type { CastAlias, CastCaseData, CastCounts, CastParty, CastSource } from "../case/cast-of-characters.js";
import type { Row } from "../practice/items.js";

export type Side = "P" | "D" | "N";
export type Flag = "unc" | "gap" | "conflict" | "priv";

export const FLAG_LABELS: Record<Flag, string> = {
  unc: "Unconfirmed", gap: "Missing details", conflict: "Conflicting details", priv: "Privileged source",
};

export interface Detail {
  label: string;
  value: string | null;
  source?: string;
  /** A source file to link to, as an absolute path. */
  sourcePath?: string;
  privileged?: boolean;
  copy?: boolean;
}

export interface Pill { text: string; kind?: "warn" | "priv" }

export interface Entry {
  key: string;
  code: string | null;
  name: string;
  side: Side;
  pills: Pill[];
  flags: Flag[];
  former: boolean;
  proposed: boolean;
  email: string | null;
  phone: string | null;
  address: string | null;
  aliases: string[];
  contact: Detail[];
  service: Detail[];
  counsel: Detail[];
  related: string[];
  appearances: Detail[];
  counts: CastCounts | null;
  notes: string[];
  actions: { label: string; instruction: string }[];
  search: string;
  /** Which missing contact details flag the entry: either one (a witness, reached directly), both, or none (reached through counsel or the registry). */
  reach: "either" | "both" | "none";
}

export interface Section { title: string; entries: Entry[] }
export interface Tab { id: "svc" | "lit" | "wit" | "dec"; label: string; sections: Section[] }

export interface CastModel {
  tabs: Tab[];
  /** The matter's own labels for the two sides, such as Plaintiffs or Petitioners. */
  sideLabels: { P: string; D: string };
  serviceEmails: string;
  serviceTable: string;
  notes: string[];
}

export interface CastInput {
  mattNum: string;
  caseData: CastCaseData;
  /** contact_lookup's contacts for the matter: each with its affiliations and this matter's roles. */
  contacts: Row[];
  /** Every contact's name by id, to name an affiliation's other side. */
  contactNames: Map<string, string>;
  /** contact_checks' parties_without_role for this matter: the party ids. */
  partiesWithoutRole: number[];
  today: string;
}

const P_ROLES = ["plaintiff", "petitioner", "applicant", "appellant", "claimant"];
const D_ROLES = ["defendant", "respondent", "third_party", "defendant_by_counterclaim"];
const COUNSEL_ROLES = ["opposing_counsel", "co_counsel"];
const LITIGANT_ROLES = ["client", "opposing_party"];
const ROLE_LABELS: Record<string, string> = {
  client: "Client", opposing_party: "Opposing party", opposing_counsel: "Opposing counsel", co_counsel: "Co-counsel",
  expert: "Expert", adjuster: "Adjuster", client_other_counsel: "Other counsel", client_representative: "Client's representative",
  witness: "Witness", investigator: "Private investigator", insurer: "Insurer", public_body: "Public body", court_staff: "Court staff",
};

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : []);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** Case-, accent- and punctuation-insensitive, as search and resolve_participant fold. */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’-]/g, "").replace(/[^\p{L}\p{N}@.]+/gu, " ").trim();
}

function title(role: string): string {
  const words = role.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function plural(label: string): string {
  return label.endsWith("s") ? label : `${label}s`;
}

function addressText(value: unknown): string | null {
  if (typeof value === "string") return str(value);
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  const parts = [a.poBox, a.extended, a.street, a.city, a.region, a.postalCode, a.country].map(str).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

interface Contact { id: string; name: string; emails: string[]; phones: string[]; addresses: string[]; otherNames: string[]; note: string | null; affiliations: Row[]; roles: Row[] }

function contactOf(row: Row): Contact {
  return {
    id: String(row.id), name: str(row.name) ?? "(no name)", emails: list(row.emails), phones: list(row.phones),
    addresses: (Array.isArray(row.addresses) ? row.addresses : []).map(addressText).filter((a): a is string => a !== null),
    otherNames: list(row.other_names), note: str(row.note),
    affiliations: Array.isArray(row.affiliations) ? (row.affiliations as Row[]) : [],
    roles: Array.isArray(row.roles) ? (row.roles as Row[]) : [],
  };
}

interface Tie { contact: Contact; role: Row }

export function buildCastModel(input: CastInput): CastModel {
  const notes: string[] = [];
  const caseData = input.caseData.status === "ok" ? input.caseData : null;
  if (!caseData) notes.push(`Case data: ${(input.caseData as { reason: string }).reason}`);
  const parties = caseData?.parties ?? [];
  const witnesses = caseData?.witnesses ?? [];
  const tribunal = caseData?.tribunal_members ?? [];
  const sources = new Map<number, CastSource>((caseData?.sources ?? []).map((s) => [s.source_id, s]));
  const partyById = new Map(parties.map((p) => [p.party_id, p]));

  const ties: Tie[] = input.contacts.flatMap((row) => {
    const contact = contactOf(row);
    return contact.roles.map((role) => ({ contact, role }));
  });
  const ended = (role: Row) => str(role.to) !== null && String(role.to) <= input.today;
  const proposed = (role: Row) => role.status === "proposed";
  const used = new Set<Tie>();
  const tiesFor = (pred: (tie: Tie) => boolean) => ties.filter(pred);

  // The matter's own labels for the two sides, from the proceeding roles in use.
  const labelFor = (side: "P" | "D") => {
    const pool = side === "P" ? P_ROLES : D_ROLES;
    const counts = new Map<string, number>();
    for (const p of parties) for (const pr of p.proceedings) if (pool.includes(pr.role)) counts.set(pr.role, (counts.get(pr.role) ?? 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1] || pool.indexOf(a[0]) - pool.indexOf(b[0]))[0]?.[0];
    return plural(title(best ?? (side === "P" ? "plaintiff" : "defendant")));
  };
  const sideLabel = { P: labelFor("P"), D: labelFor("D") };
  const partySide = (party: CastParty | undefined): Side => {
    const role = party?.proceedings[0]?.role;
    return role && P_ROLES.includes(role) ? "P" : role && D_ROLES.includes(role) ? "D" : "N";
  };
  const sideOfParty = (id: number | null) => (id === null ? "N" : partySide(partyById.get(id)));
  const clientTies = tiesFor(({ role }) => role.role === "client" && !ended(role));
  const clientPartyIds = new Set(clientTies.map(({ role }) => num(role.case_party_id)).filter((id): id is number => id !== null));
  const clientSide: Side = [...clientPartyIds].map(sideOfParty).find((s) => s !== "N") ?? "P";

  const sourceOf = (role: Row): Pick<Detail, "source" | "sourcePath" | "privileged"> => {
    const cited = num(role.from_source_id) !== null ? sources.get(num(role.from_source_id) as number) : undefined;
    const source = cited ? [cited.title, cited.date].filter(Boolean).join(", ") : str(role.note) ?? undefined;
    return { source, sourcePath: cited?.file_path ?? undefined, privileged: role.privileged_source === true || undefined };
  };

  const instruction = {
    confirm: (name: string, role: Row) => `Confirm ${name} as ${ROLE_LABELS[String(role.role)] ?? role.role} on ${input.mattNum} (matter role ${role.id}).`,
    reject: (name: string, role: Row) => `${name} is not a character on ${input.mattNum}: end matter role ${role.id} with a note saying so.`,
    merge: (name: string, contact: Contact) => `Merge the contact ${name} (${contact.id}) on ${input.mattNum} into the existing contact I name: `,
    gap: (name: string) => `Find and record ${name}'s phone and email for ${input.mattNum}.`,
    noRole: (name: string, id: number) => `Record the contact and matter role for the party ${name} (case_party_id ${id}) on ${input.mattNum}.`,
    noticeOfChange: (party: string, record: string, contact: string) =>
      `Was a notice of change filed for ${party} on ${input.mattNum}? Counsel of record gives ${record}; the contact gives ${contact}.`,
  };

  // Contact details from a contact tied by a role, each with that role's source.
  const contactDetails = (tie: Tie | undefined, base: Detail[]): Detail[] => {
    const out = [...base];
    if (!tie) return out;
    const from = sourceOf(tie.role);
    const add = (label: string, values: string[]) => {
      for (const value of values) {
        if (out.some((d) => d.label.startsWith(label) && d.value === value)) continue;
        const taken = out.some((d) => d.label.startsWith(label) && d.value !== null);
        const missing = out.findIndex((d) => d.label === label && d.value === null);
        const detail = { label: taken ? `${label} (other)` : label, value, ...from, copy: label !== "Address" };
        if (missing >= 0) out[missing] = detail; else out.push(detail);
      }
    };
    add("Email", tie.contact.emails);
    add("Phone", tie.contact.phones);
    add("Address", tie.contact.addresses);
    return out;
  };
  const ensure = (details: Detail[], addressLabel = "Address"): Detail[] => {
    const out = [...details];
    for (const label of ["Email", "Phone", addressLabel]) {
      if (!out.some((d) => d.label.startsWith(label))) out.push({ label, value: null });
    }
    const order = (d: Detail) => ["Email", "Phone", addressLabel].findIndex((l) => d.label.startsWith(l));
    return out.sort((a, b) => order(a) - order(b));
  };
  const first = (details: Detail[], label: string) => details.find((d) => d.label.startsWith(label) && d.value !== null)?.value ?? null;
  const conflicting = (details: Detail[]) =>
    ["Email", "Phone"].some((label) => new Set(details.filter((d) => d.label.startsWith(label) && d.value).map((d) => fold(d.value as string).replace(/\s/g, ""))).size > 1);

  const codeOf = (aliases: CastAlias[]) => aliases.find((a) => a.kind === "file_code")?.text ?? null;
  const entry = (fields: Partial<Entry> & Pick<Entry, "key" | "name" | "side">): Entry => {
    const e: Entry = {
      code: null, pills: [], flags: [], former: false, proposed: false, email: null, phone: null, address: null,
      aliases: [], contact: [], service: [], counsel: [], related: [], appearances: [], counts: null, notes: [], actions: [],
      search: "", reach: "both", ...fields,
    };
    e.email = first(e.contact, "Email");
    e.phone = first(e.contact, "Phone");
    e.address = first(e.contact, "Address");
    const missing = e.reach === "either" ? !e.email || !e.phone : e.reach === "both" ? !e.email && !e.phone : false;
    if (missing && !e.flags.includes("gap")) e.flags.push("gap");
    if (conflicting(e.contact) && !e.flags.includes("conflict")) e.flags.push("conflict");
    if ([...e.contact, ...e.counsel].some((d) => d.privileged) && !e.flags.includes("priv")) e.flags.push("priv");
    if (e.flags.includes("gap") && !e.actions.some((a) => a.label === "Missing details")) {
      e.actions.push({ label: "Missing details", instruction: instruction.gap(e.name) });
    }
    // Missing details has no pill (the mockup): the "no email" and "no phone" warnings on row 2 show it.
    for (const flag of e.flags) if (flag !== "gap" && !e.pills.some((p) => p.text === FLAG_LABELS[flag])) {
      e.pills.push({ text: FLAG_LABELS[flag], kind: flag === "priv" ? "priv" : "warn" });
    }
    e.search = fold([e.name, e.code, ...e.aliases, ...e.pills.map((p) => p.text), ...e.contact.map((d) => d.value),
      ...e.service.map((d) => d.value), ...e.counsel.map((d) => d.value), ...e.related].filter(Boolean).join(" "));
    return e;
  };
  const proposedActions = (name: string, tie: Tie) => [
    { label: "Confirm", instruction: instruction.confirm(name, tie.role) },
    { label: "Not a character", instruction: instruction.reject(name, tie.role) },
    { label: "Merge with…", instruction: instruction.merge(name, tie.contact) },
  ];
  const tieState = (tie: Tie | undefined) => ({
    former: tie ? ended(tie.role) : false,
    proposed: tie ? proposed(tie.role) : false,
    flags: tie && proposed(tie.role) ? (["unc"] as Flag[]) : [],
  });

  // ---- Related: affiliations, insurers with their adjusters, representatives ----
  const affiliationLines = (contact: Contact | undefined): string[] => (contact?.affiliations ?? []).map((a) => {
    const isPerson = a.person_id === contact?.id;
    const other = input.contactNames.get(String(isPerson ? a.organization_id : a.person_id)) ?? "(unknown contact)";
    const role = str(a.title) ?? (isPerson ? "Affiliated with" : "Affiliated person");
    return isPerson ? `${role} of ${other}` : `${role}: ${other}`;
  });
  const relatedFor = (partyId: number): string[] => {
    const out: string[] = [];
    for (const tie of tiesFor(({ role }) => num(role.for_case_party_id) === partyId && !ended(role))) {
      const kind = String(tie.role.role);
      if (kind === "insurer") {
        const adjusters = tiesFor(({ role, contact }) => role.role === "adjuster" &&
          contact.affiliations.some((a) => a.organization_id === tie.contact.id)).map(({ contact }) => contact.name);
        out.push(`Insurer: ${tie.contact.name}${adjusters.length ? ` · adjuster ${adjusters.join(", ")}` : ""}`);
        used.add(tie);
      } else if (kind === "client_representative") {
        out.push(`Representative: ${tie.contact.name}${tie.contact.emails[0] ? ` · ${tie.contact.emails[0]}` : ""}${tie.contact.phones[0] ? ` · ${tie.contact.phones[0]}` : ""}`);
        used.add(tie);
      }
    }
    return out;
  };
  for (const tie of ties) if (tie.role.role === "adjuster") used.add(tie);

  // ---- Service List: one card per counsel of record, one per self-represented party ----
  const svc: Record<"P" | "D" | "N", Entry[]> = { P: [], D: [], N: [] };
  const counselGroups = new Map<string, { name: string; parties: CastParty[]; record: CastParty["counsel_by_proceeding"][number]; aliases: CastAlias[] }>();
  const counselOf = new Map<number, string>();
  for (const party of parties) {
    const named = party.counsel_by_proceeding.filter((c) => str(c.lawyer_name));
    if (!named.length && str(party.lawyer_name)) {
      named.push({ proceeding_id: 0, lawyer_name: party.lawyer_name, lawyer_firm: party.lawyer_firm, lawyer_email: party.lawyer_email,
        lawyer_phone: party.lawyer_phone, address: party.address, service_address_filed_date: party.service_address_filed_date });
    }
    for (const record of named) {
      const key = fold(record.lawyer_name as string);
      const group = counselGroups.get(key) ?? { name: record.lawyer_name as string, parties: [], record, aliases: [] };
      if (!group.parties.includes(party)) group.parties.push(party);
      group.aliases.push(...party.counsel_aliases);
      counselGroups.set(key, group);
      counselOf.set(party.party_id, `${record.lawyer_name}${record.lawyer_firm ? `, ${record.lawyer_firm}` : ""} (Service List)`);
    }
  }
  for (const group of counselGroups.values()) {
    const partyIds = group.parties.map((p) => p.party_id);
    const tie = tiesFor(({ role, contact }) => COUNSEL_ROLES.includes(String(role.role)) && !ended(role) &&
      partyIds.includes(num(role.case_party_id) ?? -1) && fold(contact.name) === fold(group.name))[0];
    if (tie) used.add(tie);
    const filed = group.record.service_address_filed_date ? `, filed ${group.record.service_address_filed_date}` : "";
    const record: Detail[] = [
      ...(group.record.lawyer_email ? [{ label: "Email", value: group.record.lawyer_email, source: "Counsel of record", copy: true }] : []),
      ...(group.record.lawyer_phone ? [{ label: "Phone", value: group.record.lawyer_phone, source: "Counsel of record", copy: true }] : []),
      ...(group.record.address ? [{ label: "Address for service", value: group.record.address, source: `Counsel of record${filed}` }] : []),
    ];
    const contact = ensure(contactDetails(tie, record), "Address for service");
    const side = partySide(group.parties[0]);
    const flags: Flag[] = [];
    const actions: Entry["actions"] = [];
    if (tie && conflicting(contact)) {
      flags.push("conflict");
      const recorded = [group.record.lawyer_email, group.record.lawyer_phone].filter(Boolean).join(", ");
      const other = [...tie.contact.emails, ...tie.contact.phones].join(", ");
      actions.push({ label: "Conflicting details", instruction: instruction.noticeOfChange(group.parties.map((p) => p.name).join(", "), recorded, other) });
    }
    svc[side].push(entry({
      key: `counsel-${fold(group.name)}`, name: group.name, side, code: codeOf(group.aliases),
      aliases: group.aliases.filter((a) => a.kind === "spelling").map((a) => a.text),
      pills: [{ text: "Counsel of record" }, ...group.parties.map((p) => ({ text: `For: ${p.name}` }))],
      flags, actions, contact,
      service: [
        ...(group.record.lawyer_firm ? [{ label: "Firm", value: group.record.lawyer_firm }] : []),
        ...(group.record.address ? [{ label: "Address for service", value: `${group.record.address}${filed ? ` (${filed.slice(2)})` : ""}` }] : []),
        ...(group.record.lawyer_email ? [{ label: "Email for service", value: group.record.lawyer_email }] : []),
      ],
      notes: tie?.contact.note ? [tie.contact.note] : [],
    }));
  }
  // Former counsel: ended counsel roles, shown only with Show former.
  for (const tie of tiesFor(({ role }) => COUNSEL_ROLES.includes(String(role.role)) && ended(role))) {
    used.add(tie);
    const party = partyById.get(num(tie.role.case_party_id) ?? -1);
    const side = partySide(party);
    svc[side].push(entry({
      key: `former-${tie.role.id}`, name: tie.contact.name, side, former: true,
      pills: [{ text: "Former counsel of record" }, ...(party ? [{ text: `For: ${party.name}` }] : []), { text: `Replaced ${tie.role.to}` }],
      contact: ensure(contactDetails(tie, []), "Address for service"),
      aliases: tie.contact.otherNames,
    }));
  }
  const partyTie = (party: CastParty) =>
    tiesFor(({ role }) => LITIGANT_ROLES.includes(String(role.role)) && num(role.case_party_id) === party.party_id)
      .sort((a, b) => Number(ended(a.role)) - Number(ended(b.role)))[0];
  const partyBase = (party: CastParty, addressLabel: string): Detail[] => [
    ...(str(party.contact_info)?.includes("@") ? [{ label: "Email", value: str(party.contact_info), source: "Case data", copy: true }] : []),
    ...(party.address ? [{ label: addressLabel, value: party.address, source: "Case data" }] : []),
  ];
  for (const party of parties) {
    if (counselOf.has(party.party_id)) continue;
    const tie = partyTie(party);
    const side = partySide(party);
    const flags: Flag[] = [];
    if (!party.address) flags.push("gap");
    svc[side].push(entry({
      key: `self-${party.party_id}`, name: party.name, side, code: codeOf(party.aliases),
      pills: [{ text: "Self-represented" }], flags,
      contact: ensure(contactDetails(tie, partyBase(party, "Address for service")), "Address for service"),
      aliases: party.aliases.filter((a) => a.kind === "spelling").map((a) => a.text),
    }));
  }

  // ---- Litigants: every party ----
  const lit: Record<"P" | "D" | "N", Entry[]> = { P: [], D: [], N: [] };
  for (const party of parties) {
    const tie = partyTie(party);
    if (tie) used.add(tie);
    const side = partySide(party);
    const roles = [...new Set(party.proceedings.map((p) => title(p.role)))];
    const flags: Flag[] = [];
    const actions: Entry["actions"] = [];
    if (input.partiesWithoutRole.includes(party.party_id)) {
      flags.push("gap");
      actions.push({ label: "No matter role", instruction: instruction.noRole(party.name, party.party_id) });
    }
    if (!counselOf.has(party.party_id) && !party.address && !flags.includes("gap")) flags.push("gap");
    const otherCounsel = tiesFor(({ role }) => role.role === "client_other_counsel" &&
      (num(role.for_case_party_id) === party.party_id || (num(role.for_case_party_id) === null && clientPartyIds.has(party.party_id))));
    otherCounsel.forEach((t) => used.add(t));
    const titles = (tie?.contact.affiliations ?? []).filter((a) => a.person_id === tie?.contact.id).map((a) => str(a.title)).filter((t): t is string => t !== null);
    lit[side].push(entry({
      key: `party-${party.party_id}`, name: party.name, side, code: codeOf(party.aliases),
      pills: [...roles.map((text) => ({ text })), ...(clientPartyIds.has(party.party_id) ? [{ text: "Client" }] : []), ...titles.map((text) => ({ text }))],
      flags: [...tieState(tie).flags, ...flags], actions, proposed: tieState(tie).proposed, former: false,
      reach: counselOf.has(party.party_id) ? "none" : "both",
      aliases: [...party.aliases.filter((a) => a.kind === "spelling").map((a) => a.text), ...(tie?.contact.otherNames ?? [])],
      contact: ensure(contactDetails(tie, partyBase(party, "Address"))),
      counsel: [
        { label: "Counsel of record", value: counselOf.get(party.party_id) ?? "Self-represented (Service List)" },
        ...otherCounsel.map((t) => ({ label: "Other counsel", value: [t.contact.name, t.contact.emails[0], t.contact.phones[0]].filter(Boolean).join(", ") + ". Not on the Service List.", ...sourceOf(t.role) })),
      ],
      related: [...affiliationLines(tie?.contact), ...relatedFor(party.party_id)],
      counts: party.counts,
      notes: tie?.contact.note ? [tie.contact.note] : [],
    }));
  }

  // ---- Witnesses: fact witnesses by calling side, experts, investigators by engaging side ----
  const wit: Record<"P" | "D" | "N" | "X", Entry[]> = { P: [], D: [], N: [], X: [] };
  const witnessTieKinds = ["witness", "expert"];
  for (const w of witnesses) {
    const tie = tiesFor(({ role }) => witnessTieKinds.includes(String(role.role)) && num(role.case_witness_id) === w.witness_id)[0];
    if (tie) used.add(tie);
    const expert = w.witness_type === "expert";
    const caller = w.proceedings.find((p) => p.called_by_party_id !== null)?.called_by_party_id ?? null;
    const side = sideOfParty(expert ? w.retained_by_party_id : caller);
    const state = tieState(tie);
    const pills: Pill[] = expert
      ? [{ text: side === "N" ? "Expert" : `${side === "P" ? sideLabel.P : sideLabel.D}' expert` }, ...(w.field_of_expertise ? [{ text: w.field_of_expertise }] : [])]
      : [{ text: "Witness" }];
    (expert ? wit.X : wit[side]).push(entry({
      key: `witness-${w.witness_id}`, name: w.name, side, code: codeOf(w.aliases), pills, ...state, reach: "either",
      aliases: [...w.aliases.filter((a) => a.kind === "spelling").map((a) => a.text), ...(tie?.contact.otherNames ?? [])],
      contact: ensure(contactDetails(tie, []), "Address for service"),
      counts: w.counts, notes: tie?.contact.note ? [tie.contact.note] : [],
      actions: tie && state.proposed ? proposedActions(w.name, tie) : [],
    }));
  }

  // ---- Public Bodies: tribunal members and court staff under Court, public bodies after ----
  const court: Entry[] = [];
  const bodies: Entry[] = [];
  for (const m of tribunal) {
    const tie = tiesFor(({ role }) => role.role === "court_staff" && num(role.case_tribunal_member_id) === m.tribunal_member_id)[0];
    if (tie) used.add(tie);
    const state = tieState(tie);
    court.push(entry({
      key: `tribunal-${m.tribunal_member_id}`, name: m.name, side: "N", code: codeOf(m.aliases), ...state, reach: "none",
      pills: [m.tribunal_body, m.capacity].filter((t): t is string => Boolean(t)).map((text) => ({ text })),
      aliases: m.aliases.filter((a) => a.kind === "spelling").map((a) => a.text),
      contact: ensure(contactDetails(tie, []), "Address for service"),
      appearances: m.notes ? [{ label: "Notes", value: m.notes }] : [],
      counts: m.counts,
      actions: tie && state.proposed ? proposedActions(m.name, tie) : [],
    }));
  }

  // ---- Contact-only entries: a role with no case-data participant behind it ----
  for (const tie of ties) {
    if (used.has(tie)) continue;
    const kind = String(tie.role.role);
    const forParty = num(tie.role.for_case_party_id);
    const side: Side =
      kind === "client_other_counsel" || kind === "client_representative" ? clientSide :
      kind === "insurer" || kind === "investigator" ? sideOfParty(forParty) :
      kind === "client" ? clientSide :
      kind === "opposing_party" ? (clientSide === "P" ? "D" : "P") :
      "N";
    const state = tieState(tie);
    const make = (pills: Pill[], reach: Entry["reach"] = "both") => entry({
      key: `role-${tie.role.id}`, name: tie.contact.name, side, ...state, pills, reach, aliases: tie.contact.otherNames,
      contact: ensure(contactDetails(tie, []), kind === "client" || kind === "opposing_party" ? "Address" : "Address for service"),
      related: affiliationLines(tie.contact), notes: tie.contact.note ? [tie.contact.note] : [],
      actions: state.proposed ? proposedActions(tie.contact.name, tie) : [],
    });
    const label = ROLE_LABELS[kind] ?? title(kind);
    if (kind === "witness" || kind === "investigator") (side === "N" ? wit.N : wit[side]).push(make([{ text: label }], "either"));
    else if (kind === "expert") wit.X.push(make([{ text: label }], "either"));
    else if (kind === "court_staff") court.push(make([{ text: label }]));
    else if (kind === "public_body") bodies.push(make([{ text: label }]));
    else if (LITIGANT_ROLES.includes(kind)) lit[side].push(make([{ text: label }]));
    else if (kind === "client_other_counsel") {
      // With no party to sit under, other counsel shows on the client's card when there is one.
      const client = lit[clientSide].find((e) => e.pills.some((p) => p.text === "Client"));
      if (client) {
        client.counsel.push({ label: "Other counsel", value: `${tie.contact.name}. Not on the Service List.`, ...sourceOf(tie.role) });
        if (tie.role.privileged_source === true && !client.flags.includes("priv")) { client.flags.push("priv"); client.pills.push({ text: FLAG_LABELS.priv, kind: "priv" }); }
        client.search = fold(`${client.search} ${tie.contact.name}`);
      }
    }
  }
  // A party card's other counsel may carry the privileged mark after its entry was built.
  for (const e of Object.values(lit).flat()) {
    if (e.counsel.some((d) => d.privileged) && !e.flags.includes("priv")) { e.flags.push("priv"); e.pills.push({ text: FLAG_LABELS.priv, kind: "priv" }); }
  }

  const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const section = (t: string, entries: Entry[]): Section => ({ title: t, entries: [...entries].sort(byName) });
  const neutralParties = (rec: Record<"P" | "D" | "N", Entry[]>, label: string) => (rec.N.length ? [section(label, rec.N)] : []);

  const tabs: Tab[] = [
    { id: "svc", label: "Service List", sections: [section(sideLabel.P, svc.P), section(sideLabel.D, svc.D), ...neutralParties(svc, "Other parties")] },
    { id: "lit", label: "Litigants", sections: [section(sideLabel.P, lit.P), section(sideLabel.D, lit.D), ...neutralParties(lit, "Other parties")] },
    {
      id: "wit", label: "Witnesses", sections: [
        section(`${sideLabel.P}' Witnesses`, wit.P), section(`${sideLabel.D}' Witnesses`, wit.D),
        section("Expert Witnesses", wit.X), ...(wit.N.length ? [section("Other Witnesses", wit.N)] : []),
      ],
    },
    { id: "dec", label: "Public Bodies", sections: [section("Court", court), section("Enforcement & Public Bodies", bodies)] },
  ];

  // Service List copies: current counsel and self-represented parties, never a privileged detail.
  const current = tabs[0].sections.flatMap((s) => s.entries).filter((e) => !e.former);
  const serviceEmail = (e: Entry) => e.contact.find((d) => d.label === "Email" && d.value && !d.privileged)?.value ?? null;
  const serviceEmails = [...new Set(current.map(serviceEmail).filter((v): v is string => v !== null))].join("; ");
  const serviceTable = [
    ["For", "Counsel or party", "Firm", "Email", "Phone", "Address for service"].join("\t"),
    ...current.map((e) => [
      e.pills.filter((p) => p.text.startsWith("For: ")).map((p) => p.text.slice(5)).join(", ") || e.name,
      e.name, e.service.find((d) => d.label === "Firm")?.value ?? "",
      serviceEmail(e) ?? "", e.contact.find((d) => d.label === "Phone" && !d.privileged)?.value ?? "",
      e.contact.find((d) => d.label.startsWith("Address") && !d.privileged)?.value ?? "",
    ].join("\t")),
  ].join("\n");

  return { tabs, sideLabels: sideLabel, serviceEmails, serviceTable, notes };
}

/** Counts per tab, and how many entries carry a flag, for the render tool's reply. */
export function castCounts(model: CastModel): { tabs: Record<string, number>; flagged: Record<string, number> } {
  const tabs: Record<string, number> = {};
  const flagged: Record<string, number> = { unconfirmed: 0, missing_details: 0, conflicting_details: 0, privileged_source: 0 };
  const names: Record<Flag, string> = { unc: "unconfirmed", gap: "missing_details", conflict: "conflicting_details", priv: "privileged_source" };
  for (const tab of model.tabs) {
    const entries = tab.sections.flatMap((s) => s.entries).filter((e) => !e.former);
    tabs[tab.label] = entries.length;
    for (const e of entries) for (const f of e.flags) flagged[names[f]]++;
  }
  return { tabs, flagged };
}
