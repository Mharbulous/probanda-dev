// Everyone in one matter's case data, for the Cast of Characters board (Cast of Characters spec
// 4.2): parties with their counsel of record per proceeding, witnesses and experts, tribunal
// members, their aliases and file codes, and the facts and documents that name each. Runs
// /matter-data's references/scripts/cast_of_characters.py, where every table name and all the
// SQL stay (#56). Read-only and lock-free.

import { runCaseScript } from "./case-script.js";

export interface CastAlias { text: string; kind: "spelling" | "file_code" }
export interface CastCounts { facts: number; documents: number }

export interface CastCounsel {
  proceeding_id: number;
  lawyer_name: string | null;
  lawyer_firm: string | null;
  lawyer_email: string | null;
  lawyer_phone: string | null;
  address: string | null;
  service_address_filed_date: string | null;
}

export interface CastParty {
  party_id: number;
  name: string;
  party_type: string | null;
  lawyer_name: string | null;
  lawyer_firm: string | null;
  lawyer_email: string | null;
  lawyer_phone: string | null;
  address: string | null;
  contact_info: string | null;
  service_address_filed_date: string | null;
  replaced_representative: string | null;
  proceedings: { proceeding_id: number; role: string }[];
  counsel_by_proceeding: CastCounsel[];
  aliases: CastAlias[];
  counsel_aliases: CastAlias[];
  counts: CastCounts;
}

export interface CastWitness {
  witness_id: number;
  name: string;
  witness_type: "fact" | "expert";
  field_of_expertise: string | null;
  retained_by_party_id: number | null;
  report_source_id: number | null;
  qualified: number | null;
  proceedings: { proceeding_id: number; called_by_party_id: number | null }[];
  aliases: CastAlias[];
  counts: CastCounts;
}

export interface CastTribunalMember {
  tribunal_member_id: number;
  name: string;
  capacity: string | null;
  tribunal_body: string | null;
  proceeding_id: number | null;
  notes: string | null;
  aliases: CastAlias[];
  counts: CastCounts;
}

export interface CastProceeding {
  proceeding_id: number;
  court: string | null;
  registry: string | null;
  file_number: string | null;
  style_of_cause: string | null;
  status: string | null;
}

export interface CastSource { source_id: number; title: string; date: string | null; file_path: string | null }

export type CastCaseData =
  | {
    status: "ok"; proceedings: CastProceeding[]; parties: CastParty[]; witnesses: CastWitness[];
    tribunal_members: CastTribunalMember[]; sources: CastSource[];
  }
  | { status: "not_applicable"; reason: string }
  | { status: "unavailable"; reason: string };

/** Everyone in the case data in `caseDataDir`, and the sources `sourceIds` names. Never throws: a failed read is `unavailable`. */
export function readCastCaseData(caseDataDir: string, sourceIds: number[], env: NodeJS.ProcessEnv = process.env): CastCaseData {
  try {
    return runCaseScript<CastCaseData>("cast_of_characters", "run", { case_data_dir: caseDataDir, source_ids: sourceIds }, env);
  } catch (err) {
    return { status: "unavailable", reason: (err as Error).message };
  }
}
