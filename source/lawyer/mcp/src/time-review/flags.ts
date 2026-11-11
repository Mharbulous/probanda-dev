// The flag rules for staged blocks (build plan slice 5; spec Part 1, "What is flagged"). A reviewer
// states the basis of a block's matter and of what goes on the bill, as values from the lists
// below. Code decides from those values whether the block is flagged: nothing the reviewer passes
// can set `flags` or `state`, so a block that states a doubt is never staged unflagged.
//
// The lists are drawn from /timecamping Step 6 (the matter side) and /vet-billable-time Steps 5
// and 6 (the bill side). They are values in a list, never a field per case.

import { ValidationError } from "../errors.js";

/** Every `matter_basis` value, and whether it flags the block. A reviewer states exactly one. */
export const MATTER_BASIS = {
  evidence_names_matter: false,
  presumption: false,
  presumption_covers_conflict: false,
  identifier_leap_uncovered: true,
  indirect_only: true,
  conflict_uncovered: true,
  no_evidence: true,
} as const;

/** Every `bill_basis` value. Each one flags the block; an empty list means no doubt. */
export const BILL_BASIS = [
  "description_inferred",
  "duration_unbounded",
  "no_evidence",
  "staff_inferred",
  "proposed_writeoff",
  "estimate",
  "late_line",
] as const;

export type MatterBasis = keyof typeof MATTER_BASIS;
export type BillBasis = (typeof BILL_BASIS)[number];
export type BlockState = "flagged" | "auto_assigned";

export function checkMatterBasis(label: string, value: unknown): MatterBasis {
  if (typeof value !== "string" || !Object.hasOwn(MATTER_BASIS, value)) {
    throw new ValidationError(`${label}: matter_basis must be one of ${Object.keys(MATTER_BASIS).join(", ")}`);
  }
  return value as MatterBasis;
}

export function checkBillBasis(label: string, value: unknown): BillBasis[] {
  if (!Array.isArray(value)) throw new ValidationError(`${label}: bill_basis must be a list (empty when there is no doubt)`);
  const seen = new Set<BillBasis>();
  for (const entry of value) {
    if (typeof entry !== "string" || !(BILL_BASIS as readonly string[]).includes(entry)) {
      throw new ValidationError(`${label}: bill_basis values must be among ${BILL_BASIS.join(", ")}`);
    }
    seen.add(entry as BillBasis);
  }
  return [...seen];
}

/** The flags and state the stated bases decide: every doubtful value, prefixed `matter:` or `bill:`. */
export function decideFlags(matterBasis: MatterBasis, billBasis: BillBasis[]): { flags: string[]; state: BlockState } {
  const flags: string[] = [];
  if (MATTER_BASIS[matterBasis]) flags.push(`matter:${matterBasis}`);
  for (const value of billBasis) flags.push(`bill:${value}`);
  return { flags, state: flags.length === 0 ? "auto_assigned" : "flagged" };
}
