(function () {
  "use strict";
  var data = window.WORKBOARD;
  var main = document.querySelector("main");
  var header = document.querySelector("header");

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function stamp(value) {
    return value.replace("T", " ");
  }
  // A local minute stamp as a count of minutes, for differences only; null when it is not one.
  function minutesOf(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
  }
  // How long before the page's Rendered minute a stamp is, then the stamp itself.
  function ago(value) {
    var now = minutesOf(data.meta.rendered);
    var then = minutesOf(value);
    if (now === null || then === null) return stamp(value);
    var e = Math.max(0, now - then);
    var d = Math.floor(e / 1440), h = Math.floor((e % 1440) / 60), m = e % 60;
    var text = d > 0 ? d + " d " + h + " h" : h > 0 ? h + " h " + m + " min" : m + " min";
    return text + " ago (" + stamp(value) + ")";
  }

  if (!data) return;

  var meta = data.meta;
  if (meta.matter !== "") document.title = "Job Board — " + meta.matter;

  // One header span: its text, and its label in data-k when it has one. A blank value draws nothing.
  function metaSpan(row, label, value) {
    if (!value) return;
    var span = el("span", "", value);
    if (label) span.setAttribute("data-k", label);
    row.appendChild(span);
  }
  // A row of dates, each as stored with no day count, its label in data-k and its flag after it.
  function dateRow(cls, list) {
    var row = el("div", cls);
    list.forEach(function (d) {
      var span = el("span", "", d.date);
      span.setAttribute("data-k", d.label);
      if (d.flag) span.appendChild(el("span", "flag", d.flag));
      row.appendChild(span);
    });
    return row;
  }

  // The matter and the client, the client's number in brackets when it has one.
  var metaRow = header.querySelector(".meta");
  metaSpan(metaRow, "Matter", meta.matter);
  metaSpan(metaRow, "Client", meta.client ? meta.client + (meta.client_no ? " (" + meta.client_no + ")" : "") : "");

  // A section's lifecycle state, with its date when it has one.
  function stateText(smeta) {
    return smeta.state_since === null ? smeta.state_label : smeta.state_label + " " + smeta.state_since;
  }

  // The page's one section names the page: "Job Board <id>", the id the file name's, then the
  // heading's gold rule, then the Writing's title on its own line.
  // A merged board's page (docs/ADRs/0010) is named by its survivor, and its one section is every
  // merged board's, pooled on the server: each job card names its Writing.
  var first = data.sections[0];
  var merged = !!data.board;
  if (merged) {
    header.querySelector("h1").textContent = data.board.filing_id === null ? "Job Board: Proceeding " + data.board.proceeding_id : "Job Board " + data.board.filing_id;
  } else if (first) {
    var h1 = header.querySelector("h1");
    if (first.meta.filing_id === null) {
      h1.textContent = "Job Board: Proceeding " + first.meta.proceeding_id;
    } else {
      h1.textContent = "Job Board " + first.meta.filing_id;
      if (first.meta.filing) h1.after(el("p", "writing-title", first.meta.filing));
    }
  }

  // The section's proceeding: its venue (the forum's last segment), registry, court file number and
  // style of proceeding, a dot between each two drawn, only the file number labelled. A page with no
  // Goal card shows the section's state here, as a chip. No row when there is nothing to draw.
  var venueRow = el("div", "meta proceeding");
  function proceedingPart(label, value) {
    if (!value) return;
    if (venueRow.children.length > 0) venueRow.appendChild(document.createTextNode(" · "));
    metaSpan(venueRow, label, value);
  }
  proceedingPart("", (meta.forum || "").split("/").pop());
  proceedingPart("", meta.registry ? meta.registry + " Registry" : "");
  proceedingPart("Court File No.", meta.file_number || "");
  proceedingPart("", meta.style_of_cause || "");
  if (first && !first.goal) venueRow.appendChild(el("span", "chip", stateText(first.meta)));
  if (venueRow.children.length > 0) header.appendChild(venueRow);

  // The page's dates (ADR 0013, 2026-10-04 amendments): this Writing's row, every anchor linked to a
  // filing on this page with each deadline no Goal card carries, absent when there is none; then the
  // matter's row, holding the other anchors the same way. A note says why none were read, or that
  // the matter has none; when every date is this Writing's, the matter's row is not drawn.
  var pageDates = data.dates;
  if (pageDates) {
    var writing = pageDates.writing || [];
    if (writing.length > 0) header.appendChild(dateRow("meta writing", writing));
    if (pageDates.note !== undefined) {
      var noteRow = el("div", "meta dates");
      noteRow.appendChild(el("span", "note", pageDates.note));
      header.appendChild(noteRow);
    } else if (pageDates.header.length > 0) {
      header.appendChild(dateRow("meta dates", pageDates.header));
    } else if (writing.length === 0) {
      var noneRow = el("div", "meta dates");
      noneRow.appendChild(el("span", "note", "No date is recorded for this matter."));
      header.appendChild(noneRow);
    }
  }

  // The page's section, named by the page heading, with its own Goal card and lanes drawn as a
  // filing's board always drew them.
  data.sections.forEach(function (section, i) {
    var smeta = section.meta;
    if (smeta.ready_to_retire) {
      main.appendChild(el("p", "notice", "Appeal period expired " + smeta.state_since + " — ready to retire"));
    }
    // A merged board's Writings each say so for themselves.
    (smeta.writing_states || []).forEach(function (w) {
      if (w.ready_to_retire) main.appendChild(el("p", "notice", w.title + ": appeal period expired " + w.state_since + " — ready to retire"));
    });
    var board = el("div", "board");
    if (smeta.filing_id !== null) board.setAttribute("data-filing-id", String(smeta.filing_id));
    board.setAttribute("data-proceeding-id", String(smeta.proceeding_id));
    main.appendChild(board);
    // This filing's deadline criteria's dates, by criterion id, joined to its Goal card here.
    var when = pageDates && smeta.filing_id !== null ? pageDates.criteria[String(smeta.filing_id)] || {} : {};
    // The board's Goal card, Writings strip and page-wide lanes draw once, with the first section.
    drawSection(section, board, when, i === 0 ? data.strip || [] : [], i === 0 ? data.attached || [] : [], i === 0 ? data.court_file || [] : [], i === 0);
  });

  function drawSection(data, board, when, items, attached, courtFile, firstSection) {
    function link(id) {
      var a = el("a", "", "Job #" + id);
      a.href = "#ticket-" + id;
      return a;
    }
    // An edge outside this proceeding has no card to link to: named in plain text, never dropped.
    function ticketRef(edge) {
      return edge.status === null ? "Job #" + edge.id + " (not in this proceeding)" : link(edge.id);
    }
    function row(dl, term, parts, mono) {
      dl.appendChild(el("dt", "", term));
      var dd = el("dd", mono ? "mono" : "");
      [].concat(parts).forEach(function (part) {
        dd.appendChild(typeof part === "string" ? document.createTextNode(part) : part);
      });
      dl.appendChild(dd);
    }
    function pct(done, total) {
      var raw = (done / total * 100).toFixed(1);
      return (raw.slice(-2) === ".0" ? raw.slice(0, -2) : raw) + "%";
    }

    var CHIPS = {
      ready: ["ready", "Ready"],
      wip: ["wip", "In Progress"],
      bring_forward: ["bring-forward", "Bring Forward"],
      waiting: ["waiting", "Blocked"],
      superseded: ["superseded", "Superseded"],
      completed: ["done", "Completed"],
      rejected: ["rejected", "Shelved"]
    };

    // Panels list by job number so a job is easy to find. The summary a session reads keeps queue
    // order (priority, then id), which is the Dispatch rule; filter() returns a copy, so data.tickets
    // is never reordered.
    function byId(a, b) { return a.id - b.id; }

    // A step's state (step-state.ts, schema v78): done always wins; a waiting step whose minute has
    // come, by this browser's clock, reads as open again.
    function localMinute() {
      var d = new Date();
      function two(n) { return (n < 10 ? "0" : "") + n; }
      return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + "T" + two(d.getHours()) + ":" + two(d.getMinutes());
    }
    function stepState(s) {
      if (s.done_at !== null) return "done";
      if (s.status === "waiting") return s.wait_until && s.wait_until.replace(" ", "T").slice(0, 16) > localMinute() ? "waiting" : "open";
      if (s.status === "retry" || s.status === "cancelled" || s.status === "deferred") return s.status;
      return "open";
    }

    function ticketCard(t) {
      var card = el("details", "ticket");
      card.setAttribute("name", "board");
      card.id = "ticket-" + t.id;
      card.setAttribute("data-kind", t.kind);
      card.setAttribute("data-priority", String(t.priority));
      card.setAttribute("data-status", t.category);

      var summary = el("summary");
      summary.appendChild(el("span", "ref", "Job #" + t.id));
      summary.appendChild(el("span", "title", t.title));
      // On a merged board, the Writing the job serves, drawn as given.
      if (t.writing) summary.appendChild(el("span", "subtitle", t.writing));
      // Finished on the server (Goal card design §4.7), drawn as given.
      if (t.subtitle) summary.appendChild(el("span", "subtitle", t.subtitle));
      // An unattended run's lock, finished on the server (Goal card design §5.4) and drawn as given.
      if (t.lock_note) summary.appendChild(el("span", "subtitle", t.lock_note));
      // Idle past the firm's threshold, finished on the server and drawn as given.
      if (t.idle_flag) summary.appendChild(el("span", "subtitle", t.idle_flag));
      // The job's start date as a plain date: never a deadline, and never a day count.
      if (t.category === "bring_forward") summary.appendChild(el("span", "subtitle", "Bring forward " + t.bf_on));
      var progress = el("span", "progress");
      progress.appendChild(el("span", "chip " + CHIPS[t.category][0], CHIPS[t.category][1]));
      // A General Job (no Writing) is on every Writing's board in its proceeding: tagged so a second
      // board's copy never reads as a duplicate. Not a subtitle, as board_card's line ends with it.
      if (t.general) progress.appendChild(el("span", "chip general", "General"));
      // No bar and no count on a ticket with no steps -- "0/0" beside an empty bar is noise.
      if (t.steps.length > 0) {
        var done = t.steps.filter(function (s) { return s.done_at !== null; }).length;
        var bar = el("span", "bar");
        bar.style.setProperty("--pct", pct(done, t.steps.length));
        bar.appendChild(el("i"));
        progress.appendChild(bar);
        progress.appendChild(document.createTextNode(done + "/" + t.steps.length));
      }
      summary.appendChild(progress);
      card.appendChild(summary);

      var body = el("div", "body");
      // Why the ticket is superseded, finished on the server (Goal card design §4.7) and drawn as given.
      if (t.superseded_reason) body.appendChild(el("p", "reason", t.superseded_reason));
      if (t.steps.length > 0) {
        var ol = el("ol", "steps");
        var nextMarked = false;
        t.steps.forEach(function (s) {
          var cls = stepState(s);
          if (cls === "open") {
            cls = nextMarked ? "" : "next";
            nextMarked = true;
          }
          var li = ol.appendChild(el("li", cls, s.text));
          // The minute the session checks the process again, as a plain time: never a countdown.
          if (cls === "waiting") li.appendChild(el("span", "until", " until " + s.wait_until.slice(11, 16)));
        });
        body.appendChild(ol);
      }
      // Sources to get: the job's own record beside its steps, never part of its plan, so they sit
      // under a heading of their own and outside the step count.
      if (t.sources.length > 0) {
        var got = t.sources.filter(function (s) { return s.outcome === "got"; }).length;
        body.appendChild(el("p", "sources-head", "Sources to get: " + got + " of " + t.sources.length + " got"));
        var sources = el("ol", "steps");
        t.sources.forEach(function (s) {
          var missed = s.outcome === "not_retrieved" ? " (not retrieved" + (s.reason ? ": " + s.reason : "") + ")" : "";
          sources.appendChild(el("li", s.outcome === "got" ? "done" : "", s.kind + ": " + s.label + missed));
        });
        body.appendChild(sources);
      }

      var dl = el("dl");
      // Progress is recorded progress only, so it agrees with the idle flag; Session active is the
      // holder's end-of-turn stamp (jobs-run.md §6a), which is not progress; Taken is the lock.
      if (t.category === "wip") {
        row(dl, "Progress", t.last_activity_at === null ? "(none recorded)" : ago(t.last_activity_at), true);
        if (t.active_at) row(dl, "Session active", ago(t.active_at), true);
        row(dl, "Taken", t.locked_at === null ? "(unknown time)" : stamp(t.locked_at), true);
      }
      if (t.category === "completed" && t.completed_at) row(dl, "Completed", stamp(t.completed_at), true);
      row(dl, "Priority", String(t.priority), true);
      // A job superseded by another job, a stale gate job included (#907), says so only here.
      if (t.category === "superseded" && t.superseded_by) row(dl, "Superseded by", ticketRef(t.superseded_by));
      // Each blocker says why by its own status: a superseded or shelved one needs a fresh outline.
      if (t.category === "waiting") {
        t.blocked_by.filter(function (b) { return b.status !== "completed"; }).forEach(function (b) {
          if (b.status === "superseded" || b.rejected) row(dl, "Blocked by", [ticketRef(b), " — superseded, needs a fresh outline"]);
          else row(dl, "Blocked by", t.circular ? [ticketRef(b), " — circular, needs a fresh outline"] : ticketRef(b));
        });
      }
      t.conflicts.forEach(function (p) {
        row(dl, "Either/or", p.status === "wip" ? [ticketRef(p), " — in progress"] : ticketRef(p));
      });
      body.appendChild(dl);
      card.appendChild(body);
      return card;
    }

    // A struck line's Restore link. It only copies the instruction for the practitioner to paste into
    // a session. It writes to no database, file or server (ADR 0015, 2026-10-05 amendment).
    function restoreLink(instruction) {
      var restore = el("a", "", "Restore");
      restore.href = "#";
      // Where the clipboard is out of reach, the instruction itself is shown, to select and copy by hand.
      function showInstruction() { restore.textContent = instruction; }
      restore.addEventListener("click", function (event) {
        event.preventDefault();
        if (!navigator.clipboard || !navigator.clipboard.writeText) { showInstruction(); return; }
        navigator.clipboard.writeText(instruction).then(function () {
          restore.textContent = "Copied";
          setTimeout(function () { restore.textContent = "Restore"; }, 1500);
        }, showInstruction);
      });
      return restore;
    }

    // A deleted job (schema v54): one struck line in Completed, never a card. Two spaces follow the
    // colon; the stylesheet keeps them.
    function deletedLine(d) {
      var line = el("p", "deleted");
      line.appendChild(el("s", "", "Job #" + d.id + ":  " + d.title));
      line.appendChild(document.createTextNode(" *DELETED* "));
      line.appendChild(restoreLink("restore job #" + d.id));
      return line;
    }

    // A loose thread that left the board (schema v75), never a card: a discarded one is a struck line
    // with a Restore link, as a deleted job is, and a suggested one a plain line with no link.
    function discardedSeedLine(s) {
      if (!s.discarded_at) return el("p", "suggested", "Loose thread " + s.id + ":  " + s.idea + " *SUGGESTED*");
      var line = el("p", "deleted");
      line.appendChild(el("s", "", "Loose thread " + s.id + ":  " + s.idea));
      line.appendChild(document.createTextNode(" *DISCARDED* "));
      line.appendChild(restoreLink("restore loose thread #" + s.id));
      return line;
    }

    function seedCard(s) {
      var card = el("details", "seed");
      card.setAttribute("name", "board");
      card.id = "seed-" + s.id;
      var summary = el("summary");
      summary.appendChild(el("span", "title", s.idea));
      if (s.from_filing !== null) summary.appendChild(el("span", "subtitle", "from " + s.from_filing));
      card.appendChild(summary);
      var body = el("div", "body");
      var dl = el("dl");
      row(dl, "Surfaced by", s.surfaced_by);
      // A sibling filing's job has no card on this board, so it is named, not linked.
      if (s.origin_ticket_id !== null) row(dl, "From", s.from_filing === null ? link(s.origin_ticket_id) : "Job #" + s.origin_ticket_id + " on " + s.from_filing);
      row(dl, "Created", stamp(s.created), true);
      body.appendChild(dl);
      card.appendChild(body);
      return card;
    }

    // A draft that is not a Writing, attached to this board (ADR 0042): a client letter's folder or a
    // reply's file, drawn as plain text with no link (shared/html-pages.md, "Cards only, no link"). A
    // client letter's counsel's-review status is its review draft's first line, read at this write and
    // drawn as given; a path with nothing at it, or one that could not be read, says so, never dropped.
    var ATTACHED_KINDS = { client_letter: "Client letter", reply: "Reply" };
    var ATTACHED_CUE = "To open, move or detach an attached draft, tell a session.";
    function attachedCard(a) {
      var card = el("details", "seed attachment");
      card.setAttribute("name", "board");
      card.id = "attachment-" + a.id;
      var summary = el("summary");
      summary.appendChild(el("span", "title", a.name));
      var status = "";
      if (a.state === "missing") status = "Missing: nothing is at this path";
      else if (a.state === "outside") status = "Not in the draft folder";
      else if (a.state === "unreadable") status = "Unreadable: " + (a.error || "error");
      else if (a.kind === "client_letter") {
        status = a.review.length === 0 ? "No review draft found"
          : a.review.length === 1 ? "Counsel's review: " + a.review[0].status
          : "Counsel's review: " + a.review.length + " review drafts";
      }
      summary.appendChild(el("span", "subtitle", ATTACHED_KINDS[a.kind] + (status ? " · " + status : "")));
      card.appendChild(summary);
      var body = el("div", "body");
      var dl = el("dl");
      row(dl, "Path", a.path, true);
      row(dl, "Attached", a.attached_on, true);
      if (a.proceeding_wide) row(dl, "Board", "No Writing: shown on this proceeding's first live Writing's board until it is moved to a Writing");
      a.review.forEach(function (r) { row(dl, "Review draft", r.file + " — " + r.status); });
      body.appendChild(dl);
      card.appendChild(body);
      return card;
    }

    // A relied-on affidavit whose court-file name disagrees with drafting data: one card each, drawn as
    // plain text with no link. The server sends the finished text; the shell derives nothing.
    var COURT_FILE_CUE = "To record the court file's date in the drafting data, tell a session.";
    function courtFileCard(a) {
      var card = el("details", "seed court-file");
      card.setAttribute("name", "board");
      card.id = "court-file-" + a.document_id;
      var summary = el("summary");
      summary.appendChild(el("span", "title", a.label));
      summary.appendChild(el("span", "subtitle", a.mismatch));
      card.appendChild(summary);
      var body = el("div", "body");
      var dl = el("dl");
      if (a.court_file) row(dl, "Court file", a.court_file.file_name, true);
      row(dl, "Drafting data", a.recorded.made_on ? "made " + a.recorded.made_on : "unsworn");
      body.appendChild(dl);
      card.appendChild(body);
      return card;
    }

    // Proposals (design §13). The shell draws the lane the server assigned and derives none of its
    // own (local-only design §5): it reads the lane, never a marker, a ticket or a rejection. The
    // Shelved lane is read-only, so no line carries a checkbox, a red X, a Go button or any other control.
    // Approval is by naming a Proposal to a session (ADR 0015: nothing on the board writes back).
    var PROPOSAL_CUE = "To shelve or restore an item, tell a session. Restore on a deleted job copies the instruction for you to paste.";

    // The card header's work name: the title without its trailing ": " + label. Derived rather than
    // listed, because one work name carries a colon of its own.
    function workName(p) {
      var tail = ": " + p.label;
      return p.title.slice(-tail.length) === tail ? p.title.slice(0, -tail.length) : p.title;
    }
    // A witnesses-keyed count is displayed beside the item, never inside it (design §8).
    function itemCount(p) {
      return p.count === undefined ? "" : " — " + p.count;
    }
    // Text, then glyph, left-aligned, with any status pinned right. Only the text truncates in CSS:
    // the glyph sits in a span of its own that never shrinks, so a clipped line keeps the glyph that
    // names its work. The tooltip on the row carries the whole line, glyph included.
    function proposalLine(p, text) {
      var li = el("li");
      var label = el("span", "line");
      label.appendChild(el("span", "text", text + itemCount(p)));
      // The space belongs to the glyph so the row still reads as one sentence when it is copied or
      // read out; the stylesheet keeps it rather than collapsing it away.
      label.appendChild(el("span", "glyph", " " + p.marker));
      li.title = label.textContent;
      li.appendChild(label);
      // §7: a Proposal held by a ticket on another filing stays visible and inert, so no work
      // disappears silently. One held by a ticket on this board's own filing is not drawn at all.
      if (p.lane === "held") li.appendChild(el("span", "status", "already a job on " + p.holder.ticketed_on));
      return li;
    }
    function proposalCard(items) {
      var card = el("div", "proposal");
      if (items.length > 1) {
        var markers = [];
        items.forEach(function (p) { if (markers.indexOf(p.marker) < 0) markers.push(p.marker); });
        card.appendChild(el("p", "head", workName(items[0]) + " " + markers.join(" ") + " — " + items.length));
      }
      var lines = el("ul", "lines");
      // A card of one collapses to that item's own line, whose title already reads work name plus item.
      items.forEach(function (p) { lines.appendChild(proposalLine(p, items.length === 1 ? p.title : p.item)); });
      card.appendChild(lines);
      return card;
    }
    // Grouped by slug in server order, which is card order. The two primary-authority markers already
    // share one slug on the server, so they land on one card with no special case here. No glyph is
    // written into this code: every one on the board comes from the render's own inventory.
    function proposalCards(drawn) {
      var order = [];
      var bySlug = Object.create(null);
      data.proposals.forEach(function (p) {
        if (!drawn(p)) return;
        if (bySlug[p.slug] === undefined) {
          bySlug[p.slug] = [];
          order.push(p.slug);
        }
        bySlug[p.slug].push(p);
      });
      return order.map(function (slug) { return proposalCard(bySlug[slug]); });
    }

    // Every section always renders, with a count -- an empty one is itself the answer to
    // "is anything ready to assign?" The count is the cards' unless given: Completed counts only
    // its completed jobs, never the deleted lines drawn among them.
    function section(id, heading, emptyText, cards, cue, count) {
      var sec = el("section");
      sec.id = id;
      var h2 = el("h2", "", heading + " ");
      h2.appendChild(el("span", "count", String(count === undefined ? cards.length : count)));
      sec.appendChild(h2);
      if (cards.length === 0) {
        sec.appendChild(el("p", "empty", emptyText));
      } else {
        var stack = el("div", "stack");
        cards.forEach(function (c) { stack.appendChild(c); });
        sec.appendChild(stack);
      }
      if (cue !== undefined) sec.appendChild(el("p", "cue", cue));
      board.appendChild(sec);
    }

    // The Goal card (Goal card design §2.9), above the first lane. The server sends the sentence, the
    // card string and every criterion finished, so the shell derives none of them. A pre-filing board
    // sends no goal and gets no card (§2.1). With no criteria (a retired filing, a kind with no stock
    // list) there is nothing to expand, so the card is not expandable.
    var STATES = { met: "Met", unmet: "Unmet", pending: "Pending" };
    // A deadline criterion's date as stored, then its review flag (ADR 0013, second 2026-10-04
    // amendment). The section's data carries no date; the page's dates are joined here.
    function deadlineDate(node, c) {
      var d = when[c.id];
      if (!d) return;
      node.appendChild(el("span", "date", d.date));
      if (d.flag) node.appendChild(el("span", "dflag", d.flag));
    }
    // A criterion's fold-out label. Markers print only where work is open, so the board counts the
    // unmet items and never a total. A row with nothing outstanding holds informational lines. On a
    // merged board an item two Writings share prints once; `counts` then still counts every one.
    function itemsLabel(c) {
      var total = c.counts ? c.counts.items : c.items.length;
      if (c.source !== "inventory" && c.outstanding === 0) {
        return "Show " + total + (total === 1 ? " note" : " notes");
      }
      var label = c.outstanding + (c.outstanding === 1 ? " item is unmet" : " items are unmet");
      if (c.source !== "inventory") return label;
      // Relies on inventoryCriterion listing the open items first, then the shelved, then the suppressed.
      var suppressed = c.counts ? c.counts.suppressed : c.replaces ? c.replaces.filter(function (r) { return r !== null; }).length : 0;
      var shelved = total - c.outstanding - suppressed;
      if (shelved > 0) label += ", " + shelved + " shelved";
      return suppressed > 0 ? label + ", " + suppressed + " suppressed" : label;
    }
    function goalCard(goal, criteria) {
      var expands = criteria.length > 0;
      var card = el(expands ? "details" : "div", "goal");
      card.id = "goal";
      card.setAttribute("data-state", goal.state);
      var head = el(expands ? "summary" : "div", "head");
      head.appendChild(el("span", "sentence", goal.sentence));
      // The Writing's lifecycle state beside the sentence, so it shows whether the card is open or closed.
      // A merged board's is one state, its Writings' least advanced, finished on the server.
      head.appendChild(document.createTextNode(" "));
      head.appendChild(el("span", "lifecycle", stateText(data.meta)));
      if (goal.text !== null) head.appendChild(el("span", "text", goal.text));
      // An unmet deadline stays in the head, so it shows whether the card is open or closed.
      criteria.forEach(function (c) {
        if (c.source !== "practice" || c.state !== "unmet") return;
        var line = el("span", "deadline");
        line.appendChild(el("span", "", c.text));
        deadlineDate(line, c);
        head.appendChild(line);
      });
      card.appendChild(head);
      if (!expands) return card;
      var list = el("ul", "criteria");
      criteria.forEach(function (c) {
        var li = el("li", "criterion");
        li.setAttribute("data-criterion", c.id);
        li.setAttribute("data-state", c.state);
        var line = el("p", "line");
        line.appendChild(el("span", "ctext", c.text));
        if (c.source === "practice") deadlineDate(line, c);
        // No count on a criterion with nothing outstanding -- "Met — 0" is noise.
        line.appendChild(el("span", "state", STATES[c.state] + (c.outstanding > 0 ? " — " + c.outstanding : "")));
        li.appendChild(line);
        if (c.items.length > 0) {
          // Closed until clicked, so a long list never buries the criterion lines. Printing opens it.
          var more = el("details", "items");
          more.appendChild(el("summary", "", itemsLabel(c)));
          var items = el("ul", "items");
          c.items.forEach(function (item, i) {
            var row = el("li", "", item);
            // A suppressed item's 🤫 shows the marker it replaces on hover (schema v69).
            if (c.replaces && c.replaces[i]) row.title = "🤫 replaces " + c.replaces[i] + ": the requirement stands, set aside by you";
            items.appendChild(row);
          });
          more.appendChild(items);
          li.appendChild(more);
        }
        list.appendChild(li);
      });
      card.appendChild(list);
      return card;
    }
    // The statement of goals' card, labelled Goal, on every board, at the top of the section above the
    // Completion Criteria card. Closed, it shows the description; open, the statement as stored. The
    // server sends both finished, so the shell derives neither. Printing opens it, as it opens every
    // details.goal.
    function goalsCard(g) {
      var card = el("details", "goal goals");
      card.id = "goals";
      card.setAttribute("data-status", g.status || "none");
      var head = el("summary", "head");
      head.appendChild(el("span", "sentence", g.description));
      head.appendChild(document.createTextNode(" "));
      head.appendChild(el("span", "label", "Goal"));
      card.appendChild(head);
      var body = el("div", "goals-body");
      var merged = g.merged || [];
      if (g.statement === null && merged.length === 0) {
        body.appendChild(el("p", "none", "No statement of goals yet"));
      } else if (merged.length === 0) {
        if (g.status === "inferred") body.appendChild(el("p", "caption", "Inferred, not confirmed"));
        body.appendChild(statementRows(g.statement, g.status));
      } else {
        // A merged board (docs/ADRs/0010): its own statement, then each merged board's, each with its own status.
        [{ statement: g.statement, status: g.status }].concat(merged).forEach(function (s) {
          if (s.statement === null) return;
          var part = el("div", "goals-part");
          part.setAttribute("data-status", s.status);
          if (s.status === "inferred") part.appendChild(el("p", "caption", "Inferred, not confirmed"));
          part.appendChild(statementRows(s.statement, s.status));
          body.appendChild(part);
        });
      }
      card.appendChild(body);
      return card;
    }
    // The statement as rows, one per stored line, each indented 1.5em per level of two spaces. A
    // labelled line puts its label in a cell of its own, so a wrapped line returns to the text's left
    // edge; a connector line is one text cell; any other line is printed as written.
    function statementRows(statement, status) {
      var wrap = el("div", "statement");
      statement.split("\n").forEach(function (line) {
        var row = el("div", "row");
        var indent = /^ */.exec(line)[0].length;
        row.style.marginLeft = (indent / 2) * 1.5 + "em";
        var m = /^( *)(Goal[^:\n]*?)(, (?:any one|both|all) of)?:\s?(.*)$/.exec(line);
        var trimmed = line.trim();
        if (m) {
          row.appendChild(el("span", "label", m[2] + (m[3] || "") + ":"));
          row.appendChild(el("span", "text", m[4]));
        } else if (trimmed === "or alternatively," || trimmed === "and") {
          row.appendChild(el("span", status !== "inferred" ? "text connector" : "text", trimmed));
        } else {
          row.appendChild(el("span", "text", line));
        }
        wrap.appendChild(row);
      });
      return wrap;
    }
    if (firstSection) board.appendChild(goalsCard(data.goals));

    if (data.goal) board.appendChild(goalCard(data.goal, data.criteria));

    // The board's thumbnails in one row between the Goal card and Ready, in the order the server gave:
    // the viewed ones first, most recently viewed first, then the never-viewed ones, the Writings'
    // documents before the view pages. A Writing's tile shows its short label, and a screen reader
    // reads the fuller one instead. On hover the fuller one shows in a single tooltip on the body. A
    // view page's tile is the same size and badged; it is dashed until it is first viewed. No tile is
    // a control.
    if (items.length > 0) {
      var strip = el("ol", "writings");
      strip.setAttribute("aria-label", "Writings");
      items.forEach(function (item) {
        if (item.kind === "writing") {
          var li = el("li", "writing");
          li.setAttribute("data-long", item.long);
          var label = el("span", "label", item.short);
          label.setAttribute("aria-hidden", "true");
          li.appendChild(label);
          li.appendChild(el("span", "sr", item.long));
          strip.appendChild(li);
          return;
        }
        var tile = el("li", item.viewed ? "writing view" : "writing view unviewed");
        var long = item.name + " (view page: ask a session to show it)";
        tile.setAttribute("data-long", long);
        var badge = el("span", "badge", "view");
        badge.setAttribute("aria-hidden", "true");
        tile.appendChild(badge);
        var name = el("span", "label", item.name);
        name.setAttribute("aria-hidden", "true");
        tile.appendChild(name);
        tile.appendChild(el("span", "sr", long));
        strip.appendChild(tile);
      });
      board.appendChild(strip);

      var tip = el("div", "tip");
      tip.setAttribute("role", "tooltip");
      tip.hidden = true;
      document.body.appendChild(tip);
      strip.addEventListener("mouseover", function (event) {
        var tile = event.target.closest(".writing");
        if (!tile) return;
        tip.textContent = tile.getAttribute("data-long");
        tip.hidden = false;
        var r = tile.getBoundingClientRect();
        var t = tip.getBoundingClientRect();
        var top = r.bottom + 6 + t.height > window.innerHeight ? r.top - 6 - t.height : r.bottom + 6;
        var left = Math.max(4, Math.min(r.left, document.documentElement.clientWidth - t.width - 4));
        tip.style.top = top + "px";
        tip.style.left = left + "px";
      });
      strip.addEventListener("mouseout", function (event) {
        if (!event.relatedTarget || !event.relatedTarget.closest || !event.relatedTarget.closest(".writing")) tip.hidden = true;
      });
      strip.addEventListener("scroll", function () { tip.hidden = true; });
    }

    function jobSection(category, id, heading, emptyText) {
      var tickets = data.tickets.filter(function (t) { return t.category === category; });
      var items = tickets.map(function (t) { return { id: t.id, node: ticketCard(t) }; });
      // Completed also draws each deleted job's struck line, in job-number order among the cards.
      if (category === "completed") {
        items = items.concat(data.deleted.map(function (d) { return { id: d.id, node: deletedLine(d) }; }));
      }
      section(id, heading, emptyText, items.sort(byId).map(function (item) { return item.node; }), undefined, tickets.length);
    }
    jobSection("ready", "ready", "Ready", "Nothing ready to assign.");
    jobSection("wip", "in-progress", "In Progress", "Nothing in progress.");
    jobSection("bring_forward", "bring-forward", "Bring Forward", "Nothing held for a bring-forward date.");
    jobSection("waiting", "waiting-on", "Blocked", "Nothing blocked.");
    jobSection("completed", "completed", "Completed", "Nothing completed.");
    // Shelved holds shelved tickets and the Proposals shelved directly. A Proposal hidden
    // by a shelved ticket's snapshot row never reaches the board at all, so it gets no line here.
    section(
      "rejected-angles",
      "Shelved",
      "Nothing shelved.",
      data.tickets.filter(function (t) { return t.category === "rejected"; }).sort(byId).map(ticketCard)
        .concat(proposalCards(function (p) { return p.lane === "rejected"; })),
      PROPOSAL_CUE
    );
    jobSection("superseded", "superseded", "Superseded", "Nothing superseded.");
    // A filing's loose threads have their own view page (ADR 0033, 2026-10-08): its board counts them
    // and, in plain text, says to ask a session for that page: no page links to another. A pre-filing
    // board has no view page, so it lists them, the discarded and suggested ones after the open ones.
    // Either way the count is the open threads'.
    var threadsPage = (window.WORKBOARD.strip || []).filter(function (v) { return v.kind === "view" && v.name === "Loose Threads"; })[0];
    if (threadsPage && (data.seeds.length > 0 || data.discardedSeeds.length > 0)) {
      var pointer = el("p", "cue", "To see them, ask a session to show the " + threadsPage.name + " page.");
      section("ideas", "Loose Threads", "No loose threads.", [pointer], undefined, data.seeds.length);
    } else {
      section("ideas", "Loose Threads", "No loose threads.", data.seeds.map(seedCard).concat(data.discardedSeeds.map(discardedSeedLine)), undefined, data.seeds.length);
    }
    section("attached", "Attached", "Nothing attached.", attached.map(attachedCard), attached.length > 0 ? ATTACHED_CUE : undefined);
    if (courtFile.length > 0) section("court-file", "Court File", "", courtFile.map(courtFileCard), COURT_FILE_CUE);
  }
})();
