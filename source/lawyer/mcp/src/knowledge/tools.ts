// The knowledge__* tools (spec §3.2, shared/knowledge-tree.md sections 4-10).
//
// knowledge__read and knowledge__list (plan Phase 7) merge the shipped and overlay
// layers: per file the shipped copy wins and a shadowed overlay copy is reported; index
// files merge by row. A document read also returns each item's effective status from
// the firm's confirmation sidecar and the session's memoized sources__check result, and
// a layout or format block validated with the firm's corrections substituted. Both are
// read-only.
//
// knowledge__write and knowledge__retire (plan Phase 8) write the firm's overlay only,
// each change under a lock file beside its target and by temp file plus rename. The
// only deletion is of a `_fetched\` PDF no excerpt records any more. Every result
// carries `shipped_from`, `plugin_version` and `build_stamp`, and nothing in the
// namespace touches the network: excerpts are checked against the fetch memo.

export { knowledgeRead, type KnowledgeReadResult } from "./read.js";
export type { ShadowedSource } from "./items.js";
export { knowledgeList, type ListEntry, type GrammarBreak, type ListArgs } from "./list.js";
export { REPO_RUN_MARKER, type WriteSeams } from "./overlay.js";
export { MAX_DOCUMENT_BYTES } from "./write-document.js";
export { knowledgeWrite } from "./write.js";
export { rosterLawyer, type LawyerAct } from "./confirm.js";
export { knowledgeRetire } from "./retire.js";
