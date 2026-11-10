// The Characters page's fixture: the fictional test matter T512 of the 2026-11-06 mockup, with a
// second proceeding in which the parties' roles are reversed, drawn through buildCastModel as a
// real page is. Every name is invented.

import { buildCastModel } from "../cast/cast-data.js";
import type { CastMeta } from "../cast/cast-page.js";

const role = (id: string, r: string, extra: Record<string, unknown> = {}) => ({ id, role: r, ...extra });

export const CAST_FIXTURE: { meta: CastMeta; model: ReturnType<typeof buildCastModel> } = {
  meta: { matter: "T512", client: "Maple Grove Dental Inc.", revision: 4, rendered: "2026-11-06 17:30" },
  model: buildCastModel({
    mattNum: "T512",
    today: "2026-11-06",
    contactNames: new Map([["c1", "Alan Wei Park"], ["c2", "Maple Grove Dental Inc."]]),
    caseData: {
      status: "ok",
      proceedings: [
        { proceeding_id: 1, court: "BCSC", registry: "Vancouver", file_number: "S-000000", style_of_cause: null, status: "active" },
        { proceeding_id: 2, court: "BCSC", registry: "Vancouver", file_number: "S-000777", style_of_cause: null, status: "active" },
      ],
      parties: [
        {
          party_id: 1, name: "Alan Wei Park", party_type: "individual", lawyer_name: "Pat Counsel", lawyer_firm: "Example Law LLP",
          lawyer_email: "pat@examplelaw.example", lawyer_phone: "604-555-0100", address: "900-555 Sample St, Vancouver BC", contact_info: null,
          service_address_filed_date: "2026-03-01", replaced_representative: null, proceedings: [{ proceeding_id: 1, role: "plaintiff" }, { proceeding_id: 2, role: "defendant" }],
          counsel_by_proceeding: [{ proceeding_id: 1, lawyer_name: "Pat Counsel", lawyer_firm: "Example Law LLP", lawyer_email: "pat@examplelaw.example", lawyer_phone: "604-555-0100", address: "900-555 Sample St, Vancouver BC", service_address_filed_date: "2026-03-01" }],
          aliases: [{ text: "ParkA", kind: "file_code" }, { text: "Wei Park", kind: "spelling" }], counsel_aliases: [{ text: "CounselP", kind: "file_code" }],
          counts: { facts: 12, documents: 31 },
        },
        {
          party_id: 2, name: "Bo Lin", party_type: "individual", lawyer_name: "Sample Counsel A", lawyer_firm: "Sample LLP",
          lawyer_email: "counsel.a@example.com", lawyer_phone: "604-555-0171", address: "300-111 Sample St, Vancouver BC", contact_info: null,
          service_address_filed_date: null, replaced_representative: null, proceedings: [{ proceeding_id: 1, role: "defendant" }, { proceeding_id: 2, role: "plaintiff" }],
          counsel_by_proceeding: [{ proceeding_id: 1, lawyer_name: "Sample Counsel A", lawyer_firm: "Sample LLP", lawyer_email: "counsel.a@example.com", lawyer_phone: "604-555-0171", address: "300-111 Sample St, Vancouver BC", service_address_filed_date: null }],
          aliases: [{ text: "LinB", kind: "file_code" }], counsel_aliases: [], counts: { facts: 9, documents: 11 },
        },
        {
          party_id: 3, name: "The Owners, Strata Plan EPS0000", party_type: "other", lawyer_name: null, lawyer_firm: null, lawyer_email: null,
          lawyer_phone: null, address: null, contact_info: "council@strata.example", service_address_filed_date: null, replaced_representative: null,
          proceedings: [{ proceeding_id: 1, role: "defendant" }], counsel_by_proceeding: [{ proceeding_id: 1, lawyer_name: null, lawyer_firm: null, lawyer_email: null, lawyer_phone: null, address: null, service_address_filed_date: null }],
          aliases: [{ text: "StrataEPS0000", kind: "file_code" }], counsel_aliases: [], counts: { facts: 21, documents: 40 },
        },
      ],
      witnesses: [
        { witness_id: 1, name: "Jordan Kim", witness_type: "fact", field_of_expertise: null, retained_by_party_id: null, report_source_id: null, qualified: null, proceedings: [{ proceeding_id: 1, called_by_party_id: 1 }], aliases: [{ text: "KimJ", kind: "file_code" }], counts: { facts: 3, documents: 2 } },
        { witness_id: 2, name: "Dr. Sample Air-Quality", witness_type: "expert", field_of_expertise: "Air quality", retained_by_party_id: 1, report_source_id: null, qualified: null, proceedings: [], aliases: [{ text: "AirM", kind: "file_code" }], counts: { facts: 0, documents: 1 } },
      ],
      tribunal_members: [
        { tribunal_member_id: 1, name: "Justice Sample", capacity: "judge", tribunal_body: "Supreme Court of BC", proceeding_id: 1, notes: "Consent injunction order, 2026-08-31", aliases: [{ text: "JudgeS", kind: "file_code" }], counts: { facts: 0, documents: 2 } },
      ],
      sources: [],
    },
    contacts: [
      { id: "c1", name: "Alan Wei Park", emails: ["alan@mapleexample.example"], phones: ["778-555-0101"], note: "Proposed peace bond: no contact with Bo Lin. Sign date 2026-11-09.",
        affiliations: [{ person_id: "c1", organization_id: "c2", title: "Director" }], roles: [role("r1", "client", { case_party_id: 1 })] },
      { id: "c3", name: "Sam Defender", emails: ["sam@defender.example"], affiliations: [],
        roles: [role("r3", "client_other_counsel", { for_case_party_id: 1, note: "Client email \"Peace bond\", 2026-11-02", privileged_source: true })] },
      { id: "c4", name: "Jordan Kim", emails: ["jordan@mapleexample.example"], affiliations: [], roles: [role("r4", "witness", { case_witness_id: 1, note: "Cc on client email, 2026-11-02" })] },
      { id: "c5", name: "Sample Investigations Ltd.", emails: ["pi@example.com"], affiliations: [], roles: [role("r5", "investigator", { for_case_party_id: 1, status: "proposed", note: "Your email, 2026-11-04" })] },
      { id: "c6", name: "Dr. Sample Air-Quality", emails: ["expert@example.com"], phones: ["604-555-0140"], affiliations: [], roles: [role("r6", "expert", { case_witness_id: 2, note: "Engagement letter" })] },
      { id: "c7", name: "Richmond RCMP", phones: ["604-555-0199"], addresses: ["Sample detachment address"], affiliations: [], roles: [role("r7", "public_body", { note: "Police file card" })] },
      { id: "c8", name: "Sample Counsel E", emails: ["counsel.e@example.com"], affiliations: [], roles: [role("r8", "opposing_counsel", { case_party_id: 2, to: "2026-09-15" })] },
    ],
  }),
};
