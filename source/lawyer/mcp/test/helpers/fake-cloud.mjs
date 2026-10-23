// A fake Probanda's Cloud for the practice tests: the three items functions
// (cloud/items/README.md) over HTTP on 127.0.0.1, with an in-memory ledger. It
// keeps ids, kinds, states, tags, links and hashes, matches an upsert by a small
// set of natural keys and follows the rules only as far as the local tests need
// a believable reply; the rules themselves are tested in cloud/items/tests/.
// Every request body is recorded, so a test can check what left the machine.
//
// Tests point a store at it through the env the cloud client reads:
// SUPABASE_URL and LEGAL_COMMONS_SUPABASE_KEY.

import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";

export const FAKE_KEY = "sb_secret_fake_cloud_key";

const DEFAULT_STATE = { task: "open", deadline: "active", payment: "false", signal: null };

// The upsert keys the fake matches on: [kind, parts...] where a part is tag:x, link:x or hash:x,
// and a part ending in ? is compared even when it has no value (no value matches no value).
const UPSERT_KEYS = {
  client: [["hash:client_num"]],
  matter: [["hash:file_number"], ["hash:matt_num"]],
  invoice: [["link:matter", "hash:invoice_number"]],
  signal: [["link:matter", "tag:signal_key"]],
  calendar_year: [["hash:year"]],
  affiliation: [["link:person", "link:organization", "hash:from?"]],
  matter_role: [["link:matter", "link:contact", "tag:role", "hash:case_proceeding_id?"]],
};

const stripNulls = (object) => Object.fromEntries(Object.entries(object ?? {}).filter(([, v]) => v !== null && v !== undefined));
const part = (item, p) => {
  const [where, name] = p.replace(/\?$/, "").split(":");
  return (where === "tag" ? item.tags : where === "link" ? item.links : item.hashes)?.[name] ?? null;
};

function ledger() {
  return { items: new Map(), seq: 0, results: new Map() };
}

/**
 * Starts the fake. Options on the returned object, settable at any time:
 *   refuse(write) -> question | undefined   refuse a write with this question
 *   mode: "ok" | "down" | "html" | "http500" | "nosaved" | "sync-down" | "lost-reply" | "cut-reply"
 * "down" resets the connection once the request has arrived, saving nothing. "lost-reply" saves
 * a write and then resets the connection, and "cut-reply" saves it and resets the connection
 * part-way through the 200 reply's body.
 * keepAliveTimeout: the server's idle-socket timeout in ms, 0 (never) unless a test sets it.
 */
