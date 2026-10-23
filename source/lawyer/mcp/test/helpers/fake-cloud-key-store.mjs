// A stand-in for Windows Credential Manager (mcp-shared/commons-key.js, setCloudKeyStore), so no
// test reads or writes the practitioner's real Probanda/cloud-key entry. Holds one secret and
// counts calls; `failRead` makes every read throw, as an unreadable store would.
export function fakeCloudKeyStore(initial = null) {
  const store = {
    secret: initial,
    reads: 0,
    writes: 0,
    failRead: null,
    async read() {
      store.reads++;
      if (store.failRead) throw new Error(store.failRead);
      return store.secret;
    },
    async write(secret) {
      store.writes++;
      store.secret = secret;
    },
    async delete() {
      store.secret = null;
    },
  };
  return store;
}
