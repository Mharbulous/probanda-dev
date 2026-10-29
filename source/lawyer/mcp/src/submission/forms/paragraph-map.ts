// The paragraph map (pinned-revision quick edits, CoClerk spec 2026-10-08_pinned-revision-
// quick-edits-spec.md §4.2). For one revision of one filing it records every printed paragraph the
// quick-edit route can name: its document, Part and printed number, and the record it prints, with
// a hash of that record's stored text, its placement (deployment) row and ordinal, and, for a
// proposition, the submission it prints under. drafting_forms__preview_edit resolves the
// practitioner's "paragraph 14" through the map of the revision they saw, so resolution depends
// neither on an archived mockup nor on Part 2's positional traces.
//
// The map is read off the rendered markdown's trace comments (paragraph-revision.md §2) and the
// database as it stands at that revision. A positional trace (`<!-- fact N -->`, `<!-- order N -->`)
// carries the printed number, which counts any rhetorical paragraph printed between, so the k-th
// paragraph carrying that trace in a document is resolved to the k-th row of the list the renderer
// printed, and kept only when that row's text is on the paragraph's line: a map never names a row
// the mockup did not print. A paragraph whose trace names no record this route edits is not in the map.
//
// Store: one JSON file per revision in the matter's records folder (render-manifest.ts
// paragraphMapDir), the newest MAP_KEEP kept (spec §9 question 1). A missing map refuses
// `seen_revision_unknown`, which re-presents the mockup and asks again; it never resolves against
// another revision.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { submissionDataQuery } from "../backend.js";

/** The first schema whose paragraph_revisions takes the quick-edit audit rows (v80). Below it no map is
 * written and the quick-edit tools refuse. */
export const QUICK_EDIT_MIN_SCHEMA = 80;

const MAP_KEEP = 20;

export type MapDocument = "form" | "written_argument";
export type MapEntity =
  | "facts"
  | "submissions"
  | "law_assertions"
  | "order_sought"
  | "rhetorical_paragraphs"
  | "statements_of_fact"
  | "statements_of_law";
export type DeploymentTable = "filing_facts" | "filing_submissions" | "filing_orders" | "filing_rhetoric";

export interface Deployment {
  table: DeploymentTable;
  id: number;
  ordinal: number;
  /** filing_facts and filing_rhetoric only. */
  part: string | null;
}

export interface MapEntry {
  document: MapDocument;
  /** "Part 2" for a `## PART 2: ...` heading, else the heading's own text ("" before any heading). */
  part: string;
  /** As printed, prefix included. */
  number: string;
  /** 0 for the paragraph itself; k for the k-th excerpt printed under it. */
  sub: number;
  entity: MapEntity;
  row_id: number;
  /** sha256 of the stored text the paragraph prints (an order's override when it prints one). */
  text_hash: string;
  deployment: Deployment | null;
  /** A proposition only: the submission it prints under. */
  parent: number | null;
  /** An order printed with this Writing's own wording: the filing_orders row holding the override. */
  override_id: number | null;
}

export interface ParagraphMap {
  filing_id: number;
  revision: number;
  entries: MapEntry[];
}

/** In memory only: an entry with its text and its document's title, for the preview's diff. */
export interface TextEntry extends MapEntry {
  text: string;
  title: string;
}

/** One rendered document the map reads. */
export interface MapSource {
  document: MapDocument;
  /** The document's file name without `.md`, the diff's heading. */
  title: string;
  documentType: string;
  markdown: string;
}

const LINE_NUMBER = /^([A-Z]{0,3})(\d+)\. /;
const HEADING = /^#{1,6} +(.+?)\s*$/;
const TRACE = /<!-- ([a-z_]+) (\d+) -->/g;
const PARAGRAPH_TRACES: Record<string, MapEntity> = {
  fact: "facts",
  order: "order_sought",
  fact_id: "facts",
  submission_id: "submissions",
  law_assertion_id: "law_assertions",
  order_sought_id: "order_sought",
  rhetorical_paragraph_id: "rhetorical_paragraphs",
};
const STATEMENT_TRACES: Record<string, MapEntity> = {
  statement_of_fact_id: "statements_of_fact",
  statement_of_law_id: "statements_of_law",
};
const POSITIONAL = new Set(["fact", "order"]);

