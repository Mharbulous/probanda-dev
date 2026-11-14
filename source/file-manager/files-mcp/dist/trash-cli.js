// build-stamp: f0e6ffeaa16c

// src/trash-cli.ts
import { pathToFileURL } from "node:url";

// ../../mcp-shared/errors.js
var DataServerError = class extends Error {
  constructor(message, code = "data_error", details) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
};
var ValidationError = class extends DataServerError {
};
var PythonTimeoutError = class extends DataServerError {
  constructor(message) {
    super(message, "python_timeout");
  }
};

// src/file_ops/trash.ts
import {
  appendFileSync,
  existsSync as existsSync4,
  lstatSync,
  mkdirSync as mkdirSync2,
  readdirSync as readdirSync4,
  realpathSync as realpathSync4,
  renameSync,
  statSync as statSync3
} from "node:fs";
import { homedir } from "node:os";
import { win32 as pathWin325 } from "node:path";

// src/files/matter-root.ts
import { existsSync as existsSync2, readdirSync as readdirSync2, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join as join3, normalize, resolve, win32 as pathWin32 } from "node:path";

// src/python-driver.ts
import { createHash } from "node:crypto";
import { existsSync, linkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function pythonDriverFile(name, source) {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const p = join(tmpdir(), `coclerk-${name}-${hash}.py`);
  if (existsSync(p)) return p;
  const temp = `${p}.${process.pid}.tmp`;
  writeFileSync(temp, source, "utf-8");
  try {
    linkSync(temp, p);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  } finally {
    unlinkSync(temp);
  }
  return p;
}

// src/python-spawn.ts
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join2 } from "node:path";
var pythonStarts = { count: 0 };
function runPythonDriver(opts) {
  const { label, driver, payload, env, timeoutMs, extraEnv, timeoutAdvice, stagingDescription } = opts;
  const candidates = [env.COCLERK_PYTHON, "python", "python3"].filter(Boolean);
  let lastErr = "";
  const tag = randomBytes(8).toString("hex");
  for (const py of candidates) {
    pythonStarts.count++;
    const res = spawnSync(py, [driver], {
      input: payload,
      encoding: "utf-8",
      // spawnSync's 1 MB default is too small: one time-pipeline value is ~1.6 MB after the
      // Chrometa import. Overflow still fails loudly, just at a realistic threshold.
      maxBuffer: 64 * 1024 * 1024,
      // PYTHONIOENCODING: host Python's stdout otherwise defaults to the Windows locale encoding,
      // which mangles a non-ASCII exception message on the error path. TMPDIR pins Python's temp
      // dir (it reads TMPDIR first) to Node's, so removeKilledStaging looks where the helper staged.
      env: { ...env, PYTHONIOENCODING: "utf-8", TMPDIR: tmpdir2(), ...extraEnv, COCLERK_STAGING_TAG: tag },
      timeout: timeoutMs
    });
    if (res.error) {
      lastErr = res.error.message;
      const code = res.error.code;
      if (code === "ENOENT") continue;
      if (code === "ETIMEDOUT") {
        throw new PythonTimeoutError(
          `${label} (${py}) did not finish within ${timeoutMs}ms and was killed.` + (timeoutAdvice ? ` ${timeoutAdvice}` : "") + removeKilledStaging(tag, stagingDescription)
        );
      }
      throw new DataServerError(`${label} failed (${py}): ${res.error.message}`);
    }
    if (res.status !== 0) {
      throw new DataServerError(`${label} (${py}) exited ${res.status}: ${(res.stderr || "").trim()}`);
    }
    try {
      return JSON.parse(res.stdout);
    } catch (err) {
      throw new DataServerError(
        `${label} (${py}) produced unparseable output: ${err.message}. Output began: ${JSON.stringify(res.stdout.slice(0, 200))}`
      );
    }
  }
  throw new DataServerError(
    `No Python interpreter found for the ${label} (tried ${candidates.join(", ")}). Install Python 3 or set COCLERK_PYTHON. Last error: ${lastErr}`
  );
}
function removeKilledStaging(tag, description = "staging copy of the database") {
  const pattern = new RegExp(`^coclerk_[a-z_]+_${tag}_`);
  const failed = [];
  for (const name of readdirSync(tmpdir2())) {
    if (!pattern.test(name)) continue;
    const p = join2(tmpdir2(), name);
    try {
      rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (err) {
      failed.push(`${p} (${err.message})`);
    }
  }
  return failed.length ? ` Its ${description} could not be removed; delete it by hand: ${failed.join("; ")}.` : "";
}

// src/python-timeout.ts
var READ_TIMEOUT_MS = 2e4;
function pythonTimeoutMs(env, defaultMs, variable) {
  const override = env[variable];
  if (override === void 0) return defaultMs;
  const ms = Number(override);
  if (!(ms > 0)) throw new ValidationError(`${variable} must be a positive number of milliseconds: ${override}`);
  return ms;
}

// src/case/case-data-resolver.py.ts
var case_data_resolver_py_default = `"""case_data_resolver.py \u2014 where a matter's case data lives (MODULE).

The one resolver of a matter's matter-data folder (ADR 0013). Two readers take it:
resolve_paths.py imports it, and the data server's build pastes this file's text
(source/lawyer/mcp/scripts/resolver.mjs) at the head of two embedded Python
programs: the pointer read's driver in source/lawyer/mcp/src/case/locate.ts, which
the files server runs, and the backend's helper in case/backend.ts. So the server
still imports nothing from the skill tree at run time.

BYPASS-FREE BY DESIGN: this file holds no pointer write-back, no legacy migration and
no schema-version guard, so it has nothing a migrate_only flag could skip. The guard
bypass stays in resolve_paths.resolve_pointer, reached only from migrate_engine.py
(design-decisions.md #27). Never add resolve_pointer, or anything that imports
resolve_paths, here: locate.ts and the backend embed this file whole.

E1-ONLY, as resolve_paths.py: it stages temp copies of main.sqlite. See ../scripts.md.

Standard library only.
"""

import os
import re
import shutil
import sqlite3
import tempfile

CASE_DATA_FOLDER = '0. CASE DATA'                       # the matter's case-data folder, and the firm root's name
ENV_ROOT_OVERRIDE = 'COCLERK_CASE_DATA_ROOT'            # replaces computed root when set


def staging_prefix(kind):
    """Temp-folder prefix \`coclerk_<kind>_<tag>_\`, tagged with the data runtime's per-call
    COCLERK_STAGING_TAG so a call killed on timeout has its folders removed by tag (#1060).
    Run by hand there is no tag, and the prefix is the untagged \`coclerk_<kind>_\`."""
    tag = os.environ.get('COCLERK_STAGING_TAG')
    return 'coclerk_%s_%s_' % (kind, tag) if tag else 'coclerk_%s_' % kind


def is_absolute(p):
    """True for a Windows drive-letter path, a UNC path, or a POSIX absolute path."""
    if not p:
        return False
    if re.match(r'^[A-Za-z]:[\\\\/]', p):
        return True
    if p.startswith('\\\\\\\\') or p.startswith('//'):
        return True
    return p.startswith('/')


def norm_join(base, *parts):
    """Path join tolerant of both separators; normalized to native form."""
    joined = os.path.join(base, *parts)
    return os.path.normpath(joined.replace('\\\\', os.sep).replace('/', os.sep))


def sanitize_short_name(name):
    """Strip illegal filename characters and trim to 60 chars."""
    cleaned = re.sub(r'[<>:"/\\\\|?*\\x00-\\x1f]', '', name or '').strip()
    return cleaned[:60].strip()


def parse_folder_name(matter_folder):
    """Fallback identity from the matter folder name.

    Patterns like "<client>.<matter> Short Name" or "<matter> Short Name": the
    leading token (client.matter or matter-only) is the matter reference,
    stored under the \`matter_id\` metadata key; the remainder is the short
    name. Returns (matter_id, short_name).
    """
    base = os.path.basename(os.path.normpath(matter_folder))
    m = re.match(r'^\\s*((?:\\d+\\.)?[A-Za-z]?\\d+[A-Za-z0-9.\\-]*)\\s+(.*)$', base)
    if m:
        return m.group(1).strip(), sanitize_short_name(m.group(2))
    return sanitize_short_name(base), ''


def case_data_root(matter_root):
    """The firm-level case data root: env override, else the library's '0. CASE DATA'.
    A matter not yet relocated keeps its folder here (ADR 0013)."""
    override = os.environ.get(ENV_ROOT_OVERRIDE)
    if override:
        return override
    return norm_join(os.path.dirname(os.path.normpath(matter_root)), CASE_DATA_FOLDER)


def matter_case_data_dir(matter_root):
    """The matter's own case-data folder: MATTER_ROOT/0. CASE DATA (ADR 0013)."""
    return norm_join(matter_root, CASE_DATA_FOLDER)


def identity_from_metadata(main_sqlite_path):
    """Return (matter_id, short_name) from main.matter_metadata, or (None, None).

    Probes a temp copy so the native binary is never opened in place.
    """
    if not os.path.exists(main_sqlite_path):
        return None, None
    tmp = tempfile.mkdtemp(prefix=staging_prefix('probe'))
    dst = os.path.join(tmp, 'main.sqlite')
    try:
        shutil.copy2(main_sqlite_path, dst)
        con = sqlite3.connect(dst)
        try:
            rows = dict(con.execute(
                "SELECT key, value FROM matter_metadata "
                "WHERE key IN ('matter_id', 'short_name')").fetchall())
        finally:
            con.close()
        mid = rows.get('matter_id')
        sn = sanitize_short_name(rows.get('short_name', '') or '')
        return (mid, sn) if mid else (None, None)
    except Exception:
        return None, None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def resolve_case_data_dir(matter_root, stored, root, legacy_dir):
    """Select a usable stored nominee, else the matter's own 0. CASE DATA folder
    holding main.sqlite, else a not-yet-relocated folder under the firm root, else
    the matter's own folder as the default (ADR 0013).

    Returns \`\`(case_data_dir, rejected_nominee)\`\`. A stored path is only a
    nomination: absolute and relative custom locations remain supported when
    they contain \`\`main.sqlite\`\`.
    """
    if stored:
        nominee = os.path.normpath(stored) if is_absolute(stored) \\
            else norm_join(matter_root, stored)
    else:
        nominee = None

    if nominee != legacy_dir and nominee \\
            and os.path.exists(norm_join(nominee, 'main.sqlite')):
        return nominee, False

    in_matter = matter_case_data_dir(matter_root)
    if os.path.exists(norm_join(in_matter, 'main.sqlite')):
        return in_matter, bool(stored)

    # A matter not yet relocated keeps its folder under the firm root.
    # A matter folder can be renamed independently of its database folder.
    # Search only direct live-root children with the same matter reference,
    # then prove identity from main.sqlite before selecting one.
    matter_id, _ = parse_folder_name(matter_root)
    if matter_id and os.path.isdir(root):
        try:
            names = sorted(os.listdir(root))
        except OSError:
            names = []
        for name in names:
            candidate = norm_join(root, name)
            candidate_id, _ = parse_folder_name(candidate)
            if candidate_id.casefold() != matter_id.casefold():
                continue
            main_sqlite = norm_join(candidate, 'main.sqlite')
            if not os.path.isfile(main_sqlite):
                continue
            metadata_id, _ = identity_from_metadata(main_sqlite)
            if metadata_id and metadata_id.casefold() == matter_id.casefold():
                return candidate, bool(stored)

    # The firm-root folder named for the matter, as it was derived before ADR 0013. It wins
    # while it exists, even without main.sqlite, so a matter not yet relocated is rebuilt in place.
    mid, sn = None, None
    for cand in (nominee, legacy_dir):
        if cand:
            mid, sn = identity_from_metadata(norm_join(cand, 'main.sqlite'))
            if mid:
                break
    if not mid:
        mid, sn = parse_folder_name(matter_root)
    firm_folder = norm_join(root, f"{mid} {sn}".strip())
    if os.path.isdir(firm_folder):
        return firm_folder, bool(stored and nominee != legacy_dir
                                 and os.path.normcase(nominee) != os.path.normcase(firm_folder))

    derived = in_matter
    rejected = bool(stored and nominee != legacy_dir
                    and os.path.normcase(nominee) != os.path.normcase(derived))
    return derived, rejected
`;

// src/case/locate.ts
var LOCATE_PY = String.raw`
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
var LOCATE_DRIVER = case_data_resolver_py_default + LOCATE_PY + String.raw`

print(json.dumps(locate_case_data_dir(json.load(sys.stdin)['matter_root'])))
`;
function caseDataFolder(matterRoot, env = process.env) {
  const result = runPythonDriver({
    label: "matter-data sqlite helper",
    driver: pythonDriverFile("case-locate", LOCATE_DRIVER),
    payload: JSON.stringify({ matter_root: matterRoot }),
    env,
    timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS")
  });
  return result.case_data_dir;
}

// src/files/scope.ts
import { realpathSync } from "node:fs";
var WINDOWS = process.platform === "win32";
function canonicalRoot(root, missingMessage, code = "skills_root_missing") {
  try {
    return realpathSync.native(root);
  } catch {
    throw new DataServerError(missingMessage, code);
  }
}

// src/files/matter-root.ts
var POINTER_FILES = ["probanda.json", "coclerk.json"];
function findPointer(root) {
  return POINTER_FILES.map((name) => join3(root, name)).find((path) => existsSync2(path));
}
function validateMatterRoot(matterRoot) {
  if (typeof matterRoot !== "string" || matterRoot.length === 0) {
    throw new DataServerError("matter_root is required", "invalid_root");
  }
  if (!pathWin32.isAbsolute(matterRoot)) {
    throw new DataServerError(`matter_root must be an absolute path: ${matterRoot}`, "invalid_root");
  }
  const canon = canonicalRoot(matterRoot, `matter_root not found: ${matterRoot}`, "invalid_root");
  if (!statSync(canon).isDirectory()) {
    throw new DataServerError(`matter_root is not a directory: ${matterRoot}`, "invalid_root");
  }
  if (findPointer(canon) === void 0) {
    throw new DataServerError(
      `matter_root has no probanda.json or coclerk.json \u2014 not an initialized matter: ${matterRoot}`,
      "invalid_root"
    );
  }
  return canon;
}
function existingCaseDataFolder(root, env = process.env) {
  const dir = caseDataFolder(root, env);
  const missing = `the matter's matter-data folder does not exist: ${dir}. Run /matter-data initialize on this matter first.`;
  const canon = canonicalRoot(dir, missing, "case_data_missing");
  if (!statSync(canon).isDirectory()) throw new DataServerError(missing, "case_data_missing");
  return canon;
}

