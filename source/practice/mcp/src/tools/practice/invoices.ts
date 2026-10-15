import { ValidationError } from "../../errors.js";
import { rowsOf, type Item, type Row } from "../../practice/items.js";
import type { OpSpec } from "../../practice/ops.js";
import type { PracticeStore } from "../../practice/store.js";
import {
  effectiveCutoff,
  newId,
  nowIso,
  requireMatter,
  resolveMatter,
  type EffectiveCutoff,
  type ResolvedMatter,
} from "./shared.js";

interface InvoiceImportResult {
  imported: number;
  skipped_no_matter: number;
  skipped_negative: number;
  /** Rows Probanda's Cloud did not save; each refused matter's question is in `questions`. */
  not_saved: number;
  questions: string[];
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

function invoicesOf(items: Map<string, Item>, matterId: string): Row[] {
  return rowsOf(items, "invoice").filter((row) => row.matter_id === matterId);
}

export async function import_invoices(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<InvoiceImportResult> {
  const rows = args.rows;
  if (!Array.isArray(rows)) throw new ValidationError("import_invoices requires a rows array");
  const confirmRegression = args.confirm_regression === true;

  const result: InvoiceImportResult = { imported: 0, skipped_no_matter: 0, skipped_negative: 0, not_saved: 0, questions: [] };
  const items = store.items();

  // Pass 1: validate every row and resolve its matter. Nothing is sent yet -- this
  // is what lets the regression gate below refuse the whole import before
  // anything is saved, rather than leaving a partial import behind it.
  const byMatter = new Map<string, ResolvedImportRow[]>();
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

    const matter = resolveMatter(items, row);
    if (!matter) {
      result.skipped_no_matter += 1;
      continue;
    }
    const list = byMatter.get(matter.id) ?? [];
    list.push({ row, matter });
    byMatter.set(matter.id, list);
  }

  // Cutoff-regression gate (Step 2, 2026-08-26; L1, kept on this machine because it
  // orders dates): for every matter this import touches, compare its effective cutoff
  // (see shared.ts effectiveCutoff) before vs. after this import would apply. A matter
  // with no prior invoices has no old cutoff to regress from, so a first-ever or
  // forward-only import never trips this.
  if (!confirmRegression) {
    const regressions: string[] = [];
    for (const [matterId, entries] of byMatter) {
      const existingRows = invoicesOf(items, matterId);
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

  // Pass 2: one write per matter, so each matter's NULL-number rows are replaced once.
  // Non-NULL invoices upsert by (matter, invoice_number). date_to is sent only when the
  // incoming row carries the key: absence of that column is not evidence the billed period
  // changed, and a new invoice without it holds null.
  const importedAt = nowIso();
  let savedMatters = 0;
  for (const [matterId, entries] of byMatter) {
    const ops: OpSpec[] = entries.map(({ row }) => ({
      op: "upsert", id: newId(), kind: "invoice",
      links: { matter: matterId },
      data: {
        invoice_number: isEmpty(row.invoice_number) ? null : row.invoice_number,
        issue_date: row.issue_date ?? null,
        date_to: row.date_to,
        amount: row.amount,
        amount_paid: row.amount_paid ?? null,
        status: typeof row.status === "string" ? row.status.toLowerCase() : row.status ?? null,
        last_import_at: importedAt,
      },
    }));
    try {
      await store.write("import_invoices", {}, ops);
    } catch (err) {
      if ((err as { code?: string }).code === "refused") {
        result.not_saved += entries.length;
        result.questions.push((err as Error).message);
        continue;
      }
      if (savedMatters > 0) {
        (err as Error).message = `The invoices of ${savedMatters} matter(s) were saved before this. ${(err as Error).message}`;
      }
      throw err;
    }
    savedMatters += 1;
    result.imported += entries.length;
  }

  return result;
}

export async function invoices_query(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ rows: Row[]; last_import_at: string | null }> {
  const items = store.items();
  const matterId = args.matt_num || args.matter_id ? requireMatter(items, args).id : null;
  const rows = rowsOf(items, "invoice").filter((row) =>
    (!matterId || row.matter_id === matterId) && (!args.status || row.status === String(args.status)));
  let lastImport: string | null = null;
  for (const row of rows) {
    const value = typeof row.last_import_at === "string" ? row.last_import_at : null;
    if (value && (!lastImport || value > lastImport)) lastImport = value;
  }
  return { rows, last_import_at: lastImport };
}