export async function startFakeCloud(t, { keepAliveTimeout = 0 } = {}) {
  const tenants = new Map();
  const cloud = {
    requests: [],
    mode: "ok",
    refuse: undefined,
    tenants,
    env: {},
    /** The bodies of every items-write request, parsed. */
    writes() {
      return this.requests.filter((r) => r.path.endsWith("items-write")).map((r) => r.body);
    },
  };

  function tenantOf(id) {
    if (!tenants.has(id)) tenants.set(id, ledger());
    return tenants.get(id);
  }
  cloud.ledger = tenantOf;

  function apply(body) {
    const t = tenantOf(body.tenant);
    if (t.results.has(body.write_id)) return t.results.get(body.write_id);
    const question = cloud.refuse?.(body);
    if (question) {
      const refused = { saved: false, question };
      t.results.set(body.write_id, refused);
      return refused;
    }
    const missing = body.ops.find((o) => (o.op === "update" || o.op === "delete") && !(t.items.get(o.id) && !t.items.get(o.id).deleted));
    if (missing) {
      const refused = { saved: false, question: `Which ${missing.kind.replace("_", " ")} is meant? {{item:${missing.id}}} is not recorded.` };
      t.results.set(body.write_id, refused);
      return refused;
    }
    const seq = ++t.seq;
    const map = {};
    const results = {};
    const done = new Set();
    const intent = body.intent ?? {};
    const touch = (item) => { item.seq = seq; };
    const create = (op, extra = {}) => {
      const item = {
        id: op.id, kind: op.kind,
        state: "state" in op ? op.state : DEFAULT_STATE[op.kind] ?? null,
        tags: stripNulls(op.tags), links: stripNulls(op.links), hashes: { ...op.hashes },
        deleted: false, seq, created_seq: seq, ...extra,
      };
      if (op.kind === "matter" && !("billable" in item.tags)) item.tags.billable = true;
      if (op.kind === "time_entry" && !("billable" in item.tags)) {
        item.tags.billable = t.items.get(item.links.matter)?.tags.billable ?? true;
      }
      t.items.set(item.id, item);
      return item;
    };
    const live = (kind) => [...t.items.values()].filter((i) => i.kind === kind && !i.deleted);

    for (const raw of body.ops) {
      if (done.has(raw.id)) continue;
      const op = { ...raw, links: Object.fromEntries(Object.entries(raw.links ?? {}).map(([k, v]) => [k, map[v] ?? v])) };
      let out;
      if (op.op === "delete") {
        const item = t.items.get(op.id);
        // R12: a contact an affiliation or a matter role still points to stays. The ops before
        // this one in the same write have already been applied, as the cloud applies them.
        const holder = op.kind === "contact" && [...live("affiliation"), ...live("matter_role")]
          .find((i) => Object.values(i.links).includes(op.id));
        if (holder) {
          const refused = { saved: false, question: `Which contact replaces {{item:${op.id}}} on {{item:${holder.id}}}?` };
          t.results.set(body.write_id, refused);
          return refused;
        }
        item.deleted = true;
        touch(item);
        if (op.kind === "anchor") {
          for (const child of [...live("anchor_source"), ...live("deadline")]) {
            if (child.links.anchor === op.id) { child.deleted = true; touch(child); }
          }
        }
        out = [{ id: op.id, saved: true, as: op.id }];
      } else if (op.kind === "anchor") {
        const src = body.ops.find((o) => o.kind === "anchor_source" && o.links?.anchor === op.id);
        done.add(src.id);
        const same = (i) => i.links.matter === op.links.matter && i.tags.anchor_type === op.tags.anchor_type &&
          (i.hashes.party_label ?? null) === (op.hashes.party_label ?? null) &&
          (i.hashes.proceeding_label ?? null) === (op.hashes.proceeding_label ?? null);
        const anchor = live("anchor").find((i) => ["active", "conflicted", "occurred"].includes(i.state) && same(i));
        const source = (target, state) => create({ ...src, links: { anchor: target } }, { state });
        if (!anchor) {
          create({ ...op, state: "active" });
          source(op.id, "confirmed");
          out = [{ id: op.id, saved: true, as: op.id }, { id: src.id, saved: true, as: src.id }];
        } else {
          let anchorSaved = false;
          const date = op.hashes.anchor_date;
          if (intent.occurred) {
            anchor.state = "occurred";
            source(anchor.id, "confirmed");
          } else if (intent.amend || intent.resolve || (anchor.state === "conflicted" && date === anchor.hashes.anchor_date)) {
            anchor.hashes = { ...anchor.hashes, ...op.hashes };
            anchor.state = "active";
            anchorSaved = true;
            source(anchor.id, "confirmed");
          } else if (date !== anchor.hashes.anchor_date) {
            anchor.state = "conflicted";
            source(anchor.id, "conflicted");
          } else {
            source(anchor.id, "confirmed");
          }
          if ("filing" in (op.links ?? {})) anchor.links = stripNulls({ ...anchor.links, filing: op.links.filing });
          touch(anchor);
          out = [{ id: op.id, saved: anchorSaved, as: anchor.id }, { id: src.id, saved: true, as: src.id }];
        }
      } else {
        let target = null;
        if (op.op === "update") target = t.items.get(op.id);
        if (op.op === "upsert") {
          const keys = UPSERT_KEYS[op.kind];
          const usable = keys?.find((k) => k.every((p) => p.endsWith("?") || part(op, p) !== null));
          target = keys
            ? usable ? live(op.kind).find((i) => usable.every((p) => part(i, p) === part(op, p))) : undefined
            : live(op.kind).find((i) => i.id === op.id);
        }
        if (target) {
          if ("state" in op) target.state = op.state;
          target.tags = stripNulls({ ...target.tags, ...op.tags });
          target.links = stripNulls({ ...target.links, ...op.links });
          target.hashes = { ...target.hashes, ...op.hashes };
          if (op.cross) target.cross = op.cross;
          touch(target);
        } else {
          target = create(op, op.cross ? { cross: op.cross } : {});
          if (op.kind === "invoice" && op.hashes.invoice_number === null) {
            for (const other of live("invoice")) {
              if (other.links.matter === target.links.matter && other.hashes.invoice_number === null && other.created_seq !== seq) {
                other.deleted = true;
                touch(other);
              }
            }
          }
          if (op.kind === "deadline") {
            for (const other of live("deadline")) {
              const labels = ["party_label", "proceeding_label", "scenario_label"];
              if (other.id !== target.id && other.state === "active" && other.tags.deadline_type === target.tags.deadline_type &&
                (other.links.matter ?? null) === (target.links.matter ?? null) && (other.links.anchor ?? null) === (target.links.anchor ?? null) &&
                labels.every((l) => (other.hashes[l] ?? null) === (target.hashes[l] ?? null))) {
                other.state = "superseded";
                touch(other);
              }
            }
          }
        }
        out = [{ id: op.id, saved: true, as: target.id }];
      }
      for (const r of out) {
        results[r.id] = r;
        map[r.id] = r.as;
      }
    }
    // A year's earlier days give way to the days written with it.
    const years = body.ops.filter((o) => o.kind === "calendar_year").map((o) => results[o.id].as);
    for (const day of live("calendar_day")) {
      if (years.includes(day.links.calendar_year) && day.created_seq !== seq) { day.deleted = true; touch(day); }
    }
    const reply = { saved: true, ops: body.ops.map((o) => results[o.id]), seq };
    t.results.set(body.write_id, reply);
    return reply;
  }

  function sync(body) {
    const t = tenantOf(body.tenant);
    const items = [...t.items.values()]
      .filter((i) => i.seq > (body.since ?? 0))
      .sort((a, b) => a.seq - b.seq)
      .map((i) => ({
        id: i.id, kind: i.kind, state: i.state, tags: i.tags,
        links: Object.fromEntries(Object.entries(i.links).filter(([role]) => role !== "calendar_year")),
        deleted: i.deleted,
      }));
    return { items, seq: t.seq };
  }

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      cloud.requests.push({ path: req.url, headers: req.headers, raw, body });
      if (cloud.mode === "down") return res.destroy();
      if (req.headers.apikey !== FAKE_KEY) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "unauthorized" }));
      }
      if (cloud.mode === "html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<html>paused</html>");
      }
      if (cloud.mode === "http500") {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "internal error" }));
      }
      let reply;
      if (req.url.endsWith("/functions/v1/items-write")) {
        reply = cloud.mode === "nosaved" ? { ok: true } : apply(body);
        if (cloud.mode === "lost-reply") return res.destroy();
        if (cloud.mode === "cut-reply") {
          const text = JSON.stringify(reply);
          res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
          res.write(text.slice(0, 5));
          return setTimeout(() => res.destroy(), 20);
        }
      } else if (req.url.endsWith("/functions/v1/items-sync")) {
        if (cloud.mode === "sync-down") return res.destroy();
        reply = sync(body);
      } else {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  // Idle sockets stay open until close(): a store's synchronous Python can block the loop past
  // Node's 5 s default, and the overdue timer would then reset the next write's socket (#154).
  // A test of that reset passes its own keepAliveTimeout.
  server.keepAliveTimeout = keepAliveTimeout;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  cloud.env = { SUPABASE_URL: `http://127.0.0.1:${port}`, LEGAL_COMMONS_SUPABASE_KEY: FAKE_KEY, SUPABASE_SERVICE_ROLE_KEY: "" };
  cloud.close = () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
  t?.after?.(() => cloud.close());
  return cloud;
}

