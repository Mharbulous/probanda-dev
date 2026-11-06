// The one write primitive for a page submission that becomes a file: exclusive create, so an
// existing file is never overwritten, then fsync before returning, so a 200 reply means the file
// is whole on disk.

import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";

/** Writes `text` whole, then flushes it to disk before returning. Fails if the file exists. */
export function writeNewDurably(path: string, text: string): void {
  const fd = openSync(path, "wx");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
