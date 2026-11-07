// Reads a matter's Cast of Characters from both stores and writes `<matter>\0. DRAFT\Cast of
// Characters.html` (Cast of Characters spec 4.1). The page is written by
// practice_data__render_cast_of_characters and at session entry (open_session), with the
// view-page marker and the overwrite guard every matter page has; the old-page sweep keeps it.
// Never re-rendered after a contact write. Writes nothing but that one page.

import { join } from "node:path";

import { caseDataFolder } from "../case/locate.js";
import { readCastCaseData, type CastCaseData } from "../case/cast-of-characters.js";
import { findDraftDir, validateMatterRoot } from "../files/matter-root.js";
import { ValidationError } from "../errors.js";
import { today } from "../knowledge/common.js";
import { rowsOf } from "../practice/items.js";
import type { PracticeStore } from "../practice/store.js";
import { nowStamp } from "../submission/forms/timings.js";
import { refuseForeignPages, writePage } from "../submission/matter-page-files.js";
import { resolveDraftDir } from "../submission/render-manifest.js";
import { VIEW_PAGE_MARKER } from "../submission/view-pages.js";
import { contact_lookup } from "../tools/practice/contacts.js";
import { matter_lookup } from "../tools/practice/reads.js";
import { loadClientsById, requireMatter } from "../tools/practice/shared.js";
import { buildCastModel, castCounts, type CastModel } from "./cast-data.js";
import { CAST_FILE, CAST_PAGE_NAME, renderCastPage } from "./cast-page.js";

/** The matter's model, from practice data and the case data `matterRoot`'s pointer file names. */
export async function readCastModel(store: PracticeStore, matterRoot: string, mattNum: string): Promise<{ model: CastModel; client: string }> {
  const items = store.items();
  const matter = requireMatter(items, { matt_num: mattNum });
  const client = String(loadClientsById(items).get(String(matter.row.client_id))?.name ?? "");
  const { contacts } = await contact_lookup(store, { matt_num: mattNum, limit: 10000 });
  const contactNames = new Map(rowsOf(items, "contact").map((row) => [String(row.id), String(row.name ?? "")]));
  const sourceIds = contacts.flatMap((c) => (c.roles as Record<string, unknown>[]))
    .map((role) => role.from_source_id).filter((id): id is number => typeof id === "number");
  let caseData: CastCaseData;
  try {
    caseData = readCastCaseData(caseDataFolder(matterRoot, store.env), sourceIds, store.env);
  } catch (err) {
    caseData = { status: "unavailable", reason: (err as Error).message };
  }
  // contact_checks' parties_without_role for this matter: a party no role's case_party_id names.
  const tied = new Set(contacts.flatMap((c) => (c.roles as Record<string, unknown>[])).map((role) => String(role.case_party_id)));
  const partiesWithoutRole = caseData.status === "ok" ? caseData.parties.map((p) => p.party_id).filter((id) => !tied.has(String(id))) : [];
  return { model: buildCastModel({ mattNum, caseData, contacts, contactNames, partiesWithoutRole, today: today() }), client };
}

export interface CastWritten {
  cast_of_characters_path: string;
  counts: ReturnType<typeof castCounts>;
}

/** Writes the page into the matter's draft folder, refusing a file this renderer did not write. Returns its path and counts only. */
export async function writeCastPage(store: PracticeStore, matterRoot: string, mattNum: string, rendered: string, revision: number | null = null): Promise<CastWritten> {
  const root = validateMatterRoot(matterRoot);
  const found = findDraftDir(root);
  if (found === undefined) throw new ValidationError(`${root} has no 0. DRAFT folder to write the ${CAST_PAGE_NAME} page in`);
  const draftDir = resolveDraftDir(found, "practice_data__render_cast_of_characters.matter_root");
  const { model, client } = await readCastModel(store, root, mattNum);
  refuseForeignPages(draftDir, [{ name: CAST_FILE, marker: VIEW_PAGE_MARKER, page: CAST_PAGE_NAME }]);
  const file = join(draftDir, CAST_FILE);
  writePage(file, renderCastPage(model, { matter: mattNum, client, revision, rendered }));
  return { cast_of_characters_path: file, counts: castCounts(model) };
}

/** practice_data__render_cast_of_characters: the page for one matter, at matter_root or the matter's recorded folder. */
export async function render_cast_of_characters(store: PracticeStore, args: Record<string, unknown>): Promise<CastWritten> {
  const matter = requireMatter(store.items(), args);
  const mattNum = typeof matter.row.matt_num === "string" ? matter.row.matt_num : "";
  if (!mattNum) throw new ValidationError("the matter has no matter number to name its Cast of Characters by");
  let root = typeof args.matter_root === "string" ? args.matter_root : undefined;
  if (root === undefined) {
    const [row] = (await matter_lookup(store, { matter_id: matter.id })).rows;
    if (typeof row?.matter_root !== "string") {
      throw new ValidationError(`no folder is recorded for ${mattNum}${row?.matter_root_error ? ` (${row.matter_root_error})` : ""}: pass matter_root`);
    }
    root = row.matter_root;
  }
  return writeCastPage(store, root, mattNum, nowStamp());
}
