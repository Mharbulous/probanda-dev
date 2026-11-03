// A small IMAP server on loopback, for tests that send mail tools through the real ImapFlow, because
// a fake client cannot see the wire. Synthetic data only. `boxes` maps each folder as the server knows
// it to the UIDs it holds, and `messageOf` gives a UID's {raw, envelope, flags}. It answers a body
// fetch only when asked for one, as a server does.

import { createServer } from "node:net";

const unquote = (name) => name.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");

export function imapServer({ capabilities = "IMAP4rev1 MOVE UIDPLUS", boxes, messageOf, trash, drafts } = {}) {
  const wire = [];
  const flagged = new Set();
  const specialUse = (name) => (name === trash ? " \\Trash" : name === drafts ? " \\Drafts" : "");
  const server = createServer((socket) => {
    let open;
    let buffered = "";
    socket.write(`* OK [CAPABILITY ${capabilities}] ready\r\n`);
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffered += chunk.toString("latin1");
      let end;
      while ((end = buffered.indexOf("\r\n")) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const [, tag, command, rest = ""] = /^(\S+) (\S+)(?: (.*))?$/.exec(line) ?? [];
        if (!tag) continue;
        wire.push(line);
        const done = (text = "done") => socket.write(`${tag} OK ${text}\r\n`);
        const verb = command.toUpperCase();
        if (verb === "CAPABILITY") {
          socket.write(`* CAPABILITY ${capabilities}\r\n`);
          done();
        } else if (verb === "LOGIN") {
          done(`[CAPABILITY ${capabilities}] signed in`);
        } else if (verb === "LIST" || verb === "LSUB") {
          // An empty pattern asks only for the separator, and `INBOX` is its own question.
          if (/ ""$/.test(rest)) socket.write(`* ${verb} (\\Noselect) "/" ""\r\n`);
          else if (/ "\*"$/.test(rest)) {
            for (const name of boxes.keys()) {
              socket.write(`* ${verb} (\\HasNoChildren${specialUse(name)}) "/" "${name}"\r\n`);
            }
          }
          done();
        } else if (verb === "EXAMINE" || verb === "SELECT") {
          open = unquote(rest);
          socket.write(`* ${boxes.get(open).size} EXISTS\r\n* OK [UIDVALIDITY 42] ok\r\n* OK [UIDNEXT 100] ok\r\n* FLAGS ()\r\n`);
          done(`[${verb === "EXAMINE" ? "READ-ONLY" : "READ-WRITE"}] opened`);
        } else if (verb === "UID" && /^SEARCH/i.test(rest)) {
          const asked = /UID ([\d,]+)/i.exec(rest)?.[1]?.split(",").map(Number);
          const uids = [...boxes.get(open)].filter((u) => !asked || asked.includes(u));
          socket.write(`* SEARCH${uids.map((u) => ` ${u}`).join("")}\r\n`);
          done();
        } else if (verb === "UID" && /^FETCH/i.test(rest)) {
          const uid = Number(/^FETCH (\d+)/i.exec(rest)[1]);
          if (boxes.get(open).has(uid)) {
            const { raw, envelope, flags = "" } = messageOf(uid, open);
            const fields = `UID ${uid} FLAGS (${flags}) RFC822.SIZE ${raw.length} ENVELOPE ${envelope} INTERNALDATE "02-Nov-2026 10:00:00 +0000"`;
            if (/BODY/i.test(rest)) {
              socket.write(`* 1 FETCH (${fields} BODY[] {${raw.length}}\r\n`);
              socket.write(raw);
              socket.write(")\r\n");
            } else {
              socket.write(`* 1 FETCH (${fields})\r\n`);
            }
          }
          done();
        } else if (verb === "UID" && /^MOVE/i.test(rest)) {
          const [, range] = /^MOVE (\S+) /i.exec(rest);
          for (const uid of range.split(",").map(Number)) boxes.get(open).delete(uid);
          done("moved");
        } else if (verb === "UID" && /^COPY/i.test(rest)) {
          const [, range, name] = /^COPY (\S+) (.+)$/i.exec(rest);
          const uids = range.split(",").map(Number);
          for (const uid of uids) boxes.get(unquote(name)).add(uid + 100);
          done(`[COPYUID 42 ${range} ${uids.map((u) => u + 100).join(",")}] copied`);
        } else if (verb === "UID" && /^STORE/i.test(rest)) {
          for (const uid of /^STORE (\S+) /i.exec(rest)[1].split(",").map(Number)) flagged.add(uid);
          done("stored");
        } else if (verb === "UID" && /^EXPUNGE/i.test(rest)) {
          for (const uid of /^EXPUNGE (\S+)/i.exec(rest)[1].split(",").map(Number)) if (flagged.has(uid)) boxes.get(open).delete(uid);
          done("expunged");
        } else if (verb === "LOGOUT") {
          socket.write("* BYE bye\r\n");
          done();
          socket.end();
        } else {
          done();
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, wire, boxes, port: server.address().port })));
}
