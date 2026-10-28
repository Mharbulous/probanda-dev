// The staged-write discipline shared by the submission and timecamping Python helpers (#185), as a
// Python fragment each interpolates into its own PY_HELPER. case/backend.ts keeps its own: it
// ATTACHes three databases and rolls back a half-commit across them, which this does not.

export interface StagedStore {
  /** The store's name in file names and messages: "submission" or "timecamping". */
  store: string;
  /** The replace sibling's extension: ".sqlite" or ".db". */
  ext: string;
  /** The tool the missing-database message points to. */
  migrateTool: string;
}

/** Defines copy_fsync, replace_live and staged_write. Needs os, shutil, sqlite3 and tempfile imported. */
export function stagedStorePython({ store, ext, migrateTool }: StagedStore): string {
  return String.raw`
def copy_fsync(src, dst):
    """copy2 then flush to disk, so a later rename cannot expose a torn file."""
    shutil.copy2(src, dst)
    with open(dst, 'rb+') as fh:
        os.fsync(fh.fileno())
    return dst


def replace_live(staged, db_path):
    # Stage the finished file beside db_path (same volume), flush it, then rename it over the
    # live file, so a kill at any point leaves db_path whole: old or new, never torn.
    sibling = os.path.join(os.path.dirname(db_path), f'coclerk_${store}_replace_{os.environ["COCLERK_STAGING_TAG"]}${ext}')
    try:
        copy_fsync(staged, sibling)
        os.replace(sibling, db_path)
    finally:
        if os.path.exists(sibling):
            os.remove(sibling)


def staged_write(req, op_name, mutate, isolation_level=''):
    # Stage a temp copy of req's db_path and hand mutate(con) a connection to it. mutate returns
    # (result, committed). Replace the live file only after a successful commit and a closed
    # connection -- never mutate the live (possibly synced) file in place. A write mutate rolled
    # back returns committed False and leaves the live file untouched.
    db_path = req['db_path']
    if not os.path.exists(db_path):
        raise SystemExit(
            f"No ${store} database found at {db_path}. Run ${migrateTool} first.")
    tmp = tempfile.mkdtemp(prefix=f'coclerk_${store}_{op_name}_{os.environ["COCLERK_STAGING_TAG"]}_')
    try:
        staged = os.path.join(tmp, os.path.basename(db_path))
        shutil.copy2(db_path, staged)
        con = sqlite3.connect(staged, isolation_level=isolation_level)
        try:
            con.execute("PRAGMA journal_mode = DELETE")
            con.execute("PRAGMA foreign_keys = ON")
            mode = con.execute("PRAGMA journal_mode").fetchone()[0]
            if str(mode).lower() != 'delete':
                raise SystemExit(f"Refusing to operate: journal_mode is '{mode}', expected 'delete'.")
            out, committed = mutate(con)
        finally:
            con.close()
        if committed:
            replace_live(staged, db_path)
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
`.trim();
}