/** The column holding the text each entity prints (paragraph-revision.md §1). */
export const TEXT_COLUMN: Record<MapEntity, string> = {
  facts: "postulate",
  submissions: "contention",
  law_assertions: "proposition",
  order_sought: "wording",
  rhetorical_paragraphs: "wording",
  statements_of_fact: "excerpt",
  statements_of_law: "excerpt",
};

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** "3", "part 3" and "PART 3" all read as "Part 3"; any other label compares case-insensitively. */
export function normalizePart(label: string): string {
  const m = /^\s*(?:part\s+)?(\d+)\s*$/i.exec(label);
  return m ? `Part ${m[1]}` : label.trim().toLowerCase();
}

function partLabel(heading: string): string {
  const m = /^PART\s+(\d+)/i.exec(heading);
  return m ? `Part ${m[1]}` : heading.replace(/[*_`]/g, "").trim();
}

/** The form's facts Part for a filing kind, as the v59 placement triggers choose it. */
export function factPart(kind: string): string {
  return kind === "notice_of_application" ? "part2" : "part4";
}

/** The documents the map reads from one render: the venue document (always the first) and the
 * Written Arguments companion. Witness statements and the Counsel Brief are not mapped. */
export function mapSources(docs: readonly { documentType: string; fileName: string; markdown: string }[]): MapSource[] {
  const title = (fileName: string) => fileName.replace(/\.md$/i, "");
  return docs.flatMap((doc, i): MapSource[] => {
    if (i === 0) return [{ document: "form", title: title(doc.fileName), documentType: doc.documentType, markdown: doc.markdown }];
    if (doc.documentType === "Written_arguments") {
      return [{ document: "written_argument", title: title(doc.fileName), documentType: doc.documentType, markdown: doc.markdown }];
    }
    return [];
  });
}

interface Block {
  source: MapSource;
  part: string;
  number: string;
  line: string;
  label: string | null;
  traceId: number | null;
  statements: { entity: MapEntity; id: number }[];
}

function traces(line: string): { label: string; id: number }[] {
  return [...line.matchAll(TRACE)].map((m) => ({ label: m[1], id: Number(m[2]) }));
}

function blocksOf(source: MapSource): Block[] {
  const out: Block[] = [];
  let part = "";
  let current: Block | null = null;
  for (const line of source.markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      part = partLabel(heading[1]);
      current = null;
      continue;
    }
    const numbered = LINE_NUMBER.exec(line);
    if (numbered) {
      const own = traces(line).find((t) => t.label in PARAGRAPH_TRACES);
      current = { source, part, number: numbered[1] + numbered[2], line, label: own?.label ?? null, traceId: own?.id ?? null, statements: [] };
      out.push(current);
      continue;
    }
    if (current === null) continue;
    // A Part 2 fact with citation lines carries its trace on its last, indented line.
    if (current.label === null && line.startsWith("   ")) {
      const late = traces(line).find((t) => t.label === "fact" || t.label === "fact_id");
      if (late) {
        current.label = late.label;
        current.traceId = late.id;
      }
    }
    for (const t of traces(line)) {
      if (t.label in STATEMENT_TRACES) current.statements.push({ entity: STATEMENT_TRACES[t.label], id: t.id });
    }
  }
  return out;
}

type Row = Record<string, unknown>;

function rows(dbPath: string, sql: string, params: unknown[] = []): Row[] {
  return submissionDataQuery(dbPath, sql, params).rows;
}

/** Each id's stored text for one entity, as the paragraph prints it: a statement of fact citing an
 * exhibit prints its exhibit's excerpt. */
export function readTexts(dbPath: string, entity: MapEntity, ids: readonly number[]): Map<number, string> {
  const out = new Map<number, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const marks = unique.map(() => "?").join(", ");
  const column = entity === "statements_of_fact" ? "CASE WHEN exhibit_id IS NOT NULL THEN exhibit_excerpt ELSE excerpt END" : TEXT_COLUMN[entity];
  for (const r of rows(dbPath, `SELECT id, ${column} AS text FROM ${entity} WHERE id IN (${marks})`, unique)) {
    out.set(Number(r.id), String(r.text ?? ""));
  }
  return out;
}

interface DeploymentRow {
  id: number;
  fk: number;
  document: string;
  part: string | null;
  ordinal: number;
  override: string | null;
}

/** Every placement row of one filing, per table, in (ordinal, id) order. */
export function readDeployments(dbPath: string, filingId: number): Record<DeploymentTable, DeploymentRow[]> {
  const read = (table: DeploymentTable, fk: string, part: boolean, override: boolean): DeploymentRow[] =>
    rows(
      dbPath,
      `SELECT id, ${fk} AS fk, document, ${part ? "part" : "NULL"} AS part, ordinal, ${override ? "wording_override" : "NULL"} AS override
         FROM ${table} WHERE filing_id = ? ORDER BY ordinal, id`,
      [filingId]
    ).map((r) => ({
      id: Number(r.id),
      fk: Number(r.fk),
      document: String(r.document),
      part: r.part === null ? null : String(r.part),
      ordinal: Number(r.ordinal),
      override: r.override === null ? null : String(r.override),
    }));
  return {
    filing_facts: read("filing_facts", "fact_id", true, false),
    filing_submissions: read("filing_submissions", "submission_id", false, false),
    filing_orders: read("filing_orders", "order_sought_id", false, true),
    filing_rhetoric: read("filing_rhetoric", "rhetorical_paragraph_id", true, false),
  };
}

const DEPLOYMENT_OF: Partial<Record<MapEntity, DeploymentTable>> = {
  facts: "filing_facts",
  submissions: "filing_submissions",
  order_sought: "filing_orders",
  rhetorical_paragraphs: "filing_rhetoric",
};

function toDeployment(table: DeploymentTable, row: DeploymentRow): Deployment {
  return { table, id: row.id, ordinal: row.ordinal, part: row.part };
}

/**
 * The map of one render: every paragraph of `sources` that names a record this route edits, read
 * against `dbPath` as it stands. Entries carry their text and their document's title; the stored
 * map drops both (toStored).
 */
export function buildParagraphMap(dbPath: string, filing: { id: number; kind: string }, sources: readonly MapSource[]): TextEntry[] {
  const blocks = sources.flatMap(blocksOf);
  const deployments = readDeployments(dbPath, filing.id);
  const crossedOut = new Set(
    rows(
      dbPath,
      `SELECT o.id FROM filing_orders fo JOIN order_sought o ON o.id = fo.order_sought_id
        WHERE fo.filing_id = ? AND o.crossed_out_on IS NOT NULL`,
      [filing.id]
    ).map((r) => Number(r.id))
  );

  // Positional lists, exactly as the venue renderers print them.
  const positional = (label: string, document: MapDocument): DeploymentRow[] =>
    label === "fact"
      ? deployments.filing_facts.filter((d) => d.document === document && d.part === factPart(filing.kind))
      : deployments.filing_orders.filter((d) => d.document === document && !crossedOut.has(d.fk));

  // First pass: each block's record. A positional block is the k-th of its label in its document.
  const seenPositional = new Map<string, number>();
  const resolved = blocks.flatMap((b) => {
    if (b.label === null || b.traceId === null) return [];
    const entity = PARAGRAPH_TRACES[b.label];
    if (POSITIONAL.has(b.label)) {
      const key = `${b.source.document}|${b.label}`;
      const k = seenPositional.get(key) ?? 0;
      seenPositional.set(key, k + 1);
      const row = positional(b.label, b.source.document)[k];
      return row === undefined ? [] : [{ block: b, entity, rowId: row.fk, positional: true }];
    }
    return [{ block: b, entity, rowId: b.traceId, positional: false }];
  });

  const ids = (entity: MapEntity) => [
    ...resolved.filter((r) => r.entity === entity).map((r) => r.rowId),
    ...blocks.flatMap((b) => b.statements.filter((s) => s.entity === entity).map((s) => s.id)),
  ];
  const texts = new Map<MapEntity, Map<number, string>>();
  for (const entity of Object.keys(TEXT_COLUMN) as MapEntity[]) texts.set(entity, readTexts(dbPath, entity, ids(entity)));

  const out: TextEntry[] = [];
  let lastSubmission: { document: MapDocument; part: string; id: number } | null = null;
  for (const r of resolved) {
    const b = r.block;
    const document = b.source.document;
    if (r.entity === "submissions") lastSubmission = { document, part: b.part, id: r.rowId };
    const table = DEPLOYMENT_OF[r.entity];
    const candidates = table === undefined ? [] : deployments[table].filter((d) => d.fk === r.rowId && d.document === document);
    const placement = candidates.find((d) => table !== "filing_facts" || d.part === factPart(filing.kind)) ?? candidates[0];
    const override = table === "filing_orders" && placement?.override != null ? placement.override : null;
    const base = texts.get(r.entity)?.get(r.rowId);
    if (base === undefined) continue; // the row is gone: nothing to name
    const text = override ?? base;
    if (r.positional && !b.line.includes(text)) continue; // the list does not match what printed
    const parent =
      r.entity === "law_assertions" && lastSubmission !== null && lastSubmission.document === document && lastSubmission.part === b.part
        ? lastSubmission.id
        : null;
    const common = { document, part: b.part, number: b.number, title: b.source.title };
    out.push({
      ...common,
      sub: 0,
      entity: r.entity,
      row_id: r.rowId,
      text,
      text_hash: sha256Text(text),
      deployment: table === undefined || placement === undefined ? null : toDeployment(table, placement),
      parent,
      override_id: override === null || placement === undefined ? null : placement.id,
    });
    b.statements.forEach((s, k) => {
      const statementText = texts.get(s.entity)?.get(s.id);
      if (statementText === undefined) return;
      out.push({
        ...common,
        sub: k + 1,
        entity: s.entity,
        row_id: s.id,
        text: statementText,
        text_hash: sha256Text(statementText),
        deployment: null,
        parent: null,
        override_id: null,
      });
    });
  }
  return out;
}

export function toStored(entries: readonly TextEntry[]): MapEntry[] {
  return entries.map(({ text: _text, title: _title, ...entry }) => entry);
}

function mapFile(dir: string, revision: number): string {
  return join(dir, `rev-${revision}.json`);
}

export function hasParagraphMap(dir: string, revision: number): boolean {
  return existsSync(mapFile(dir, revision));
}

/** Writes one revision's map into `dir` (temp file, then rename) and keeps the newest MAP_KEEP. */
export function writeParagraphMap(dir: string, map: ParagraphMap): void {
  mkdirSync(dir, { recursive: true });
  const file = mapFile(dir, map.revision);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(map) + "\n", "utf-8");
  renameSync(tmp, file);
  const kept = readdirSync(dir)
    .map((name) => /^rev-(\d+)\.json$/.exec(name))
    .flatMap((m) => (m ? [Number(m[1])] : []))
    .sort((a, b) => b - a);
  for (const revision of kept.slice(MAP_KEEP)) unlinkSync(mapFile(dir, revision));
}

/** The map of one revision, or null when none was written or it cannot be read. */
export function readParagraphMap(dir: string, revision: number): ParagraphMap | null {
  const file = mapFile(dir, revision);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as ParagraphMap;
    return parsed && parsed.revision === revision && Array.isArray(parsed.entries) ? parsed : null;
  } catch {
    return null;
  }
}
