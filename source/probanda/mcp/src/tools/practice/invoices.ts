import type { UnscopedAdmin } from "../../db/scope.js";
import { ValidationError } from "../../errors.js";
import { practiceEntityFor } from "../../practice-registry.js";
import {
  effectiveCutoff,
  insertRow,
  isBillable,
  nowIso,
  patchById,
  requireMatter,
  resolveMatter,
  type EffectiveCutoff,
  type ResolvedMatter,
} from "./shared.js";

const invoices = practiceEntityFor("practice_invoices");

interface InvoiceImportResult {
  imported: number;
  skipped_no_matter: number;
  skipped_negative: number;
  skipped_non_billable: number;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

interface SimRow {
  invoice_number: unknown;
  issue_date: unknown;
  date_to: unknown;
}

function toSimRow(row: Record<string, unknown>): SimRow {
  return {
    invoice_number: row.invoice_number ?? null,
    issue_date: row.issue_date ?? null,
    date_to: row.date_to ?? null,
  };
}

// Simulates the row set a matter's invoices would become after this import
// applies, WITHOUT writing anything -- mirrors the real per-row write rules
// exactly: an incoming NULL-invoice_number row purges all of the matter's
// existing NULL-number rows; an incoming non-NULL row merges onto the
// existing row sharing its invoice_number (or a prior incoming row in this
// same call, last wins); date_to is preserved from whatever it's overriding
// when the incoming row omits the key. Used only to compute the "would this
// import move the cutoff backward" comparison in the regression gate below.
function simulatePostImportRows(existingRows: Record<string, unknown>[], incomingRows: Record<string, unknown>[]): SimRow[] {
  const anyIncomingNull = incomingRows.some((row) => isEmpty(row.invoice_number));
  const byNumber = new Map<string, SimRow>();
  const nullRows: SimRow[] = [];

  for (const row of existingRows) {
    if (isEmpty(row.invoice_number)) {
      if (!anyIncomingNull) nullRows.push(toSimRow(row));
      continue;
    }
    byNumber.set(String(row.invoice_number), toSimRow(row));
  }

  for (const row of incomingRows) {
    if (isEmpty(row.invoice_number)) {
      nullRows.push(toSimRow(row));
      continue;
    }
    const key = String(row.invoice_number);
    const prior = byNumber.get(key);
    byNumber.set(key, {
      invoice_number: row.invoice_number,
      issue_date: row.issue_date ?? null,
      date_to: row.date_to !== undefined ? row.date_to : prior?.date_to ?? null,
    });
  }

  return [...nullRows, ...byNumber.values()];
}

interface ResolvedImportRow {
  row: Record<string, unknown>;
  matter: ResolvedMatter;
}

export async function import_invoices(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<InvoiceImportResult> {
  const rows = args.rows;
  if (!Array.isArray(rows)) throw new ValidationError("import_invoices requires a rows array");
  const confirmRegression = args.confirm_regression === true;

  const result: InvoiceImportResult = { imported: 0, skipped_no_matter: 0, skipped_negative: 0, skipped_non_billable: 0 };

  // Pass 1: validate every row and resolve its matter. No writes yet -- this
  // is what lets the regression gate below refuse the whole import before
  // anything commits, rather than leaving a partial import behind it.
  const resolved: ResolvedImportRow[] = [];
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new ValidationError("import_invoices rows must be objects");
    }
    const row = raw as Record<string, unknown>;

    if (typeof row.amount !== "number") throw new ValidationError("import_invoices row amount must be a number");
    if (row.amount < 0) {
      result.skipped_negative += 1;
      continue;
    }

    const matter = await resolveMatter(admin, ownerId, row);
    if (!matter) {
      result.skipped_no_matter += 1;
      continue;
    }
    // Refuse before the row ever reaches the cutoff-regression gate or a write --
    // a non-billable matter (e.g. the practitioner's own internal file) must
    // never acquire an invoice.
    if (!isBillable(matter.row)) {
      result.skipped_non_billable += 1;
      continue;
    }

    resolved.push({ row, matter });
  }

