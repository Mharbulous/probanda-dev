// A helper killed on timeout never runs its `finally`, so its staging copy stays in the OS temp
// dir. Tests that kill one on purpose point the temp dir at their own scratch folder for the call.

const VARS = ["TMPDIR", "TEMP", "TMP"];

/** Runs `fn` with the OS temp dir (for Node and the spawned Python) set to `dir`. */
export async function withTempDir(dir, fn) {
  const saved = VARS.map((name) => process.env[name]);
  for (const name of VARS) process.env[name] = dir;
  try {
    return await fn();
  } finally {
    VARS.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
  }
}