// src/files/zones.ts
import { win32 as pathWin322 } from "node:path";
var FIREWALL = /^(privileged|disclosed)$/i;
var TRASH = /^trash$/i;
var CASE_DATA = /^0\. case data$/i;
var DRAFT_FOLDER = /^0\. DRAFT/i;
var FOLDERS_0_AND_1 = /^[01]\./;
var ZONES = {
  read: { anywhere: [FIREWALL, TRASH, CASE_DATA], top: [], phrase: "never read" },
  scan: { anywhere: [FIREWALL, TRASH, CASE_DATA, DRAFT_FOLDER], top: [], phrase: "never scanned" },
  write: { anywhere: [FIREWALL, TRASH, CASE_DATA], top: [], phrase: "never written to" },
  "move-from": { anywhere: [FIREWALL, CASE_DATA], top: [TRASH], phrase: "never moved out of" },
  "move-to": { anywhere: [FIREWALL], top: [TRASH, FOLDERS_0_AND_1], phrase: "never a destination" },
  "run-files": { anywhere: [FIREWALL], top: [], phrase: "never used for run files" }
};
function zoneProblem(purpose, path, root, draftUnchanged = false) {
  const zone = ZONES[purpose];
  const segments = path.split(/[\\/]+/);
  if (segments.some((s) => FIREWALL.test(s))) return `a privileged or disclosed folder is ${zone.phrase}`;
  const below = root === void 0 ? [] : pathWin322.relative(root, path).split(pathWin322.sep).filter(Boolean);
  if (purpose === "move-to" && draftUnchanged) {
    return below.length === 1 && DRAFT_FOLDER.test(below[0]) ? null : "Move to 0. DRAFT unchanged moves only into the matter's 0. DRAFT folder";
  }
  const blocked = segments.find((s) => zone.anywhere.some((rule) => rule.test(s)));
  if (blocked) return `${blocked} is ${zone.phrase}`;
  if (below.length && zone.top.some((rule) => rule.test(below[0]))) return `${below[0]} is ${zone.phrase}`;
  if (purpose === "move-from") {
    if (below.length === 0) return "the matter folder itself is never moved";
    if (below.length === 1 && POINTER_FILES.includes(below[0].toLowerCase())) return "the matter pointer is never moved";
  }
  return null;
}

