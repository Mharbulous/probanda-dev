// The companion documents a layout may name (shared/declared-layout.md). Its own module, importing
// nothing, so the tool schemas can read it without pulling declared-layout.ts's imports into every bundle.
export const COMPANIONS: readonly string[] = ["written-arguments"];
