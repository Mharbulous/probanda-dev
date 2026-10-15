// The practice store: local reads over practice.db's items, and the one write
// sequence through Probanda's Cloud (docs/Plans/2026-10-14_practice-db-conversion.md,
// "One write, step by step"):
//
//   1. the tool builds its ops (the guard runs here; nothing is stored or sent on a refusal);
//   2. the write is stored under `pending`;
//   3. it is posted to items-write;
//   4. saved: in one local transaction, each saved op's data is written under its `as` id,
//      items-sync is applied from the stored sync_seq, and the pending entry is removed;
//   5. refused: the pending entry is removed and the question, its items described, is the error.
//
// A cloud that does not answer at step 3 leaves nothing anywhere. A failure after the cloud
// saved leaves the pending entry, which the next practice tool call replays with its write_id.
// Reads never call the cloud.

import { randomBytes, randomUUID } from "node:crypto";

import { DataServerError, ValidationError } from "../errors.js";
import type { KvWrite } from "../kv/backend.js";
import { CloudUnreachableError, callItems } from "./cloud.js";
import { SqlitePracticeKv, type PracticeKv } from "./backend.js";
import { describe, rowsOf, type Item, type Row } from "./items.js";
import { buildOp, guardRaw, type CloudOp, type OpSpec } from "./ops.js";

const ITEM = "item";
const META = "meta";
const PENDING = "pending";
const FORMAT = "items-1";

/** The local side of one op: what to store under its `as` id once saved. */
interface LocalOp {
  kind: string;
  /** The fields the tool supplied, null included. */
  data: Record<string, unknown>;
  /** Every field the op names: a new item holds each, null when not supplied. */
  fields: string[];
}

interface PendingWrite {
  queued_at: string;
  write: { tenant: string; write_id: string; store: "practice"; tool: string; intent: Record<string, unknown>; ops: CloudOp[] };
  local: Record<string, LocalOp>;
}

export interface OpResult {
  id: string;
  saved: boolean;
  as: string;
}

export interface Snapshot {
  items: Map<string, Item>;
  meta: Record<string, string>;
  pending: Map<string, PendingWrite>;
}

export interface ReplayedWrite {
  write_id: string;
  tool: string;
  saved: boolean;
}

interface SyncItem {
  id: string;
  kind: string;
  state: string | null;
  tags: Record<string, unknown>;
  links: Record<string, string>;
  deleted: boolean;
}

