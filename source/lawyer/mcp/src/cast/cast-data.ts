// The Characters board's model (Cast of Characters spec 4.2 to 4.6): one pure join of a matter's
// case data (case/cast-of-characters.ts) and its practice-data matter roles, with their contacts
// and affiliations, into flat tabs of cards and one block per proceeding. Each proceeding has one
// badge colour. Nothing here reads a store or writes anything; cast-page.ts renders the model.

import type { CastAlias, CastCaseData, CastCounts, CastParty, CastSource } from "../case/cast-of-characters.js";
import type { Row } from "../practice/items.js";

export type Flag = "unc" | "gap" | "conflict" | "priv";

export const FLAG_LABELS: Record<Flag, string> = {
  unc: "Unconfirmed", gap: "Missing details", conflict: "Conflicting details", priv: "Privileged source",
};

/** How many badge colours the page has; proceedings past that reuse them in turn. */
export const PROCEEDING_COLOURS = 6;

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
/** A proceeding badge, a role in it, or whose witness: drawn in that proceeding's colour. */
export interface Badge { text: string; colour: number }

export interface Entry {
  key: string;
  code: string | null;
  name: string;
  badges: Badge[];
  pills: Pill[];
  flags: Flag[];
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
  /** Which missing contact details flag the entry: either one (a witness, reached directly), both, or none (reached through counsel or the registry). */
  reach: "either" | "both" | "none";
}

/** The page's tabs in order; Proceedings draws `CastModel.proceedings`, the others their entries. */
export interface Tab { id: "cli" | "svc" | "wit" | "pro" | "pub"; label: string; entries: Entry[] }

/** One proceeding on the Proceedings tab: its style and the parties' names by role, nothing else. */
export interface ProceedingBlock { badge: Badge; style: string; sides: { label: string; names: string[] }[] }

export interface CastModel {
  tabs: Tab[];
  proceedings: ProceedingBlock[];
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

/** Case-, accent- and punctuation-insensitive, as resolve_participant folds. */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’-]/g, "").replace(/[^\p{L}\p{N}@.]+/gu, " ").trim();
}

