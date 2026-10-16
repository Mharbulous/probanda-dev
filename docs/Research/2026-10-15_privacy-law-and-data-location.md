# Privacy law and data-location facts for holding lawyer accounts

Research for issue #56. Facts only, each with a source URL. No decision or recommendation is made here.

Scope assumed from the ticket: Probanda (a BC company) would hold, in its own cloud (Supabase), lawyer account records (identity and verified practising status for BC lawyers), per-account usage logs for shared services, and the text of suggestions lawyers submit about the product. Users are BC lawyers; the company operates from BC.

## 1. Which privacy statutes apply, and what each requires

### Which statute governs

- BC's *Personal Information Protection Act* (PIPA), SBC 2003, c. 63, is the private-sector statute: "This Act applies to every organization" (private sector, BC) — full text: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03063_01
- PIPA was declared "substantially similar" to Part 1 of the federal *Personal Information Protection and Electronic Documents Act* (PIPEDA) by the Governor in Council in the *Organizations in the Province of British Columbia Exemption Order*, SOR/2004-220 (made October 12, 2004). The order exempts an organization to which PIPA applies from Part 1 of PIPEDA "in respect of the collection, use and disclosure of personal information that occurs within the Province of British Columbia," except for a federal work, undertaking or business. Text: https://laws-lois.justice.gc.ca/PDF/SOR-2004-220.pdf (also at https://www.canlii.org/en/ca/laws/regu/sor-2004-220/latest/sor-2004-220.html)
- The Office of the Privacy Commissioner of Canada (OPC) confirms the practical effect: BC, Alberta and Quebec each have a substantially-similar private-sector law, and "organizations operating within these provinces are generally exempt from PIPEDA with respect to the collection, use or disclosure of personal information that occurs within that province." PIPEDA still governs (a) a federal work, undertaking or business, and (b) a transaction that is itself an interprovincial or international transfer of personal information (the OPC's example: selling mailing lists between provinces, using a national credit bureau based in another province, sending customer data to a loyalty program abroad). Source: https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/r_o_p/prov-pipeda/ and https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/r_o_p/02_05_d_26/

Fact, not inferred further: a BC company holding BC lawyers' data, where the collection/use/disclosure occurs within BC, is governed by PIPA, not PIPEDA, because of the substantially-similar designation. Whether any particular data flow in Probanda's actual architecture is itself an interprovincial or international "transaction" (which would pull that specific flow back under PIPEDA) is not established here — see Unestablished.

### What PIPA requires

All section references are to the PIPA text at https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03063_01

- **Notice**: s. 10(1) requires an organization to notify the individual, on or before collecting personal information, of the purposes for the collection (verbally or in writing).
- **Consent**: s. 6(1) prohibits collection, use or disclosure of personal information without consent, unless the Act authorizes collection/use/disclosure without consent or consent is deemed under s. 8. Section 7(1) requires that the notice obligations be met for consent to be valid.
- **Purpose limitation**: s. 11 (collection), s. 14 (use) and s. 17 (disclosure) each limit the organization to purposes a reasonable person would consider appropriate, and generally to the purposes disclosed under s. 10(1) (or otherwise permitted by the Act).
- **Retention**: s. 35(2) requires destruction of personal information "as soon as it is reasonable to assume" that the purpose for which it was collected is no longer being served by retention and retention is no longer necessary for legal or business purposes.
- **Right of access**: s. 23(1) gives an individual the right to request their own personal information under the organization's control, and information about how it has been and is being used and to whom it has been disclosed.
- **Security**: s. 34 requires "reasonable security arrangements" against unauthorized access, collection, use, disclosure, copying, modification, disposal or similar risks. OIPC guidance states this is not a single fixed standard: the required safeguards scale with the sensitivity of the information. Source: https://www.oipc.bc.ca/media/17217/privacyright-webinar-notes-security-safeguards.pdf

### Breach notification under PIPA — not mandatory

PIPA's text, fetched directly, contains no breach-notification section comparable to PIPEDA's. A web search targeted at this question returned the same conclusion from secondary commentary, but the primary-source fact is the absence of any such section in the statute at the BC Laws URL above: PIPA has no provision requiring an organization to report a breach to the Commissioner or to notify affected individuals. This is distinct from BC's *Freedom of Information and Protection of Privacy Act* (FIPPA), which does impose a breach-notification duty, but FIPPA applies only to public bodies, not to a private company like Probanda.

### What PIPEDA requires (for comparison, and for any flow where it does apply)

- **Breach notification is mandatory under PIPEDA.** An organization must report to the OPC, and notify affected individuals, a breach of security safeguards that creates "a real risk of significant harm," and must keep records of every breach. Source: https://www.priv.gc.ca/en/privacy-topics/business-privacy/breaches-and-safeguards/privacy-breaches-at-your-business/gd_pb_201810/ (statutory basis: PIPEDA Division 1.1, ss. 10.1–10.3, and the *Breach of Security Safeguards Regulations*, SOR/2018-64: https://gazette.gc.ca/rp-pr/p2/2018/2018-04-18/html/sor-dors64-eng.html). It is an offence to knowingly contravene these reporting, notification or record-keeping duties.

### Business-capacity data — the "business contact information" / "contact information" carve-out

PIPA's definitions section (s. 1) defines "contact information" as information to enable an individual to be contacted at a place of business (name, position/title, business telephone number, address, email, fax) and excludes it from the definition of "personal information." OIPC/secondary guidance (used here only to point at the statutory text, which is the citation given) states the carve-out applies only where the collection, use or disclosure is for the sole purpose of contacting the individual in relation to their business responsibilities — not, for example, for marketing to them as a consumer. Statutory source: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03063_01 (s. 1, definition of "contact information"). This carve-out is narrow: it removes bare business-contact particulars from the Act's scope, but does not generally remove a lawyer's identity and verified-practising-status record, or a per-account usage log, or free-text suggestion content, from the definition of "personal information" merely because the data subject is a professional acting in that capacity — no provision found exempts those categories on that basis.

## 2. Requirements and professional expectations on data location

### Statute

Neither PIPA nor PIPEDA, in the sections identified above, imposes a general data-residency rule (no requirement found that personal information of a BC individual be stored or processed only in Canada or only in BC). PIPA s. 34 requires reasonable security safeguards regardless of where the data is processed; no separate cross-border-specific provision was found in the Act's text.

### OIPC BC

- OIPC guidance (reached via its guidance-documents index, https://www.oipc.bc.ca/documents/guidance-documents/) states organizations should notify individuals when their personal information will be transferred outside Canada, and should assess, including in a privacy impact assessment, whether personal information should be disclosed outside the country at all — because once it leaves Canada, Canadian law (and PIPA's protections) no longer apply to it, and contractual or technical safeguards may not fill that gap. PIPA's own text does not expressly regulate trans-border transfers; the OIPC has recommended (in its statutory-review submissions) that the Act be amended to address this explicitly, which indicates it currently is not addressed by the Act itself. Sources: BC government guidance on disclosures outside Canada, https://www2.gov.bc.ca/gov/content/governments/services-for-government/information-management-technology/privacy/privacy-impact-assessments/guidance-on-disclosures-outside-of-canada ; OIPC statutory-review submission, https://www.oipc.bc.ca/documents/legislative-submissions/1563
- PIPA s. 34's security-safeguards duty continues to apply to personal information transferred to a service provider, but OIPC commentary (in the same statutory-review material) notes PIPA does not currently hold an organization expressly accountable for what a service provider does with data once transferred — again, flagged by the OIPC as a gap, not a requirement presently in the Act.

### Law Society of BC

The Law Society of BC has published cloud-computing guidance specifically for lawyers:
- "Cloud computing due diligence guidelines," Practice Resource DM56523: https://www.lawsociety.bc.ca/Website/media/Shared/docs/practice/resources/guidelines-cloud.pdf
- "Cloud computing checklist," v. 4.0 (updated January 2023): https://www.lawsociety.bc.ca/Website/media/Shared/docs/practice/resources/checklist-cloud.pdf
- Underlying 2011 report: "Report of the Cloud Computing Working Group": https://www.lawsociety.bc.ca/getContentAsset/b985a3d7-9540-4e46-9664-17fadc93296e/dfc3d011-8f63-43f6-9ed8-4b444333a1d0/CloudComputing.pdf?language=en-CA

These documents state (per the guidelines-cloud.pdf, as surfaced through search snippets of that document's own text — the PDF itself could not be parsed by the fetch tool used here, so this is reported with that caveat):
- A lawyer's duty to protect client confidentiality and privilege continues when client information is held by a cloud provider; the lawyer must ensure the client's ownership of its information does not pass to the provider or a third party.
- A lawyer should read the provider's terms of service, SLA, privacy policy and security policy, and should try to ascertain where the data is stored/hosted, weighing the political and legal risks of foreign storage.
- If a cloud provider will locate client records outside BC (or outside Canada), the lawyer should advise the client of this at the outset of the retainer, so the client can decide whether to use that lawyer, and should consider recording the client's consent in writing. The guidance frames this as a disclosure obligation to the client, not a prohibition on foreign storage.
- Notice to the client should include the risk that a foreign state could seek "lawful access" to the data under its own law.

These are stated in the Law Society's own practice resources as guidelines/due-diligence checklists for lawyers using cloud services for client files, not as Law Society Rules provisions located and confirmed in this research. No Law Society Rule section number (as opposed to practice-resource guidance) was confirmed from a primary rules citation in this research; see Unestablished.

## 3. Supabase regions and project-region policy

Primary source: https://supabase.com/docs/guides/platform/regions

- Supabase offers three "general" regions that place a project into an available AWS region within a broader area (Americas / Europe / APAC) without guaranteeing a specific jurisdiction, plus 16 named specific regions, for 19 selectable options in total. The specific regions include `ca-central-1` (Canada Central), along with multiple US, European, Asia-Pacific and South American (`sa-east-1`) regions.
- The region is chosen at project creation. Supabase's documentation (per the page's content) advises choosing the region closest to the project's users for performance.
- A Supabase project's region is fixed at creation and cannot be changed afterward. To move to a different region, the documented path is to create a new project in the target region and migrate the schema, data, Storage files and Edge Functions into it, then switch the application to the new project's URL and API keys. Source for the migration mechanic: https://supabase.com/docs/guides/platform/regions (the regions page itself does not state a region-change procedure beyond this; project-to-project migration is documented separately under Supabase's platform migration guides, not fetched in full here — see Unestablished).

### What the repo records about region

- The repository's only Supabase config file is `cloud/legal-commons/supabase/config.toml`, which sets `project_id = "nbzkuhgiqscjkypedqff"` and per-function `verify_jwt` settings for the legal-commons pool project's Edge Functions. It does not state a region.
- No other file under `cloud/` or `docs/` in this repository records a Supabase project region, in any format (no `config.toml`, project-ref file, or documented setting naming a region was found).
- The legal-commons project referenced by that `project_id` is the layer-3 shared legal-commons pool (per `cloud/legal-commons/README.md`), not a project described anywhere in this repo as holding lawyer account records, usage logs or suggestion text; no Supabase project for that latter data is identified in the repo at all.
- Conclusion stated as fact, not inference: the repo does not record the region of any Supabase project, including whether one exists for lawyer accounts/usage logs/suggestions. Only the Supabase dashboard (or an authenticated CLI call, which this research was not authorized to run) can confirm any project's actual region.

## Unestablished

- Whether, under PIPA, Probanda's planned collection of lawyer account identity/verified-practising-status data, usage logs, and suggestion text would be treated by the OIPC as occurring "within the Province of British Columbia" for every data flow (which would keep it under PIPA) versus any flow that might itself constitute an interprovincial or international "transaction" within OPC's PIPEDA carve-out — not addressed by any primary source found.
- The precise text of the Law Society of BC's cloud-computing guidelines and checklist PDFs could not be directly parsed by the fetch tool used in this research; the claims in section 2 about their content are drawn from search-engine-surfaced excerpts of those same documents' own text, not a full direct read of the PDF content.
- Whether any Law Society of BC Rule (as distinct from its non-binding practice-resource guidance) imposes a binding data-location or client-disclosure obligation — no specific Rule section number was confirmed from a primary Law Society Rules citation.
- Whether BC's PIPA statutory-review process (referenced in OIPC submissions) has resulted, or will result, in an amendment adding mandatory breach notification or cross-border-transfer provisions — not established as currently in force; the statute's text as fetched contains neither.
- Whether the data subject's status as "a professional acting in a business capacity" changes PIPA's application to the three described data types beyond the narrow "contact information" carve-out in s. 1 — no further provision distinguishing professional/business-capacity data subjects generally was found in the Act.
- Supabase's documented procedure for migrating an existing project to a different region (beyond the general description on the regions page) was not independently fetched and confirmed in full.
