// Finding a matter's matter-data folder, without the query and execute backend (#186). The files
// server needs only this, so it runs its own small driver and never carries case/backend.ts. The
// pointer rules live once, in LOCATE_PY, which case/backend.ts also pastes into its helper.

import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";
import CASE_DATA_RESOLVER from "./case-data-resolver.py.js";

/** The prefix of the sidecar folder execute commits through; one left behind is a half-commit (#612). */
export const HALF_COMMIT_PREFIX = ".coclerk_execute_";

/** Follows CASE_DATA_RESOLVER in any driver, which supplies norm_join, case_data_root and resolve_case_data_dir. */
export const LOCATE_PY = String.raw`
import json, os, sys

LEGACY_ARTIFACTS_DIR = '9. AI'
EXPECTED_SCHEMA_VERSION = 5
POINTER_NAMES = ('probanda.json', 'coclerk.json')


def read_pointer(matter_root):
    # probanda.json first; coclerk.json is the legacy name, kept updated on every write so an
    # older copy of the plugin still finds the matter (spec 2026-10-16, Option 1).
    root_ptrs = [norm_join(matter_root, name) for name in POINTER_NAMES]
    legacy_ptrs = [norm_join(matter_root, LEGACY_ARTIFACTS_DIR, name) for name in POINTER_NAMES]
    pointer_path = next((p for p in root_ptrs + legacy_ptrs if os.path.exists(p)), None)
    if pointer_path is None:
        raise SystemExit("probanda.json not found; initialize the matter first.")

    with open(pointer_path, 'rb') as fh:
        raw = fh.read()
    pointer = json.loads(raw.replace(b'\x00', b'').decode('utf-8'))

    schema_version = pointer.get('schema_version')
    if schema_version != EXPECTED_SCHEMA_VERSION:
        raise SystemExit(
            "stale pointer -- re-run initialize "
            f"(the pointer is schema_version {schema_version!r}, expected {EXPECTED_SCHEMA_VERSION})")
    return root_ptrs, pointer_path in legacy_ptrs, pointer_path, pointer


def locate_case_data_dir(matter_root):
    """The matter-data folder resolve_pointer chooses, found without writing: no pointer heal, no
    legacy migration, no database version guard. A legacy (9. AI) pointer means no execute has
    run since, so skipping its migration cannot hide an execute sidecar."""
    matter_root = os.path.normpath(matter_root)
    pointer = read_pointer(matter_root)[3]
    case_data_dir, _ = resolve_case_data_dir(
        matter_root, pointer.get('case_data_dir'), case_data_root(matter_root),
        norm_join(matter_root, LEGACY_ARTIFACTS_DIR))
    return {'case_data_dir': case_data_dir}
`;

const LOCATE_DRIVER = CASE_DATA_RESOLVER + LOCATE_PY + String.raw`

print(json.dumps(locate_case_data_dir(json.load(sys.stdin)['matter_root'])))
`;

/** The matter's matter-data folder as query and execute resolve it, found without writing
 * anything (no pointer heal, no legacy migration). It may not exist. */
export function caseDataFolder(matterRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const result = runPythonDriver({
    label: "matter-data sqlite helper",
    driver: pythonDriverFile("case-locate", LOCATE_DRIVER),
    payload: JSON.stringify({ matter_root: matterRoot }),
    env,
    timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
  }) as { case_data_dir: string };
  return result.case_data_dir;
}