function title(role: string): string {
  const words = role.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function plural(label: string): string {
  return label.endsWith("s") ? label : label.endsWith("y") ? `${label.slice(0, -1)}ies` : `${label}s`;
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

  // ---- Proceedings: one colour each, in case-data order ----
  const procIds = [...new Set([...(caseData?.proceedings ?? []).map((p) => p.proceeding_id), ...parties.flatMap((p) => p.proceedings.map((x) => x.proceeding_id))])];
  const procById = new Map((caseData?.proceedings ?? []).map((p) => [p.proceeding_id, p]));
  const colourOf = (id: number) => Math.max(0, procIds.indexOf(id)) % PROCEEDING_COLOURS;
  const procBadge = (id: number): Badge => ({ text: str(procById.get(id)?.file_number) ?? `Proceeding ${procIds.indexOf(id) + 1}`, colour: colourOf(id) });
  const dedupe = (badges: Badge[]) => badges.filter((b, i) => badges.findIndex((x) => x.text === b.text && x.colour === b.colour) === i);
  /** A proceeding badge and a role badge for each proceeding the party is in, or only those `only` names. */
  const partyBadges = (party: CastParty, only?: number[]): Badge[] =>
    party.proceedings.filter((pr) => !only?.length || only.includes(pr.proceeding_id))
      .flatMap((pr) => [procBadge(pr.proceeding_id), { text: title(pr.role), colour: colourOf(pr.proceeding_id) }]);
  /** Whose person this is: the party's name in the colour of `proceedingId`, else the party's first proceeding. */
  const whoseBadge = (prefix: string, partyId: number | null, proceedingId?: number): Badge[] => {
    const party = partyId === null ? undefined : partyById.get(partyId);
    if (!party) return [];
    return [{ text: `${prefix} ${party.name}`, colour: colourOf(proceedingId ?? party.proceedings[0]?.proceeding_id ?? -1) }];
  };

  const ties: Tie[] = input.contacts.flatMap((row) => {
    const contact = contactOf(row);
    return contact.roles.map((role) => ({ contact, role }));
  });
  const ended = (role: Row) => str(role.to) !== null && String(role.to) <= input.today;
  const proposed = (role: Row) => role.status === "proposed";
  const used = new Set<Tie>();
  const tiesFor = (pred: (tie: Tie) => boolean) => ties.filter(pred);
  const clientTies = tiesFor(({ role }) => role.role === "client" && !ended(role));
  const clientPartyIds = new Set(clientTies.map(({ role }) => num(role.case_party_id)).filter((id): id is number => id !== null));

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
  const entry = (fields: Partial<Entry> & Pick<Entry, "key" | "name">): Entry => {
    const e: Entry = {
      code: null, badges: [], pills: [], flags: [], proposed: false, email: null, phone: null, address: null,
      aliases: [], contact: [], service: [], counsel: [], related: [], appearances: [], counts: null, notes: [], actions: [],
      reach: "both", ...fields,
    };
    e.badges = dedupe(e.badges);
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
    return e;
  };
  const proposedActions = (name: string, tie: Tie) => [
    { label: "Confirm", instruction: instruction.confirm(name, tie.role) },
    { label: "Not a character", instruction: instruction.reject(name, tie.role) },
    { label: "Merge with…", instruction: instruction.merge(name, tie.contact) },
  ];
  const tieState = (tie: Tie | undefined) => ({
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

  // ---- Service List: one card per current counsel of record, one per self-represented party ----
  const svc: Entry[] = [];
  const counselGroups = new Map<string, { name: string; acts: { party: CastParty; proceedings: number[] }[]; record: CastParty["counsel_by_proceeding"][number]; aliases: CastAlias[] }>();
  const counselOf = new Map<number, string>();
  for (const party of parties) {
    const named = party.counsel_by_proceeding.filter((c) => str(c.lawyer_name));
    if (!named.length && str(party.lawyer_name)) {
      named.push({ proceeding_id: 0, lawyer_name: party.lawyer_name, lawyer_firm: party.lawyer_firm, lawyer_email: party.lawyer_email,
        lawyer_phone: party.lawyer_phone, address: party.address, service_address_filed_date: party.service_address_filed_date });
    }
    for (const record of named) {
      const key = fold(record.lawyer_name as string);
      const group = counselGroups.get(key) ?? { name: record.lawyer_name as string, acts: [], record, aliases: [] };
      const act = group.acts.find((a) => a.party === party) ?? group.acts[group.acts.push({ party, proceedings: [] }) - 1];
      if (record.proceeding_id !== 0) act.proceedings.push(record.proceeding_id);
      group.aliases.push(...party.counsel_aliases);
      counselGroups.set(key, group);
      counselOf.set(party.party_id, `${record.lawyer_name}${record.lawyer_firm ? `, ${record.lawyer_firm}` : ""} (Service List)`);
    }
  }
  for (const group of counselGroups.values()) {
    const groupParties = group.acts.map((a) => a.party);
    const partyIds = groupParties.map((p) => p.party_id);
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
    const flags: Flag[] = [];
    const actions: Entry["actions"] = [];
    if (tie && conflicting(contact)) {
      flags.push("conflict");
      const recorded = [group.record.lawyer_email, group.record.lawyer_phone].filter(Boolean).join(", ");
      const other = [...tie.contact.emails, ...tie.contact.phones].join(", ");
      actions.push({ label: "Conflicting details", instruction: instruction.noticeOfChange(groupParties.map((p) => p.name).join(", "), recorded, other) });
    }
    svc.push(entry({
      key: `counsel-${fold(group.name)}`, name: group.name, code: codeOf(group.aliases),
      badges: group.acts.flatMap((a) => partyBadges(a.party, a.proceedings)),
      aliases: group.aliases.filter((a) => a.kind === "spelling").map((a) => a.text),
      pills: [{ text: "Counsel of record" }, ...groupParties.map((p) => ({ text: `For: ${p.name}` }))],
      flags, actions, contact,
      service: [
        ...(group.record.lawyer_firm ? [{ label: "Firm", value: group.record.lawyer_firm }] : []),
        ...(group.record.address ? [{ label: "Address for service", value: `${group.record.address}${filed ? ` (${filed.slice(2)})` : ""}` }] : []),
        ...(group.record.lawyer_email ? [{ label: "Email for service", value: group.record.lawyer_email }] : []),
      ],
      notes: tie?.contact.note ? [tie.contact.note] : [],
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
    const flags: Flag[] = [];
    if (!party.address) flags.push("gap");
    svc.push(entry({
      key: `self-${party.party_id}`, name: party.name, code: codeOf(party.aliases), badges: partyBadges(party),
      pills: [{ text: "Self-represented" }], flags,
      contact: ensure(contactDetails(tie, partyBase(party, "Address for service")), "Address for service"),
      aliases: party.aliases.filter((a) => a.kind === "spelling").map((a) => a.text),
    }));
  }

  // ---- Client(s): each party the firm acts for ----
  const cli: Entry[] = [];
  for (const party of parties.filter((p) => clientPartyIds.has(p.party_id))) {
    const tie = partyTie(party);
    if (tie) used.add(tie);
    const flags: Flag[] = [];
    if (!counselOf.has(party.party_id) && !party.address) flags.push("gap");
    const otherCounsel = tiesFor(({ role }) => role.role === "client_other_counsel" &&
      (num(role.for_case_party_id) === party.party_id || num(role.for_case_party_id) === null));
    otherCounsel.forEach((t) => used.add(t));
    const titles = (tie?.contact.affiliations ?? []).filter((a) => a.person_id === tie?.contact.id).map((a) => str(a.title)).filter((t): t is string => t !== null);
    cli.push(entry({
      key: `party-${party.party_id}`, name: party.name, code: codeOf(party.aliases), badges: partyBadges(party),
      pills: titles.map((text) => ({ text })),
      flags: [...tieState(tie).flags, ...flags], proposed: tieState(tie).proposed,
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

  // ---- Witnesses: fact witnesses, experts and investigators, each badged with whose they are ----
  const wit: Entry[] = [];
  const witnessTieKinds = ["witness", "expert"];
  for (const w of witnesses) {
    const tie = tiesFor(({ role }) => witnessTieKinds.includes(String(role.role)) && num(role.case_witness_id) === w.witness_id)[0];
    if (tie) used.add(tie);
    const expert = w.witness_type === "expert";
    const called = w.proceedings.find((p) => p.called_by_party_id !== null);
    const state = tieState(tie);
    wit.push(entry({
      key: `witness-${w.witness_id}`, name: w.name, code: codeOf(w.aliases), ...state, reach: "either",
      badges: expert ? whoseBadge("Retained by", w.retained_by_party_id) : whoseBadge("Called by", called?.called_by_party_id ?? null, called?.proceeding_id),
      pills: expert ? [{ text: "Expert" }, ...(w.field_of_expertise ? [{ text: w.field_of_expertise }] : [])] : [{ text: "Witness" }],
      aliases: [...w.aliases.filter((a) => a.kind === "spelling").map((a) => a.text), ...(tie?.contact.otherNames ?? [])],
      contact: ensure(contactDetails(tie, []), "Address for service"),
      counts: w.counts, notes: tie?.contact.note ? [tie.contact.note] : [],
      actions: tie && state.proposed ? proposedActions(w.name, tie) : [],
    }));
  }

  // ---- Public Bodies: tribunal members, court staff and public bodies ----
  const pub: Entry[] = [];
  for (const m of tribunal) {
    const tie = tiesFor(({ role }) => role.role === "court_staff" && num(role.case_tribunal_member_id) === m.tribunal_member_id)[0];
    if (tie) used.add(tie);
    const state = tieState(tie);
    pub.push(entry({
      key: `tribunal-${m.tribunal_member_id}`, name: m.name, code: codeOf(m.aliases), ...state, reach: "none",
      badges: m.proceeding_id === null ? [] : [procBadge(m.proceeding_id)],
      pills: [m.tribunal_body, m.capacity].filter((t): t is string => Boolean(t)).map((text) => ({ text })),
      aliases: m.aliases.filter((a) => a.kind === "spelling").map((a) => a.text),
      contact: ensure(contactDetails(tie, []), "Address for service"),
      appearances: m.notes ? [{ label: "Notes", value: m.notes }] : [],
      counts: m.counts,
      actions: tie && state.proposed ? proposedActions(m.name, tie) : [],
    }));
  }

  // ---- Contact-only entries: a current role with no case-data participant behind it ----
  for (const tie of ties) {
    if (used.has(tie) || ended(tie.role)) continue;
    const kind = String(tie.role.role);
    const state = tieState(tie);
    const make = (pills: Pill[], reach: Entry["reach"] = "both", badges: Badge[] = []) => entry({
      key: `role-${tie.role.id}`, name: tie.contact.name, ...state, badges, pills, reach, aliases: tie.contact.otherNames,
      contact: ensure(contactDetails(tie, []), kind === "client" ? "Address" : "Address for service"),
      related: affiliationLines(tie.contact), notes: tie.contact.note ? [tie.contact.note] : [],
      actions: state.proposed ? proposedActions(tie.contact.name, tie) : [],
    });
    const label = ROLE_LABELS[kind] ?? title(kind);
    if (kind === "witness" || kind === "investigator" || kind === "expert") {
      wit.push(make([{ text: label }], "either", whoseBadge("For", num(tie.role.for_case_party_id))));
    } else if (kind === "court_staff" || kind === "public_body") pub.push(make([{ text: label }]));
    else if (kind === "client") cli.push(make([]));
    else if (kind === "client_other_counsel" && cli.length) {
      // Other counsel for no client party shows on the first client card.
      const client = cli[0];
      client.counsel.push({ label: "Other counsel", value: `${tie.contact.name}. Not on the Service List.`, ...sourceOf(tie.role) });
    }
  }
  // A client card's other counsel may carry the privileged mark after its entry was built.
  for (const e of cli) {
    if (e.counsel.some((d) => d.privileged) && !e.flags.includes("priv")) { e.flags.push("priv"); e.pills.push({ text: FLAG_LABELS.priv, kind: "priv" }); }
  }

  // ---- Proceedings: the style and the parties' names by role, nothing else ----
  const rank = (role: string) => (P_ROLES.includes(role) ? P_ROLES.indexOf(role) : D_ROLES.includes(role) ? 10 + D_ROLES.indexOf(role) : 20);
  const proceedings: ProceedingBlock[] = procIds.map((id) => {
    const byRole = new Map<string, string[]>();
    for (const party of parties) for (const pr of party.proceedings) {
      if (pr.proceeding_id === id && !byRole.get(pr.role)?.includes(party.name)) byRole.set(pr.role, [...(byRole.get(pr.role) ?? []), party.name]);
    }
    const sides = [...byRole].sort((a, b) => rank(a[0]) - rank(b[0])).map(([role, names]) => ({ label: plural(title(role)), names }));
    const badge = procBadge(id);
    const style = str(procById.get(id)?.style_of_cause) ??
      (sides.length > 1 ? `${sides[0].names.join(", ")} v. ${sides[1].names.join(", ")}` : sides[0]?.names.join(", ") ?? badge.text);
    return { badge, style, sides };
  });

  const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const tabs: Tab[] = [
    { id: "cli", label: "Client(s)", entries: cli.sort(byName) },
    { id: "svc", label: "Service List", entries: svc.sort(byName) },
    { id: "wit", label: "Witnesses", entries: wit.sort(byName) },
    { id: "pro", label: "Proceedings", entries: [] },
    { id: "pub", label: "Public Bodies", entries: pub.sort(byName) },
  ];

  // Service List copies: current counsel and self-represented parties, never a privileged detail.
  const serviceEmail = (e: Entry) => e.contact.find((d) => d.label === "Email" && d.value && !d.privileged)?.value ?? null;
  const serviceEmails = [...new Set(svc.map(serviceEmail).filter((v): v is string => v !== null))].join("; ");
  const serviceTable = [
    ["For", "Counsel or party", "Firm", "Email", "Phone", "Address for service"].join("\t"),
    ...svc.map((e) => [
      e.pills.filter((p) => p.text.startsWith("For: ")).map((p) => p.text.slice(5)).join(", ") || e.name,
      e.name, e.service.find((d) => d.label === "Firm")?.value ?? "",
      serviceEmail(e) ?? "", e.contact.find((d) => d.label === "Phone" && !d.privileged)?.value ?? "",
      e.contact.find((d) => d.label.startsWith("Address") && !d.privileged)?.value ?? "",
    ].join("\t")),
  ].join("\n");

  return { tabs, proceedings, serviceEmails, serviceTable, notes };
}

/** Entries per tab (proceedings on Proceedings), and how many entries carry a flag, for the render tool's reply. */
export function castCounts(model: CastModel): { tabs: Record<string, number>; flagged: Record<string, number> } {
  const tabs: Record<string, number> = {};
  const flagged: Record<string, number> = { unconfirmed: 0, missing_details: 0, conflicting_details: 0, privileged_source: 0 };
  const names: Record<Flag, string> = { unc: "unconfirmed", gap: "missing_details", conflict: "conflicting_details", priv: "privileged_source" };
  for (const tab of model.tabs) {
    tabs[tab.label] = tab.id === "pro" ? model.proceedings.length : tab.entries.length;
    for (const e of tab.entries) for (const f of e.flags) flagged[names[f]]++;
  }
  return { tabs, flagged };
}