// src/file_ops/approved-row.ts
import { createHash as createHash2 } from "node:crypto";
import { readFileSync as readFileSync3 } from "node:fs";

// src/housekeeping/run-dir.ts
import { closeSync, existsSync as existsSync3, fsyncSync, mkdirSync, openSync, readdirSync as readdirSync3, readFileSync as readFileSync2, realpathSync as realpathSync3, statSync as statSync2, writeSync } from "node:fs";
import { win32 as pathWin324 } from "node:path";

// src/housekeeping/proposal.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { win32 as pathWin323 } from "node:path";
var SECTIONS = ["offered", "ingested_only", "deferred"];
var ACTION_GROUPS = {
  file: "Rename and move",
  rename: "Rename",
  move: "Move",
  draft: "Unfinished drafts",
  duplicate: "Duplicates",
  misfiled: "Mis-filed",
  unreadable: "Unreadable",
  stuck: "Left where they are"
};
var INGEST_OUTCOMES = ["ingested", "ingested_by_reference", "partial", "failed", "stopped", "none"];
var ENTRY_KEYS = /* @__PURE__ */ new Set(["row_id", "approve"]);
var ROW_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
var HASH_RE = /^[0-9a-f]{64}$/;
var FORBIDDEN_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
var RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
function bareNameProblem(name) {
  if (typeof name !== "string" || name.length === 0) return "is empty";
  if (name.length > 255) return "is longer than 255 characters";
  if (FORBIDDEN_NAME_CHARS.test(name)) return "contains a path separator or a character Windows forbids";
  if (name.includes("..")) return "contains '..'";
  if (/[. ]$/.test(name)) return "ends with a dot or a space";
  if (RESERVED_NAME.test(name)) return "is a name Windows reserves";
  return null;
}
function relativePathProblem(path) {
  if (typeof path !== "string" || path.length === 0) return "is empty";
  if (/^[A-Za-z]:/.test(path) || path.startsWith("\\") || path.startsWith("/")) return "is not matter-root-relative";
  for (const segment of path.split(/[\\/]+/)) {
    if (segment === "" || segment === "." || segment === "..") return "has an empty, '.' or '..' segment";
    if (/[<>:"|?*\x00-\x1f]/.test(segment)) return "contains a character Windows forbids";
  }
  return null;
}
function validateProposal(value, runId, root) {
  const v = new Checker();
  if (!v.object(value, "proposal")) return v.problems;
  const p = value;
  if (p.run_id !== runId) v.add(`run_id is ${JSON.stringify(p.run_id)}, not this run's ${runId}`);
  if (typeof p.matter_root !== "string" || canonical(p.matter_root).toLowerCase() !== root.toLowerCase()) {
    v.add(`matter_root ${JSON.stringify(p.matter_root)} is not this matter (${root})`);
  }
  v.string(p.created_at, "created_at");
  if (v.object(p.header, "header")) {
    const h = p.header;
    v.strings(h.open_in_word, "header.open_in_word");
    v.strings(h.folders_not_looked_inside, "header.folders_not_looked_inside");
    v.optionalString(h.finished_line, "header.finished_line");
  }
  if (v.array(p.folders, "folders")) {
    p.folders.forEach((f, i) => {
      const label = `folders[${i}]`;
      if (!v.object(f, label)) return;
      const folder = f;
      v.path(folder.path, `${label}.path`);
      v.boolean(folder.exists, `${label}.exists`);
      if (folder.flag_tokens !== void 0) v.strings(folder.flag_tokens, `${label}.flag_tokens`);
      if (folder.second_pass !== void 0) v.boolean(folder.second_pass, `${label}.second_pass`);
    });
  }
  if (p.draft_folder !== null) v.path(p.draft_folder, "draft_folder");
  if (v.array(p.rule_gaps, "rule_gaps")) {
    p.rule_gaps.forEach((g, i) => {
      if (!v.object(g, `rule_gaps[${i}]`)) return;
      const gap = g;
      for (const key of ["run_date", "matter_root", "file_name", "trigger", "current_rule", "missing", "reference_file"]) {
        v.string(gap[key], `rule_gaps[${i}].${key}`);
      }
      if (gap.best_guess !== void 0 && gap.best_guess !== null) v.string(gap.best_guess, `rule_gaps[${i}].best_guess`);
      v.optionalString(gap.outcome, `rule_gaps[${i}].outcome`);
    });
  }
  if (!v.array(p.rows, "rows")) return v.problems;
  const rows = p.rows;
  const ids = /* @__PURE__ */ new Set();
  rows.forEach((r, i) => validateRow(v, r, `rows[${i}]`, ids, p.draft_folder));
  const byPath = /* @__PURE__ */ new Map();
  rows.forEach((r, i) => {
    if (typeof r?.current_path !== "string" || typeof r.row_id !== "string") return;
    const key = samePath(r.current_path);
    const earlier = byPath.get(key);
    if (earlier !== void 0) v.add(`rows[${i}].current_path ${r.current_path} is repeated: rows ${earlier} and ${r.row_id} name the same file`);
    else byPath.set(key, r.row_id);
  });
  rows.forEach((r, i) => {
    const twin = r?.twin;
    if (typeof twin?.path !== "string") return;
    const label = `rows[${i}] (${r.row_id}).twin.row_id`;
    const twinRow = byPath.get(samePath(twin.path));
    if (twinRow !== void 0 && twin.row_id !== twinRow) v.add(`${label} must be ${twinRow}: the twin ${twin.path} is that row on this page`);
    else if (twinRow === void 0 && twin.row_id !== void 0) {
      if (!ids.has(twin.row_id)) v.add(`${label} ${twin.row_id} is not a row`);
      else v.add(`${label} ${twin.row_id} is not the row at ${twin.path}`);
    }
  });
  return v.problems;
}
function samePath(path) {
  return path.replace(/\//g, "\\").toLowerCase();
}
function validateRow(v, value, label, ids, draftFolder) {
  if (!v.object(value, label)) return;
  const r = value;
  if (typeof r.row_id !== "string" || !ROW_ID_RE.test(r.row_id)) v.add(`${label}.row_id must match ${ROW_ID_RE}`);
  else if (ids.has(r.row_id)) v.add(`${label}.row_id ${r.row_id} is repeated`);
  else ids.add(r.row_id);
  v.path(r.current_path, `${label}.current_path`);
  if (typeof r.hash !== "string" || !HASH_RE.test(r.hash)) v.add(`${label}.hash must be a lowercase SHA-256 hex digest`);
  v.oneOf(r.ingest_outcome, INGEST_OUTCOMES, `${label}.ingest_outcome`);
  if (r.store !== void 0) v.oneOf(r.store, ["main", "privileged", "law"], `${label}.store`);
  if (v.array(r.source_ids, `${label}.source_ids`)) {
    if (r.source_ids.some((id) => typeof id !== "string" && typeof id !== "number")) v.add(`${label}.source_ids must hold strings or numbers`);
  }
  if (v.array(r.name_checks, `${label}.name_checks`)) {
    r.name_checks.forEach((c, i) => {
      const l = `${label}.name_checks[${i}]`;
      if (!v.object(c, l)) return;
      const check = c;
      v.name(check.name, `${l}.name`);
      v.path(check.folder, `${l}.folder`);
      v.boolean(check.ok, `${l}.ok`);
      v.optionalString(check.reason, `${l}.reason`);
    });
  }
  v.oneOf(r.section, SECTIONS, `${label}.section`);
  if (r.section === "offered") {
    if (r.action === void 0) v.add(`${label} is an offered row with no action`);
    else validateAction(v, r.action, `${label} (${String(r.row_id)}).action`, r, draftFolder);
  } else if (r.action !== void 0) {
    v.add(`${label} carries an action but is not offered`);
  }
  v.strings(r.notes, `${label}.notes`);
  if (r.twin !== void 0 && v.object(r.twin, `${label}.twin`)) {
    const t = r.twin;
    v.path(t.path, `${label}.twin.path`);
    if (t.row_id !== void 0) v.string(t.row_id, `${label}.twin.row_id`);
    v.boolean(t.ingested, `${label}.twin.ingested`);
  }
}
var FILING_OPTIONS = ["create_folder", "file_no_ingest", "final", "answer"];
var ACTION_FIELDS = {
  rename: { required: ["name"], optional: ["file_no_ingest"] },
  file: { required: ["name", "folder"], optional: FILING_OPTIONS },
  move: { required: ["folder"], optional: FILING_OPTIONS },
  draft: { required: [], optional: [] },
  duplicate: { required: [], optional: [] },
  misfiled: { required: ["matter"], optional: [] },
  unreadable: { required: [], optional: [] },
  stuck: { required: ["reason"], optional: [] }
};
function validateAction(v, value, label, r, draftFolder) {
  if (!v.object(value, label)) return;
  const a = value;
  if (typeof a.kind !== "string" || !Object.hasOwn(ACTION_GROUPS, a.kind)) {
    v.add(`${label}.kind must be one of ${Object.keys(ACTION_GROUPS).join(", ")}`);
    return;
  }
  const kind = a.kind;
  const { required, optional } = ACTION_FIELDS[kind];
  for (const key of Object.keys(a)) if (key !== "kind" && !required.includes(key) && !optional.includes(key)) v.add(`${label}.${key} does not apply to a ${kind} action`);
  for (const key of required) if (a[key] === void 0) v.add(`${label} (${kind}) needs ${key}`);
  if (a.name !== void 0) v.name(a.name, `${label}.name`);
  if (a.folder !== void 0) v.folder(a.folder, `${label}.folder`);
  for (const key of ["create_folder", "file_no_ingest", "final"]) if (a[key] !== void 0) v.boolean(a[key], `${label}.${key}`);
  for (const key of ["answer", "matter", "reason"]) v.optionalString(a[key], `${label}.${key}`);
  if ([a.file_no_ingest === true, a.final === true, a.answer !== void 0].filter(Boolean).length > 1) {
    v.add(`${label} combines more than one of file_no_ingest, final and answer`);
  }
  if (a.create_folder === true && typeof a.folder === "string") {
    const segments = a.folder.split(/[\\/]+/);
    if (segments.length < 2 || !/^\d+\.\s/.test(segments[0])) v.add(`${label}.folder, a new folder, must sit inside a numbered folder, never directly under the root`);
  }
  const atRoot = typeof r.current_path === "string" && !/[\\/]/.test(r.current_path);
  if (kind === "rename" && atRoot) v.add(`${label}: a root file cannot be renamed in place`);
  if (a.file_no_ingest === true && !atRoot && typeof a.folder === "string" && typeof r.current_path === "string") {
    const own = r.current_path.replace(/[\\/][^\\/]*$/, "");
    if (a.folder.replace(/\//g, "\\").toLowerCase() !== own.replace(/\//g, "\\").toLowerCase()) v.add(`${label}: filed without reading, a subfolder file stays in ${own}`);
  }
  if (kind === "draft" && !atRoot) v.add(`${label}: only a root file moves to 0. DRAFT`);
  if (kind === "draft" && draftFolder === null) v.add(`${label}: the matter has no 0. DRAFT folder`);
  if (kind === "duplicate" && r.twin === void 0) v.add(`${label}: a duplicate row needs its twin`);
  if (kind === "unreadable" && r.ingest_outcome !== "failed") v.add(`${label}: try again next run is only for a failed ingest`);
}
function validateApproval(value, runId) {
  const v = new Checker();
  if (!v.object(value, "approval")) return v.problems;
  const a = value;
  if (a.run_id !== runId) v.add(`run_id is ${JSON.stringify(a.run_id)}, not ${runId}`);
  v.string(a.approved_at, "approved_at");
  validateEntries(v, a.rows);
  return v.problems;
}
function validateEntries(v, rows) {
  if (!v.array(rows, "rows")) return;
  const seen = /* @__PURE__ */ new Set();
  rows.forEach((e, i) => {
    const label = `rows[${i}]`;
    if (!v.object(e, label)) return;
    const entry = e;
    for (const key of Object.keys(entry)) if (!ENTRY_KEYS.has(key)) v.add(`${label} has unknown key ${key}`);
    if (typeof entry.row_id !== "string") v.add(`${label}.row_id must be a string`);
    else if (seen.has(entry.row_id)) v.add(`${label}.row_id ${entry.row_id} is repeated`);
    else seen.add(entry.row_id);
    if (entry.approve !== true) v.add(`${label}.approve must be true: only approved rows are posted`);
  });
}
function canonical(path) {
  try {
    return realpathSync2.native(path);
  } catch {
    return pathWin323.resolve(path);
  }
}
var MAX_PROBLEMS = 20;
var Checker = class {
  problems = [];
  dropped = 0;
  /** Records a problem. Past the cap, one last entry counts the problems left out. */
  add(problem) {
    if (this.problems.length < MAX_PROBLEMS) {
      this.problems.push(problem);
      return;
    }
    this.dropped++;
    this.problems[MAX_PROBLEMS] = `and ${this.dropped} more problem${this.dropped === 1 ? "" : "s"}`;
  }
  object(value, label) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return true;
    this.add(`${label} must be an object`);
    return false;
  }
  array(value, label) {
    if (Array.isArray(value)) return true;
    this.add(`${label} must be an array`);
    return false;
  }
  string(value, label) {
    if (typeof value === "string" && value.length > 0) return true;
    this.add(`${label} must be a non-empty string`);
    return false;
  }
  optionalString(value, label) {
    if (value !== void 0) this.string(value, label);
  }
  strings(value, label) {
    if (Array.isArray(value) && value.every((s) => typeof s === "string" && s.length > 0)) return true;
    this.add(`${label} must be an array of non-empty strings`);
    return false;
  }
  boolean(value, label) {
    if (typeof value !== "boolean") this.add(`${label} must be a boolean`);
  }
  oneOf(value, allowed, label) {
    if (typeof value !== "string" || !allowed.includes(value)) this.add(`${label} must be one of ${allowed.join(", ")}`);
  }
  name(value, label) {
    const problem = bareNameProblem(value);
    if (problem) this.add(`${label}${typeof value === "string" && value ? " " + JSON.stringify(value) : ""} ${problem}`);
  }
  /** A destination folder: matter-root-relative, and every segment a name Windows can create (no trailing dot or space). */
  folder(value, label) {
    if (typeof value === "string") {
      const bad = value.split(/[\\/]+/).filter((s) => s !== "" && s !== "." && s !== "..").map((s) => [s, bareNameProblem(s)]).filter(([, p]) => p);
      for (const [segment, problem] of bad) this.add(`${label} segment ${JSON.stringify(segment)} ${problem}`);
      if (bad.length) return;
    }
    this.path(value, label);
  }
  path(value, label) {
    const problem = relativePathProblem(value);
    if (problem) this.add(`${label} ${problem}`);
    return problem === null;
  }
};

// src/housekeeping/run-dir.ts
var RUN_ID_RE = /^\d{8}-\d{6}(?:\d{3})?-[0-9a-f]{4}$/;
var PROPOSAL = "proposal.json";
var APPROVAL = "approval.json";
function openMatter(matterRoot) {
  const root = validateMatterRoot(matterRoot);
  const caseData = existingCaseDataFolder(root);
  return { root, caseData, housekeeping: pathWin324.join(caseData, "housekeeping") };
}
function assertRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
    throw new DataServerError(`run_id must look like 20260924-204013123-a1b2: ${runId}`, "invalid_run_id");
  }
}
function existingRunDir(matter, runId) {
  assertRunId(runId);
  const dir = pathWin324.join(matter.housekeeping, runId);
  if (!isDirectory(dir)) throw new DataServerError(`no run directory ${runId} under ${matter.housekeeping}`, "run_not_found");
  return confineRunDir(matter, runId);
}
function confineRunDir(matter, runId) {
  const expected = pathWin324.join(matter.housekeeping, runId);
  const real = realpathSync3.native(expected);
  if (real.toLowerCase() !== expected.toLowerCase() || zoneProblem("run-files", real)) {
    throw new DataServerError(`run directory resolves outside the matter-data folder's housekeeping folder (${expected} -> ${real})`, "path_out_of_scope");
  }
  return real;
}
function readProposal(runDir, runId, root) {
  let text;
  try {
    text = readFileSync2(pathWin324.join(runDir, PROPOSAL), "utf-8");
  } catch {
    return { proposal: null, problem: "no proposal.json" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { proposal: null, problem: `proposal.json does not parse: ${err.message}` };
  }
  const problems = validateProposal(parsed, runId, root);
  if (problems.length) return { proposal: null, problem: `proposal.json is invalid: ${problems.join("; ")}` };
  return { proposal: parsed };
}
function requireProposal(runDir, runId, root) {
  const { proposal, problem } = readProposal(runDir, runId, root);
  if (!proposal) throw new DataServerError(`run ${runId}: ${problem}`, "invalid_proposal");
  return proposal;
}
function readApproval(runDir, runId) {
  let text;
  try {
    text = readFileSync2(pathWin324.join(runDir, APPROVAL), "utf-8");
  } catch (err) {
    const code = err.code;
    return code === "ENOENT" ? { approval: null } : { approval: null, problem: `approval.json cannot be read (${code})` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { approval: null, problem: `approval.json does not parse: ${err.message}` };
  }
  const problems = validateApproval(parsed, runId);
  if (problems.length) return { approval: null, problem: `approval.json is invalid: ${problems.join("; ")}` };
  return { approval: parsed };
}
function requireApproval(runDir, runId) {
  const { approval, problem } = readApproval(runDir, runId);
  if (approval) return approval;
  if (problem) {
    throw new DataServerError(
      `run ${runId}: the saved approval ${pathWin324.join(runDir, APPROVAL)} is unreadable, so nothing is applied from it: ${problem}`,
      "approval_corrupt"
    );
  }
  throw new DataServerError(`run ${runId} has no approval.json; nothing was approved`, "not_approved");
}
function isDirectory(path) {
  try {
    return statSync2(path).isDirectory();
  } catch {
    return false;
  }
}

// src/file_ops/approved-row.ts
function requireApprovedRow(matterRoot, row, source) {
  if (row.run_id === void 0 && row.row_id === void 0) return;
  if (row.run_id === void 0 || row.row_id === void 0) {
    throw new DataServerError("run_id and row_id are given together or not at all", "invalid_argument");
  }
  const matter = openMatter(matterRoot);
  const dir = existingRunDir(matter, row.run_id);
  const proposed = requireProposal(dir, row.run_id, matter.root).rows.find((r) => r.row_id === row.row_id);
  if (!proposed) throw new DataServerError(`row ${row.row_id} is not in run ${row.run_id}'s proposal.json`, "unknown_row");
  if (!requireApproval(dir, row.run_id).rows.some((e) => e.row_id === row.row_id)) {
    throw new DataServerError(`row ${row.row_id} of run ${row.run_id} was not approved; nothing was moved`, "not_approved");
  }
  let hash;
  try {
    hash = createHash2("sha256").update(readFileSync3(source)).digest("hex");
  } catch (err) {
    throw new DataServerError(`the approved file of row ${row.row_id} cannot be read (${err.message}); nothing was moved: ${source}`, "changed_since_approval");
  }
  if (hash !== proposed.hash) {
    throw new DataServerError(
      `the file is not the one approved for row ${row.row_id} of run ${row.run_id}: it changed after approval; nothing was moved: ${source}`,
      "changed_since_approval"
    );
  }
}

// src/file_ops/trash.ts
var TRASH2 = "TRASH";
var TRASH_LOG = ".trash-log.jsonl";
function fileOpsTrash(path, dryRun = false, now = /* @__PURE__ */ new Date(), row = {}, outsideMatter = false) {
  if (typeof path !== "string" || !pathWin325.isAbsolute(path)) {
    throw new DataServerError(`path must be an absolute host path: ${path}`, "invalid_path");
  }
  let target;
  try {
    target = pathWin325.join(realpathSync4.native(pathWin325.dirname(path)), pathWin325.basename(path));
    lstatSync(target);
  } catch {
    throw new DataServerError(`path does not exist: ${path}`, "not_found");
  }
  const stat = lstatSync(target);
  const ancestors = [target];
  for (let dir = pathWin325.dirname(target); dir !== ancestors[ancestors.length - 1]; dir = pathWin325.dirname(dir)) {
    ancestors.push(dir);
  }
  if (ancestors.some((dir) => existsSync4(pathWin325.join(dir, ".git")))) {
    throw new DataServerError(
      `path is inside a Git worktree; ordinary repository rules apply there: ${target}`,
      "git_worktree"
    );
  }
  const matterRoot = ancestors.find((dir) => POINTER_FILES.some((marker) => isFile(pathWin325.join(dir, marker))));
  if (matterRoot === void 0 && !outsideMatter) {
    throw new DataServerError(
      `no ${POINTER_FILES.join(" or ")} at or above the path; not a client-matter file: ${target}`,
      "not_a_matter_file"
    );
  }
  const root = matterRoot ?? mirrorRoot(target);
  const rel = pathWin325.relative(root, target);
  if (matterRoot === void 0 && (rel === "" || rel.split(pathWin325.sep).some((s) => s.toUpperCase() === TRASH2))) {
    throw new DataServerError(
      `path is protected (the home folder, a drive root, or ${TRASH2} or anything in it): ${target}`,
      "protected"
    );
  }
  if (zoneProblem("move-from", target, root)) {
    throw new DataServerError(
      `path is protected (the workspace root, the matter pointer, ${TRASH2}, the matter-data folder, or a privileged/disclosed tree): ${target}`,
      "protected"
    );
  }
  requireApprovedRow(root, row, target);
  let dest = pathWin325.join(root, TRASH2, rel);
  if (present(dest)) {
    const suffix = ` (trashed ${stamp(now)})`;
    const ext = stat.isDirectory() ? "" : pathWin325.extname(dest);
    dest = dest.slice(0, dest.length - ext.length) + suffix + ext;
    if (present(dest)) {
      throw new DataServerError(`destination already exists: ${dest}`, "dest_exists");
    }
  }
  if (dryRun) return { would_move_from: target, would_move_to: dest };
  const result = stat.isDirectory() ? { moved_from: target, moved_to: dest, kind: "dir", entries: readdirSync4(target, { recursive: true }).length } : { moved_from: target, moved_to: dest, kind: "file", bytes: stat.size };
  mkdirSync2(pathWin325.dirname(dest), { recursive: true });
  try {
    renameSync(target, dest);
  } catch (err) {
    if (err.code === "EXDEV") {
      throw new DataServerError(
        `cannot move across devices (a junction inside the matter?); nothing was moved: ${target}`,
        "cross_device"
      );
    }
    throw err;
  }
  try {
    const line = JSON.stringify({ when: now.toISOString(), from: target, to: dest });
    appendFileSync(pathWin325.join(root, TRASH2, TRASH_LOG), line + "\n", "utf-8");
  } catch (err) {
    result.log_error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
function mirrorRoot(target) {
  const home = realpathSync4.native(homedir());
  const rel = pathWin325.relative(home, target);
  if (rel !== ".." && !rel.startsWith("..\\") && !pathWin325.isAbsolute(rel)) return home;
  return pathWin325.parse(target).root;
}
function isFile(path) {
  return existsSync4(path) && statSync3(path).isFile();
}
function present(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
function stamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// src/trash-cli.ts
function runTrashCli(paths, write = (l) => process.stdout.write(l + "\n")) {
  if (paths.length === 0) {
    write(JSON.stringify({ error: "invalid_argument", message: "usage: trash-cli.js <absolute path>..." }));
    return 1;
  }
  let failed = false;
  for (const path of paths) {
    try {
      write(JSON.stringify(fileOpsTrash(path, false, /* @__PURE__ */ new Date(), {}, true)));
    } catch (err) {
      failed = true;
      const code = err instanceof DataServerError ? err.code : "error";
      write(JSON.stringify({ path, error: code, message: err instanceof Error ? err.message : String(err) }));
    }
  }
  return failed ? 1 : 0;
}
var isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = runTrashCli(process.argv.slice(2));
export {
  runTrashCli
};
