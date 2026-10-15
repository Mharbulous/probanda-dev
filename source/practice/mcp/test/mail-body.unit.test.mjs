// The mail tools' body rendering, summary and attachment list (src/mail/body.ts).
// Every message is a synthetic string built here: no real mail.

import assert from "node:assert/strict";
import test from "node:test";

const { renderBody, summarize, attachmentList } = await import("../build/mail/body.js");

const TEXT = { format: "text", maxLength: 10000, stripQuoted: false, stripInlineImages: false };
const STRIP = { ...TEXT, stripQuoted: true };

const plain = (lines) => ({ headers: new Map(), plain: lines.join("\r\n"), attachments: [] });

test("strip_quoted cuts a Gmail-style 'On ... wrote:' reply", () => {
  const r = renderBody(plain([
    "Thanks, that works.",
    "",
    "On Mon, Oct 5, 2026 at 9:30 AM Example Sender <sender@example.test> wrote:",
    "> Can we meet Tuesday?",
    "> Regards",
  ]), STRIP);
  assert.equal(r.body, "Thanks, that works.");
  assert.equal(r.strippedQuoted, true);
});

test("strip_quoted cuts at an '-----Original Message-----' line", () => {
  const r = renderBody(plain([
    "Please see below.",
    "Sender Two",
    "",
    "-----Original Message-----",
    "From: Someone <someone@example.test>",
    "Sent: Monday, October 5, 2026 9:30 AM",
  ]), STRIP);
  assert.equal(r.body, "Please see below.\nSender Two");
  assert.equal(r.strippedQuoted, true);
});

test("strip_quoted cuts at an Outlook From:/Sent:/To: block", () => {
  const r = renderBody(plain([
    "Confirmed for the 12th.",
    "",
    "From: Example Counsel <counsel@example.test>",
    "Sent: Monday, October 5, 2026 9:30 AM",
    "To: Example Recipient <recipient@example.test>",
    "Subject: Hearing date",
    "",
    "Is the 12th available?",
  ]), STRIP);
  assert.equal(r.body, "Confirmed for the 12th.");
  assert.equal(r.strippedQuoted, true);
});

test("strip_quoted keeps a From: line that opens no header block", () => {
  const body = ["Note the address.", "From: the registry, not the client.", "That is all."];
  const r = renderBody(plain(body), STRIP);
  assert.equal(r.body, body.join("\r\n"));
  assert.equal(r.strippedQuoted, undefined);
});

test("strip_inline_images removes and counts each data:image run in text", () => {
  const r = renderBody(plain(["Signature", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", "Logo data:image/jpeg;base64,/9j/4AAQSkZJRg== end"]), {
    ...TEXT,
    stripInlineImages: true,
  });
  assert.equal(r.body.includes("data:image"), false);
  assert.equal(r.strippedInlineImages, 2);
  assert.match(r.body, /Logo  end/);
});

test("strip_inline_images removes data-URI <img> tags from html", () => {
  const html = '<p>Hi</p><img src="data:image/png;base64,AAAA" alt="logo"><img src="https://example.test/x.png">';
  const r = renderBody({ headers: new Map(), html, attachments: [] }, { ...TEXT, format: "html", stripInlineImages: true });
  assert.equal(r.body, '<p>Hi</p><img src="https://example.test/x.png">');
  assert.equal(r.strippedInlineImages, 1);
  assert.equal(r.bodyFormat, "html");
});

test("with both options off the body is returned untouched", () => {
  const lines = ["Reply.", "On Mon, Oct 5, 2026 Someone wrote:", "> quoted", "> more", "data:image/png;base64,AAAA"];
  const r = renderBody(plain(lines), TEXT);
  assert.equal(r.body, lines.join("\r\n"));
  assert.equal(r.strippedQuoted, undefined);
  assert.equal(r.strippedInlineImages, undefined);
  assert.equal(r.bodyTruncated, undefined);
});

test("text falls back to the html part's text, and html to the escaped plain part", () => {
  const fromHtml = renderBody({ headers: new Map(), html: "<p>One &amp; two</p>", attachments: [] }, TEXT);
  assert.equal(fromHtml.body, "One & two");
  const fromPlain = renderBody(plain(["a < b", "c"]), { ...TEXT, format: "html" });
  assert.equal(fromPlain.body, "a &lt; b<br>\nc");
});

test("a body over max length is cut and marked truncated", () => {
  const r = renderBody(plain(["x".repeat(50)]), { ...TEXT, maxLength: 20 });
  assert.equal(r.body.length, 20);
  assert.equal(r.bodyTruncated, true);
});

test("summarize gives the ingest shape: ISO UTC date, messageId with brackets, no cc when empty", () => {
  const s = summarize(
    {
      uid: 42,
      envelope: {
        date: new Date("2026-10-05T16:30:00Z"),
        subject: "Hearing",
        messageId: "<abc123@example.test>",
        from: [{ name: "Example Sender", address: "sender@example.test" }],
        to: [{ address: "one@example.test" }, { name: "Two", address: "two@example.test" }],
        cc: [],
      },
      flags: new Set(["\\Seen"]),
      size: 1234,
    },
    "Sent Messages"
  );
  assert.deepEqual(s, {
    uid: 42,
    folder: "Sent Messages",
    date: "2026-10-05T16:30:00.000Z",
    from: "Example Sender <sender@example.test>",
    to: ["one@example.test", "Two <two@example.test>"],
    subject: "Hearing",
    messageId: "<abc123@example.test>",
    seen: true,
    size: 1234,
  });
  assert.equal("cc" in s, false);
  const withCc = summarize({ uid: 1, envelope: { cc: [{ address: "cc@example.test" }] }, flags: new Set(["\\Flagged"]) }, "INBOX");
  assert.deepEqual(withCc.cc, ["cc@example.test"]);
  assert.equal(withCc.flagged, true);
  assert.equal(withCc.seen, false);
});

test("attachmentList walks a two-part structure and lists the attachment", () => {
  const structure = {
    type: "multipart/mixed",
    childNodes: [
      { part: "1", type: "text/plain", parameters: { charset: "utf-8" }, size: 100 },
      {
        part: "2",
        type: "application/pdf",
        parameters: { name: "letter.pdf" },
        disposition: "attachment",
        dispositionParameters: { filename: "letter.pdf" },
        size: 2048,
        id: "<pdf1@example.test>",
      },
    ],
  };
  assert.deepEqual(attachmentList(structure), [
    { index: 0, part: "2", filename: "letter.pdf", contentType: "application/pdf", size: 2048, contentId: "<pdf1@example.test>" },
  ]);
  const inlineImage = { part: "3", type: "image/png", disposition: "inline", dispositionParameters: { filename: "logo.png" }, size: 10 };
  const listed = attachmentList({ type: "multipart/related", childNodes: [structure, inlineImage] });
  assert.equal(listed.length, 2);
  assert.equal(listed[1].inline, true);
  assert.equal(listed[1].index, 1);
});
