// One session of ingest-concurrency.db.test.mjs's parallel test, in a process of its own: it opens a
// run, routes its files, and writes each one, calling again while another session is saving.
// argv: matter root, then each file as JSON {file_path, file_hash}.

const { callTool } = await import("../../build/dispatch.js");

const [matterRoot, ...files] = process.argv.slice(2);
const docs = files.map((f) => JSON.parse(f));
const run = (args) => callTool({}, "matter_data__ingest_run", { matter_root: matterRoot, ...args });

const { run_id } = await run({ action: "begin", mode: "attended" });
const { routed } = await run({ action: "next", run_id, routes: docs.map((d) => ({ ...d, kind: "facts" })) });
const outcomes = [];
for (const ref of routed) {
  const { result_id } = await callTool({}, "matter_data__stage_result", { result: {
    contract: "facts", contract_version: 2, ref, flags: [],
    document: { title: `Letter ${docs[Number(ref.slice(1)) - 1].file_path}`, description: "A letter", category: "correspondence", date: "2026-01-05", author_or_filing_party: "Ada Quill" },
    facts: [{ fact_key: "new:1", source_locator: "para. 1", description: `Fact of ${ref} in ${docs[0].file_hash.slice(0, 8)}.`, category: "contract", date_of_fact: "2025-03-01", evidence: null }],
    fact_positions: [], relief_items: [], relief_positions: [], source_references: [], unresolved_references: [],
  } });
  let out;
  do {
    out = await callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ref, store: "main" }, contract: "facts", result_ids: [result_id] });
  } while (out.refused === "waiting");
  outcomes.push(out.outcome);
}
await run({ action: "end", run_id });
process.stdout.write(JSON.stringify(outcomes));