/** An in-memory PracticeKv: practice.db's kv_store without SQLite. */
export function memoryKv() {
  const namespaces = new Map();
  const of = (ns) => {
    if (!namespaces.has(ns)) namespaces.set(ns, new Map());
    return namespaces.get(ns);
  };
  return {
    namespaces,
    dump(names) {
      return Object.fromEntries(names.map((ns) => [ns, [...of(ns).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, value }))]));
    },
    apply(writes) {
      for (const w of writes) {
        if (w.op === "set") of(w.namespace).set(w.key, w.value);
        else of(w.namespace).delete(w.key);
      }
    },
  };
}

/** Writes items straight into a store's kv, as a read test's fixture: [{id, kind, data, tags, state, links}]. */
export function seedItems(kv, items) {
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  kv.apply(items.map((item, index) => {
    const at = new Date(base + index).toISOString();
    return {
      op: "set", namespace: "item", key: item.id,
      value: JSON.stringify({ kind: item.kind, data: item.data ?? {}, tags: item.tags ?? {}, state: item.state ?? null, links: item.links ?? {}, created_at: at, updated_at: at }),
    };
  }));
}

/** Seeds the same items into a store's kv and into the fake's ledger, as a migrated practice.db would be. */
export function seedBoth(kv, cloud, items) {
  const tenant = randomUUID();
  kv.apply([
    ["format", "items-1"], ["tenant", tenant], ["hash_key", randomBytes(32).toString("base64")], ["sync_seq", "0"],
  ].map(([key, value]) => ({ op: "set", namespace: "meta", key, value: JSON.stringify(value) })));
  seedItems(kv, items);
  const t = cloud.ledger(tenant);
  const seq = ++t.seq;
  for (const item of items) {
    t.items.set(item.id, {
      id: item.id, kind: item.kind, state: item.state ?? null, tags: item.tags ?? {}, links: item.links ?? {},
      hashes: {}, deleted: false, seq, created_seq: seq,
    });
  }
  return tenant;
}
