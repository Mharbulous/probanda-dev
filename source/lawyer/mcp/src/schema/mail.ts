import type { ToolDefinition } from "./shared.js";

// The mail__* tools (docs/Plans/2026-10-15_imap-mail.md): the practitioner's
// mailbox over IMAP, read-only apart from save_draft, which only appends a draft,
// and create_folder, rename_folder and move_messages, which organize it. No tool
// deletes mail or a folder. Served by the `data` server only, never by
// file-manager's `files` server.
export function mailToolDefinitions(): ToolDefinition[] {
  const errors =
    " Errors: `mail_not_configured` (call mail__configure_credential), `mail_auth` (the server refused the sign-in), " +
    "`mail_timeout` (no answer within 30 s; the connection was closed, so retry once), `mail_error`.";
  const readOnly = " Read-only: every folder is opened read-only, so nothing is marked read.";
  const organizes = " Writes to the mailbox. No Probanda tool deletes mail or a folder.";
  const folder = { type: "string", description: "Exact folder name from mail__list_folders. Default INBOX." };
  const uid = { type: "integer", minimum: 1, description: "The message's UID in that folder, from a list or search." };
  const bodyOptions = {
    include_body: { type: "boolean", description: "Also return each body. At most the newest 25 messages are returned when true." },
    body_format: { type: "string", enum: ["text", "html"], description: "Default text." },
    body_max_length: { type: "integer", minimum: 1, description: "Per-message body character cap. Default 10000." },
    strip_quoted: { type: "boolean", description: "Cut the quoted earlier messages of a reply (text format only)." },
    strip_inline_images: { type: "boolean", description: "Remove inline data-URI images." },
  };
  const messageShape =
    "Each message is {uid, folder, date (ISO 8601 UTC), from, to, cc?, subject, messageId, seen, flagged?, answered?, size}; " +
    "with `include_body` it also carries `body`, `bodyFormat` and `bodyTruncated?`.";
  return [
    {
      name: "mail__configure_credential",
      description:
        "One-time setup of this machine's Probanda mail connector: `host` (the IMAP server), `port` (default 993), " +
        "`secure` (TLS, default true), `username`, and optionally `from_address`, kept for reference only. To read the " +
        "calendar and contacts with the same password, also give `caldav_url` with `timezone` (an IANA time zone such as " +
        "America/Vancouver), `carddav_url`, and `dav_username` when the calendar and contacts sign-in name differs from " +
        "the mail username (it is tried first, then `username`). For iCloud: imap.mail.me.com, https://caldav.icloud.com, " +
        "https://contacts.icloud.com, and the Apple ID (an @icloud.com, @me.com or @mac.com address) as `username` and " +
        "`dav_username`, even for a custom-domain address, which goes in `from_address`. Run again without `dav_username`, " +
        "`caldav_url`, `carddav_url` or `timezone` and the saved value of each is kept; give an empty string to clear one. " +
        "Takes no password: an email password never passes through the chat. Returns {status: \"awaiting_password\", url, " +
        "host, username, next}: send the practitioner the `url`, a page on this computer where they type the password " +
        "(for iCloud and most hosted mail an app-specific password, never the account password). The page signs in to " +
        "mail and reads INBOX's counts, and signs in to the calendar and contacts servers when their URLs are given, " +
        "before saving; it shows each result and lets them retry. A mail sign-in that fails saves nothing and the " +
        "previous credential stays. A calendar or contacts sign-in that fails is shown as failed on the page and in " +
        "mail__configure_status, and that service is saved as not configured while mail is saved. The password is saved " +
        "on this computer, encrypted at rest, and never logged or returned. When they say it is done, call " +
        "mail__configure_status. Only the newest link works. Writes only the credential file; nothing in the mailbox, " +
        "calendar or contacts changes." +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          host: { type: "string" },
          port: { type: "integer", minimum: 1, maximum: 65535 },
          secure: { type: "boolean" },
          username: { type: "string" },
          from_address: { type: "string" },
          dav_username: { type: "string" },
          caldav_url: { type: "string", description: "https URL of the CalDAV server. Needs timezone." },
          carddav_url: { type: "string", description: "https URL of the CardDAV server." },
          timezone: { type: "string", description: "IANA time zone the calendar tools read and show times in." },
        },
        required: ["host", "username"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true },
    },
    {
      name: "mail__configure_status",
      description:
        "Report whether this machine has a Probanda mail connector credential: {configured, host, port, username, " +
        "from_address, password_set, dav_username, caldav_url, carddav_url, timezone, calendar_configured, " +
        "contacts_configured, dav_sign_in?, credential_error?}. `dav_sign_in` gives, for the last save in this " +
        "session, why a calendar or contacts sign-in failed. Never returns the password or any hint of it. Call it " +
        "before asking the practitioner for the credential, so a configured machine is not asked again. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "mail__list_folders",
      description:
        "List the mailbox's folders: {folders: [{name, specialUse, selectable}], total, returned}. `name` is the exact " +
        "folder name the other mail tools take; `specialUse` marks the Sent, Drafts, Trash, Junk and Archive roles. On a " +
        "large mailbox pass `prefix`, the case-insensitive start of a folder path, to return only that tree; `total` " +
        "still counts every folder." +
        readOnly +
        errors,
      inputSchema: {
        type: "object",
        properties: { prefix: { type: "string" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "mail__folder_status",
      description:
        "Count one folder's messages: {folder, total, unread, recent, uidNext, uidValidity}. `folder` defaults to INBOX." +
        readOnly +
        errors,
      inputSchema: {
        type: "object",
        properties: { folder },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "mail__get_latest_emails",
      description:
        "The newest `count` messages of a folder (1-200, default 10), newest first: {folder, messages}. " +
        messageShape +
        readOnly +
        errors,
      inputSchema: {
        type: "object",
        properties: { folder, count: { type: "integer", minimum: 1, maximum: 200 }, ...bodyOptions },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "mail__search_emails",
      description:
        "Search one folder by `from`, `to`, `subject` or `body` (each matches when it is contained), `since` (on or " +
        "after, YYYY-MM-DD), `before` (before, YYYY-MM-DD), `seen` and `flagged`; newest first, at most `limit` " +
        "(1-500, default 50). A search does not include the folder's subfolders: search each folder separately. " +
        "Returns {totalFound, returned, messages}; when `returned` is less than `totalFound`, more messages matched than " +
        "were returned. " +
        messageShape +
        readOnly +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          folder,
          from: { type: "string" },
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          since: { type: "string", description: "YYYY-MM-DD" },
          before: { type: "string", description: "YYYY-MM-DD" },
          seen: { type: "boolean" },
          flagged: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 500 },
          ...bodyOptions,
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "mail__get_email",
      description:
        "Read one message in full: {uid, folder, messageId, inReplyTo, date, from, to, cc, replyTo, subject, flags, " +
        "body, bodyFormat, bodyTruncated?, strippedQuoted?, strippedInlineImages?, attachments: [{index, part, " +
        "filename, contentType, size, contentId, inline?}], headers?}. `body_format` text (default) or html; " +
        "`max_length` caps the body (default 20000); `strip_quoted` returns only the newest message of a reply chain " +
        "and works on the text format only, so use text when both are wanted; `strip_inline_images` removes data-URI " +
        "images; `include_headers` adds the raw headers. Fails `mail_not_found` when the UID is not in the folder " +
        "(UIDs change when mail is moved)." +
        readOnly +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          folder,
          uid,
          body_format: { type: "string", enum: ["text", "html"] },
          max_length: { type: "integer", minimum: 1 },
          include_headers: { type: "boolean" },
          strip_quoted: { type: "boolean" },
          strip_inline_images: { type: "boolean" },
        },
        required: ["uid"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "mail__download_attachment",
      description:
        "Save one attachment of a message to a folder the caller names, choosing it by `index` or `filename` as " +
        "mail__get_email lists them. `save_dir` must be the absolute path of an existing folder; the file is saved there " +
        "under the attachment's name and never overwrites (a taken name gets \" (1)\", \" (2)\" and so on). For a PDF, " +
        "`extract_text` (default true) adds `text`, pages separated by a form feed, and `pages`; there is no OCR. " +
        "Returns {saved, path, filename, contentType, size, text?, pages?, textError?}. Writes only that one new file; " +
        "the mailbox is opened read-only, so nothing is marked read." +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          folder,
          uid,
          filename: { type: "string" },
          index: { type: "integer", minimum: 0 },
          save_dir: { type: "string" },
          extract_text: { type: "boolean" },
        },
        required: ["uid", "save_dir"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false },
    },
    {
      name: "mail__save_message",
      description:
        "Save one message as the server stores it, byte for byte, as a .eml file in a folder the caller names, so its " +
        "hash matches any other exact copy and nothing (inline images, headers) is lost to a rebuild from fields. " +
        "`save_dir` must be the absolute path of an existing folder; the file is named from the subject " +
        "(`message-<uid>.eml` when there is none) and never overwrites (a taken name gets \" (1)\", \" (2)\" and so on). " +
        "Returns {saved, path, filename, size, sha256, messageId}. Fails `mail_not_found` when the UID is not in the " +
        "folder. Writes only that one new file; the mailbox is opened read-only, so nothing is marked read." +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          folder,
          uid,
          save_dir: { type: "string" },
        },
        required: ["uid", "save_dir"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false },
    },
    {
      name: "mail__find_email_by_message_id",
      description:
        "Find where a message is now from its Message-ID (angle brackets optional), across every selectable folder: " +
        "{found: [messages]}, each in mail__search_emails' message shape. A mailbox with many folders can exceed the " +
        "30 s limit." +
        readOnly +
        errors,
      inputSchema: {
        type: "object",
        properties: { message_id: { type: "string" } },
        required: ["message_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "mail__find_thread_messages",
      description:
        "The messages of the conversation one message belongs to, matched by Message-ID, In-Reply-To and References, " +
        "oldest first: {threadIds, count, messages}. Searches `search_folders` when given, else INBOX, the Sent folder, " +
        "Archive and `folder`. " +
        messageShape +
        readOnly +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          folder,
          uid,
          search_folders: { type: "array", items: { type: "string" } },
          ...bodyOptions,
        },
        required: ["uid"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "mail__save_draft",
      description:
        "Save an unsent message as a draft: appends the .eml at `eml_path` (an absolute path, such as the file " +
        "drafting_forms__draft_harness's write_email step writes) to `folder`, by default the mailbox's Drafts folder, " +
        "flagged \\Draft and \\Seen. Nothing is sent and nothing else in the mailbox changes; the file is only read. " +
        "Refuses a file that is not a readable message (`not_a_message`) or is larger than 25 MB (`too_large`). " +
        "Returns {saved, folder, uid, messageId}." +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          eml_path: { type: "string" },
          folder: { type: "string", description: "Default: the Drafts folder." },
        },
        required: ["eml_path"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true },
    },
    {
      name: "mail__create_folder",
      description:
        "Create a folder: `name`, inside `parent` when given (an exact folder name from mail__list_folders), else at the " +
        "top level. Returns {created, path}. Refuses a missing parent (`mail_not_found`) and a folder that already " +
        "exists (`mail_folder_exists`)." +
        organizes +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The new folder's own name, without its parent's path." },
          parent: { type: "string", description: "Exact folder name from mail__list_folders. Default: the top level." },
        },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false },
    },
    {
      name: "mail__rename_folder",
      description:
        "Rename a folder, or move it under another folder: `folder` and `new_name` are full folder paths as " +
        "mail__list_folders shows them. Its messages and subfolders go with it. Returns {renamed, from, to}. Refuses " +
        "INBOX and the special-use folders, such as Sent, Drafts, Trash, Junk and Archive (`mail_protected_folder`), a " +
        "missing folder (`mail_not_found`) and a `new_name` already taken (`mail_folder_exists`)." +
        organizes +
        errors,
      inputSchema: {
        type: "object",
        properties: { folder, new_name: { type: "string" } },
        required: ["folder", "new_name"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true },
    },
    {
      name: "mail__move_messages",
      description:
        "Move messages from `folder` to `destination` (exact folder names from mail__list_folders) by their `uids` in " +
        "`folder` (1-500, from a list or search). Only those messages leave `folder`. Uses only the server's MOVE; a " +
        "server without MOVE is refused (`mail_move_unsupported`) and nothing changes. The tool deletes nothing. Moving " +
        "to the Trash folder is a move; the mail server may empty its Trash on its own schedule. Returns {folder, " +
        "destination, moved: [{uid, newUid?}], notFound, notMoved}; `newUid` is the message's UID in `destination`, and " +
        "the old UID no longer works, so use `newUid` afterwards." +
        organizes +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Exact folder name from mail__list_folders." },
          uids: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1, maxItems: 500 },
          destination: { type: "string", description: "Exact folder name from mail__list_folders." },
        },
        required: ["folder", "uids", "destination"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true },
    },
  ];
}