function definedOnly(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

function newData(local: LocalOp): Record<string, unknown> {
  return Object.fromEntries(local.fields.map((field) => [field, field in local.data ? local.data[field] : null]));
}

function sameMetadata(item: Item, entry: SyncItem): boolean {
  return item.state === entry.state && JSON.stringify(item.tags) === JSON.stringify(entry.tags) &&
    JSON.stringify(item.links) === JSON.stringify(entry.links);
}

function isOpResult(value: unknown): value is OpResult {
  const r = value as OpResult;
  return r !== null && typeof r === "object" && typeof r.id === "string" && typeof r.saved === "boolean" && typeof r.as === "string";
}

export class PracticeStore {
  constructor(
    readonly env: NodeJS.ProcessEnv = process.env,
    private readonly kv: PracticeKv = new SqlitePracticeKv(env)
  ) {}

  snapshot(): Snapshot {
    const dump = this.kv.dump([ITEM, META, PENDING]);
    const items = new Map<string, Item>();
    for (const { key, value } of dump[ITEM] ?? []) items.set(key, JSON.parse(value) as Item);
    const meta: Record<string, string> = {};
    for (const { key, value } of dump[META] ?? []) meta[key] = JSON.parse(value) as string;
    const pending = new Map<string, PendingWrite>();
    for (const { key, value } of dump[PENDING] ?? []) pending.set(key, JSON.parse(value) as PendingWrite);
    return { items, meta, pending };
  }

  /** Every item, for the reads. */
  items(): Map<string, Item> {
    return this.snapshot().items;
  }

  /** Every item of one kind, flattened to its row. */
  rows(kind: string): Row[] {
    return rowsOf(this.items(), kind);
  }

  pendingCount(): number {
    return this.snapshot().pending.size;
  }

  /**
   * One write: the ops of one tool call, saved by the cloud or not at all. Returns each op's
   * result and the items as they stand afterwards. A refusal throws its question.
   */
  async write(
    tool: string,
    intent: Record<string, unknown>,
    specs: OpSpec[]
  ): Promise<{ ops: OpResult[]; items: Map<string, Item> }> {
    const snap = this.snapshot();
    const init: KvWrite[] = [];
    const meta = { ...snap.meta };
    const ensure = (key: string, value: string) => {
      if (meta[key] !== undefined) return;
      meta[key] = value;
      init.push({ op: "set", namespace: META, key, value: JSON.stringify(value) });
    };
    ensure("format", FORMAT);
    ensure("tenant", randomUUID());
    ensure("hash_key", randomBytes(32).toString("base64"));
    ensure("sync_seq", "0");

    const hashKey = Buffer.from(meta.hash_key, "base64");
    guardRaw(tool, "the tool name");
    for (const [flag, value] of Object.entries(intent)) guardRaw(value, `the ${flag} flag`);
    const ops = specs.map((spec) => buildOp(spec, hashKey));
    const local: Record<string, LocalOp> = {};
    for (const spec of specs) {
      if (spec.data) local[spec.id] = { kind: spec.kind, data: definedOnly(spec.data), fields: Object.keys(spec.data) };
    }
    const pending: PendingWrite = {
      queued_at: new Date().toISOString(),
      write: { tenant: meta.tenant, write_id: randomUUID(), store: "practice", tool, intent, ops },
      local,
    };

    const writeId = pending.write.write_id;
    this.kv.apply([...init, { op: "set", namespace: PENDING, key: writeId, value: JSON.stringify(pending) }]);

    let reply: Record<string, unknown>;
    try {
      reply = await callItems(this.env, "write", pending.write);
      if (reply.saved !== true && reply.saved !== false) throw new CloudUnreachableError("a reply with no saved field");
    } catch (err) {
      // Nothing reached the cloud, or nothing it said can be taken as a save.
      this.kv.apply([{ op: "delete", namespace: PENDING, key: writeId }]);
      throw err;
    }

    if (reply.saved === false) {
      this.kv.apply([{ op: "delete", namespace: PENDING, key: writeId }]);
      throw new ValidationError(this.fillQuestion(String(reply.question ?? ""), snap.items, local), "refused");
    }
    return this.applySaved(writeId, pending, reply, snap);
  }

  /** Replays every pending write with its own write_id, oldest first. A cloud that does not answer leaves them pending. */
  async replayPending(): Promise<ReplayedWrite[]> {
    const replayed: ReplayedWrite[] = [];
    const queue = [...this.snapshot().pending.entries()].sort(([, a], [, b]) => a.queued_at.localeCompare(b.queued_at));
    for (const [writeId, pending] of queue) {
      const reply = await callItems(this.env, "write", pending.write);
      if (reply.saved === false) {
        this.kv.apply([{ op: "delete", namespace: PENDING, key: writeId }]);
        replayed.push({ write_id: writeId, tool: pending.write.tool, saved: false });
      } else if (reply.saved === true) {
        await this.applySaved(writeId, pending, reply, this.snapshot());
        replayed.push({ write_id: writeId, tool: pending.write.tool, saved: true });
      } else {
        throw new CloudUnreachableError("a reply with no saved field");
      }
    }
    return replayed;
  }

  private async applySaved(
    writeId: string,
    pending: PendingWrite,
    reply: Record<string, unknown>,
    snap: Snapshot
  ): Promise<{ ops: OpResult[]; items: Map<string, Item> }> {
    const results = Array.isArray(reply.ops) && reply.ops.every(isOpResult) ? (reply.ops as OpResult[]) : null;
    if (!results) throw this.notApplied(writeId, "its reply named no op results");

    let sync: Record<string, unknown>;
    try {
      sync = await callItems(this.env, "sync", { tenant: pending.write.tenant, store: "practice", since: Number(snap.meta.sync_seq ?? 0) });
    } catch (err) {
      throw this.notApplied(writeId, (err as Error).message);
    }
    if (!Array.isArray(sync.items) || typeof sync.seq !== "number") throw this.notApplied(writeId, "its changes could not be read back");

    const items = new Map(snap.items);
    const changed = new Set<string>();
    const base = Date.now();
    results.forEach((result, index) => {
      const local = pending.local[result.id];
      if (!result.saved || !local) return;
      const now = new Date(base + index).toISOString();
      const current = items.get(result.as);
      items.set(result.as, current
        ? { ...current, data: { ...current.data, ...local.data }, updated_at: now }
        : { kind: local.kind, data: newData(local), tags: {}, state: null, links: {}, created_at: now, updated_at: now });
      changed.add(result.as);
    });
    const now = new Date(base + results.length).toISOString();
    for (const entry of sync.items as SyncItem[]) {
      if (entry.deleted) {
        if (items.delete(entry.id)) changed.add(entry.id);
        continue;
      }
      const current = items.get(entry.id);
      items.set(entry.id, {
        kind: entry.kind,
        data: current?.data ?? {},
        tags: entry.tags ?? {},
        state: entry.state ?? null,
        links: entry.links ?? {},
        created_at: current?.created_at ?? now,
        updated_at: current && sameMetadata(current, entry) ? current.updated_at : now,
      });
      changed.add(entry.id);
    }

    const writes: KvWrite[] = [];
    for (const id of changed) {
      const item = items.get(id);
      writes.push(item ? { op: "set", namespace: ITEM, key: id, value: JSON.stringify(item) } : { op: "delete", namespace: ITEM, key: id });
    }
    writes.push({ op: "set", namespace: META, key: "sync_seq", value: JSON.stringify(String(sync.seq)) });
    writes.push({ op: "delete", namespace: PENDING, key: writeId });
    this.kv.apply(writes);
    return { ops: results, items };
  }

  private notApplied(writeId: string, detail: string): DataServerError {
    return new DataServerError(
      `Probanda's Cloud saved this write, but it could not be applied to practice.db (${detail}). ` +
        `It is kept as pending write ${writeId} and is applied by the next practice tool call.`,
      "write_pending"
    );
  }

  /** The question with each {{item:<id>}} replaced by that item's local description. */
  private fillQuestion(question: string, items: Map<string, Item>, local: Record<string, LocalOp>): string {
    return question.replace(/\{\{item:([^}]+)\}\}/g, (_, id: string) => describe(id, items.get(id) ?? local[id]));
  }
}