  // Cutoff-regression gate (Step 2, 2026-08-26): for every matter this import
  // touches, compare its effective cutoff (see shared.ts effectiveCutoff)
  // before vs. after this import would apply. A matter with no prior
  // invoices has no old cutoff to regress from, so a first-ever or
  // forward-only import never trips this.
  if (!confirmRegression) {
    const byMatter = new Map<string, ResolvedImportRow[]>();
    for (const entry of resolved) {
      const list = byMatter.get(entry.matter.id) ?? [];
      list.push(entry);
      byMatter.set(entry.matter.id, list);
    }

    const regressions: string[] = [];
    for (const [matterId, entries] of byMatter) {
      const existingRows = await admin.query(invoices, { matter_id: `eq.${matterId}` });
      const oldCutoff: EffectiveCutoff | null = effectiveCutoff(existingRows);
      const simulated = simulatePostImportRows(existingRows, entries.map((entry) => entry.row));
      const newCutoff: EffectiveCutoff | null = effectiveCutoff(simulated);
      if (oldCutoff && newCutoff && newCutoff.cutoff_date < oldCutoff.cutoff_date) {
        const matt = entries[0].matter.row;
        const label = matt.matt_num ?? matt.file_number ?? matterId;
        regressions.push(`${label}: ${oldCutoff.cutoff_date} -> ${newCutoff.cutoff_date}`);
      }
    }

    if (regressions.length > 0) {
      throw new ValidationError(
        `import_invoices refused: this import would move the effective billing cutoff BACKWARD for ` +
        `${regressions.length} matter(s): ${regressions.join("; ")}. No rows were written. Confirm the ` +
        `Solicitor Client folder has been searched for evidence of a more-recently-sent bill, then retry ` +
        `with confirm_regression: true.`
      );
    }
  }

  // Pass 2: write.
  const importedAt = nowIso();
  const purgedNullFor = new Set<string>();

  for (const { row, matter } of resolved) {
    const status = typeof row.status === "string" ? row.status.toLowerCase() : row.status ?? null;
    const fields: Record<string, unknown> = {
      matter_id: matter.id,
      invoice_number: row.invoice_number ?? null,
      issue_date: row.issue_date ?? null,
      amount: row.amount,
      amount_paid: row.amount_paid ?? null,
      status,
      last_import_at: importedAt,
    };
    // date_to: only set when the incoming row carries the key at all. On a
    // PATCH this preserves whatever was already stored when a routine
    // re-import comes from an export without a billing-period column --
    // absence of that column is not evidence the billed period changed. An
    // INSERT has nothing to preserve, so it always writes explicitly
    // (defaulting to null), handled below at each insertRow call.
    if (row.date_to !== undefined) fields.date_to = row.date_to;

    if (isEmpty(row.invoice_number)) {
      // NULL invoice_number: delete the matter's existing NULL-number rows once,
      // then insert fresh (invoice-tracking dedup semantics).
      if (!purgedNullFor.has(matter.id)) {
        await admin.delete(invoices, {
          matter_id: `eq.${matter.id}`,
          invoice_number: "is.null",
        });
        purgedNullFor.add(matter.id);
      }
      await insertRow(admin, ownerId, invoices, { ...fields, date_to: fields.date_to ?? null });
      result.imported += 1;
      continue;
    }

    // Non-NULL: lookup on (matter_id, invoice_number) → PATCH the
    // existing row (id stable) else INSERT (P-D9, never on_conflict).
    const existing = await admin.query(invoices, {
      matter_id: `eq.${matter.id}`,
      invoice_number: `eq.${String(row.invoice_number)}`,
    }, { limit: 2 });

    if (existing.length >= 1) {
      await patchById(admin, ownerId, invoices, String(existing[0].id), fields);
    } else {
      await insertRow(admin, ownerId, invoices, { ...fields, date_to: fields.date_to ?? null });
    }
    result.imported += 1;
  }

  return result;
}

export async function invoices_query(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[]; last_import_at: string | null }> {
  const filters: Record<string, string> = {};
  if (args.matt_num || args.matter_id) {
    const matter = await requireMatter(admin, ownerId, args);
    filters.matter_id = `eq.${matter.id}`;
  }
  if (args.status) filters.status = `eq.${String(args.status)}`;

  const rows = await admin.query(invoices, filters, { limit: 1000 });
  let lastImport: string | null = null;
  for (const row of rows) {
    const value = typeof row.last_import_at === "string" ? row.last_import_at : null;
    if (value && (!lastImport || value > lastImport)) lastImport = value;
  }
  return { rows, last_import_at: lastImport };
}
