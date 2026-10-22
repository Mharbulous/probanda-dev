import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLegislationCurrency, instrumentKey } from "../build/legislation-currency.js";

const DATABASES = {
	legislationDatabases: [
		{ databaseId: "bcs", type: "STATUTE", jurisdiction: "bc", name: "Statutes of British Columbia" },
		{ databaseId: "bcr", type: "REGULATION", jurisdiction: "bc", name: "Regulations of British Columbia" },
		{ databaseId: "bcsa", type: "STATUTE", jurisdiction: "bc", name: "Archived Statutes of British Columbia" },
		{ databaseId: "cas", type: "STATUTE", jurisdiction: "ca", name: "Statutes of Canada" },
	],
};

const ITEMS = {
	bcs: [{ databaseId: "bcs", legislationId: "sbc-2012-c-13", title: "Limitation Act", citation: "SBC 2012, c 13", type: "STATUTE" }],
	bcr: [
		{ databaseId: "bcr", legislationId: "bc-reg-168-2009", title: "Supreme Court Civil Rules", citation: "BC Reg 168/2009", type: "REGULATION" },
		{ databaseId: "bcr", legislationId: "bc-reg-169-2009", title: "Supreme Court Family Rules", citation: "BC Reg 169/2009", type: "REGULATION" },
	],
	bcsa: [{ databaseId: "bcsa", legislationId: "rsbc-1996-c-266", title: "Limitation Act", citation: "RSBC 1996, c 266", type: "STATUTE" }],
	cas: [],
};

const METADATA = {
	"bcs/sbc-2012-c-13": { legislationId: "sbc-2012-c-13", url: "https://www.canlii.org/x", title: "Limitation Act", citation: "SBC 2012, c 13", startDate: "2013-06-01", repealed: "NO", endDate: "" },
	"bcr/bc-reg-168-2009": { legislationId: "bc-reg-168-2009", url: "https://www.canlii.org/y", title: "Supreme Court Civil Rules", citation: "BC Reg 168/2009", startDate: "2026-05-04", repealed: "NO" },
	"bcsa/rsbc-1996-c-266": { legislationId: "rsbc-1996-c-266", url: "https://www.canlii.org/z", title: "Limitation Act", citation: "RSBC 1996, c 266" },
};

/** A fake CanLII API: each path answers from the tables above; `fail` makes a path throw a set number of times. */
function fakeApi(fail = {}) {
	const calls = [];
	const getJson = async (path) => {
		calls.push(path);
		if (fail[path] > 0) {
			fail[path] -= 1;
			throw new Error("HTTP 502");
		}
		const parts = path.split("/").filter(Boolean);
		if (parts.length === 2) return DATABASES;
		if (parts.length === 3) return { legislations: ITEMS[parts[2]] };
		const metadata = METADATA[`${parts[2]}/${parts[3]}`];
		if (!metadata) throw new Error("HTTP 404");
		return metadata;
	};
	return { getJson, calls };
}

const TODAY = "2026-10-22";

/** BC Laws unreachable: the amendment check reads `unknown`, which these CanLII tests do not look at. */
const offline = async () => { throw new Error("HTTP 503"); };

const check = (instruments, getJson, getText = offline) =>
	checkLegislationCurrency(instruments, getJson, getText, TODAY);

const LIMITATION = { citation: "S.B.C. 2012, c. 13", title: "Limitation Act", jurisdiction: "bc" };

test("a citation matches ignoring periods and case; CanLII's 'NO' and an empty endDate read as current", async () => {
	const { getJson } = fakeApi();
	const { instruments: [result] } = await check([LIMITATION], getJson);
	assert.equal(result.currency, "current");
	assert.equal(result.databaseId, "bcs");
	assert.equal(result.returned_citation, "SBC 2012, c 13");
	assert.equal(result.error, null);
});

test("a regulation cited with periods matches CanLII's unpunctuated citation", async () => {
	const { getJson } = fakeApi();
	const { instruments: [result] } = await check(
		[{ citation: "B.C. Reg. 168/2009", title: "Supreme Court Civil Rules", jurisdiction: "bc" }], getJson);
	assert.equal(result.currency, "current");
	assert.equal(result.legislationId, "bc-reg-168-2009");
});

test("a title hit whose citation differs is a near item, never a match", async () => {
	const { getJson } = fakeApi();
	const { instruments: [result] } = await check(
		[{ citation: "B.C. Reg. 28/2024", title: "Supreme Court Civil Rules", jurisdiction: "bc" }], getJson);
	assert.equal(result.currency, "not-found");
	assert.deepEqual(result.near_items.map(item => item.citation), ["BC Reg 168/2009"]);
	assert.equal(result.legislationId, null);
});

test("a match only in an archive database reads archived", async () => {
	const { getJson } = fakeApi();
	const { instruments: [result] } = await check(
		[{ citation: "RSBC 1996, c 266", title: "Limitation Act", jurisdiction: "bc" }], getJson);
	assert.equal(result.currency, "archived");
	assert.equal(result.database_name, "Archived Statutes of British Columbia");
});

test("a repealed field other than NO, or any endDate, reads repealed", async () => {
	for (const fields of [{ repealed: "YES" }, { repealed: "NO", endDate: "2020-01-01" }]) {
		const saved = METADATA["bcs/sbc-2012-c-13"];
		METADATA["bcs/sbc-2012-c-13"] = { ...saved, ...fields };
		try {
			const { instruments: [result] } = await check([LIMITATION], fakeApi().getJson);
			assert.equal(result.currency, "repealed", JSON.stringify(fields));
		} finally {
			METADATA["bcs/sbc-2012-c-13"] = saved;
		}
	}
});

test("a call that fails once is retried and the check completes", async () => {
	const { getJson, calls } = fakeApi({ "legislationBrowse/en/bcs/": 1 });
	const { instruments: [result] } = await check([LIMITATION], getJson);
	assert.equal(result.currency, "current");
	assert.equal(calls.filter(path => path === "legislationBrowse/en/bcs/").length, 2);
});

test("a call that still fails after one retry reads validation_unavailable, never an inferred value", async () => {
	for (const path of ["legislationBrowse/en/", "legislationBrowse/en/bcr/", "legislationBrowse/en/bcs/sbc-2012-c-13/"]) {
		const { getJson } = fakeApi({ [path]: 2 });
		const { instruments: [result] } = await check([LIMITATION], getJson);
		assert.equal(result.currency, "validation_unavailable", path);
		assert.match(result.error, /HTTP 502/);
	}
});

test("instruments naming the same Act are checked once and returned as one result", async () => {
	const { getJson, calls } = fakeApi();
	const report = await check([
		LIMITATION,
		{ citation: "SBC 2012, c 13", title: "Limitation Act", jurisdiction: "BC" },
		{ citation: "B.C. Reg. 168/2009", title: "Supreme Court Civil Rules", jurisdiction: "bc" },
		{ citation: "sbc  2012,  c 13", title: "Limitation Act", jurisdiction: "bc" },
	], getJson);
	assert.equal(report.instruments.length, 2);
	assert.deepEqual(report.instruments[0].inputs, [0, 1, 3]);
	assert.deepEqual(report.instruments[1].inputs, [2]);
	assert.equal(report.instruments[0].key, "bc|sbc 2012, c 13");
	assert.equal(calls.filter(path => path === "legislationBrowse/en/").length, 1);
	assert.equal(calls.filter(path => path === "legislationBrowse/en/bcs/").length, 1);
	assert.equal(calls.filter(path => path.endsWith("sbc-2012-c-13/")).length, 1);
});

test("the dedupe key is jurisdiction plus the matcher's normalized citation", () => {
	assert.equal(instrumentKey({ citation: " B.C. Reg.  168/2009 ", title: "", jurisdiction: "BC" }), "bc|bc reg 168/2009");
});

// Synthetic BC Laws pages in the publisher's markup (spec 2026-10-22 section 11):
// a cumulative bulletin table and a B.C. Gazette Part II amending regulation.
const BULLETIN_URL = (year) =>
	`https://www.bclaws.gov.bc.ca/civix/document/id/regulationbulletin/regulationbulletin/${year}cumulati`;
const GAZETTE_URL = "https://www.bclaws.gov.bc.ca/civix/document/id/lc/bcgaz2/v99n01_900-2026";

function bulletin(year, rows) {
	return `<html><body><h2 align="center">Cumulative B.C. Regulations Bulletin ${year}</h2>
<p align="center">This cumulative bulletin is current to October&nbsp;20, ${year} &#8211; B.C. Regulations Bulletin No. 35<br></p>
<table><tr><th>Order</th><th>&nbsp;</th><th>B.C.&nbsp;Reg. Number&nbsp;</th><th>Deposit&nbsp;Date</th></tr>
<tr valign="top"><td bgcolor="#CCCCCC">&nbsp;</td><td colspan="3" bgcolor="#CCCCCC"><strong>Court Rules Act</strong></td></tr>
${rows.join("\n")}
</table></body></html>`;
}

const row = (description, reg, link, deposit) =>
	`<tr valign="top"><td align="left"><a href="/civix/document/id/oic/oic_cur/0001_${reg.split("/")[1]}">1/2026</a></td>` +
	`<td align="left">${description}</td>` +
	`<td align="center">${link ? `<a href="${link}">${reg}</a>` : reg}</td><td nowrap="nowrap">${deposit}</td></tr>`;

const BULLETIN_2026 = bulletin(2026, [
	// Effective on the CanLII marker date: already in the consolidation, never listed.
	row("Amends, effective May 4, 2026, B.C. Regs.<br/>&nbsp;&nbsp;&nbsp;168/2009 &#8212; Supreme Court Civil Rules",
		"800/2026", "/civix/document/id/lc/bcgaz2/v99n00_800-2026", "March 13, 2026"),
	row("Amends, effective October&nbsp;1,&nbsp;2026, B.C. Regs. <br>&nbsp;&nbsp;&nbsp;168/2009 &#8212; Supreme Court Civil Rules<br>" +
		"&nbsp;&nbsp;&nbsp;169/2009 &#8212; Supreme Court Family Rules",
		"900/2026", "/civix/document/id/lc/bcgaz2/v99n01_900-2026", "June 26, 2026"),
	// Names 68/2009 only: a substring of 168/2009 that never counts.
	row("Amends B.C. Reg. 68/2009 &#8212; Some Other Regulation, effective October&nbsp;1,&nbsp;2026",
		"901/2026", "/civix/document/id/lc/bcgaz2/v99n01_901-2026", "June 26, 2026"),
	// No effective date stated and no link: listed by its deposit date, provisions unknown.
	row("Amends B.C. Reg. 168/2009 &#8212; Supreme Court Civil Rules", "950/2026", null, "September 30, 2026"),
]);

const GAZETTE = `<html><body>
<p class="subsection"> (a)	the Supreme Court Civil Rules, B.C.&nbsp;Reg.&nbsp;168/2009, are amended as set out in the attached Schedule&nbsp;1, </p>
<p class="SchHeading">Schedule&nbsp;1 </p>
<p class="amendsec">1	Rule&nbsp;8-1 of the Supreme Court Civil Rules, B.C.&nbsp;Reg.&nbsp;168/2009, is amended </p>
<p class="sec1"> (3)	Replacement text. </p>
<p class="amendsec">2	Rule&nbsp;11&#8209;3&nbsp;(8) is amended by striking out "<span class="QuotedText">old</span>" and substituting "<span class="QuotedText">new</span>". </p>
<p class="amendsec">3	Forms&nbsp;17 and 33 in Appendix&nbsp;A are repealed and the following substituted: </p>
<p class="amendsec">4	The following Form is added to Appendix&nbsp;A: </p>
<p class="SchHeading">Schedule&nbsp;2 </p>
<p class="amendsec">1	Rule&nbsp;6-3 of the Supreme Court Family Rules, B.C.&nbsp;Reg.&nbsp;169/2009, is amended </p>
</body></html>`;

function fakeBcLaws(pages) {
	const calls = [];
	const getText = async (url) => {
		calls.push(url);
		if (!(url in pages)) throw new Error("HTTP 404");
		return pages[url];
	};
	return { getText, calls };
}

const RULES = { citation: "B.C. Reg. 168/2009", title: "Supreme Court Civil Rules", jurisdiction: "bc" };
const PAGES = { [BULLETIN_URL(2025)]: bulletin(2025, []), [BULLETIN_URL(2026)]: BULLETIN_2026, [GAZETTE_URL]: GAZETTE };

test("an amending regulation effective after the marker is listed with its date and quoted provisions", async () => {
	const { getText } = fakeBcLaws(PAGES);
	const { instruments: [result] } = await check([RULES], fakeApi().getJson, getText);
	assert.equal(result.currency, "current");
	assert.equal(result.marker_date, "2026-05-04");
	assert.equal(result.marker_source, "canlii_startDate");
	assert.equal(result.fetched_on, TODAY);
	assert.equal(result.bulletin_current_to, "2026-10-20");
	assert.match(result.amendments_note, /deposited from 2025-01-01 to 2026-10-20/);
	assert.deepEqual(result.amendments_after_marker.map(a => a.instrument), ["B.C. Reg. 900/2026", "B.C. Reg. 950/2026"]);
	const [listed, unlinked] = result.amendments_after_marker;
	assert.equal(listed.effective_date, "2026-10-01");
	assert.equal(listed.deposit_date, "2026-06-26");
	assert.equal(listed.source_url, GAZETTE_URL);
	assert.match(listed.bulletin_text, /^Amends, effective October 1, 2026, B\.C\. Regs\. 168\/2009 — Supreme Court Civil Rules/);
	assert.deepEqual(listed.provisions_amended, [
		"1 Rule 8-1 of the Supreme Court Civil Rules, B.C. Reg. 168/2009, is amended",
		"2 Rule 11-3 (8) is amended",
		"3 Forms 17 and 33 in Appendix A are repealed",
		"4 The following Form is added to Appendix A",
	]);
	assert.equal(listed.provisions_reason, null);
	assert.equal(unlinked.effective_date, null);
	assert.equal(unlinked.provisions_amended, "unknown");
	assert.match(unlinked.provisions_reason, /links no B\.C\. Gazette Part II text/);
	assert.equal(unlinked.source_url, BULLETIN_URL(2026));
});

test("the caller's currency_marker is the marker, and nothing after it is an empty list", async () => {
	const { getText } = fakeBcLaws(PAGES);
	const { instruments: [result] } = await check([{ ...RULES, currency_marker: "2026-10-15" }], fakeApi().getJson, getText);
	assert.equal(result.marker_date, "2026-10-15");
	assert.equal(result.marker_source, "currency_marker");
	assert.deepEqual(result.amendments_after_marker, []);
	assert.match(result.amendments_note, /outside this check/);
});

test("an unreadable bulletin reads unknown with the reason, never an empty list, and currency is unchanged", async () => {
	const { getText, calls } = fakeBcLaws({ [BULLETIN_URL(2025)]: bulletin(2025, []) });
	const { instruments: [result] } = await check([RULES], fakeApi().getJson, getText);
	assert.equal(result.currency, "current");
	assert.equal(result.amendments_after_marker, "unknown");
	assert.match(result.amendments_note, /Bulletin 2026 .* could not be read: HTTP 404/);
	assert.equal(result.bulletin_current_to, null);
	assert.equal(calls.filter(url => url === BULLETIN_URL(2026)).length, 2, "retried once");

	const garbled = fakeBcLaws({ ...PAGES, [BULLETIN_URL(2026)]: "<html>maintenance</html>" });
	const { instruments: [other] } = await check([RULES], fakeApi().getJson, garbled.getText);
	assert.equal(other.amendments_after_marker, "unknown");
	assert.match(other.amendments_note, /does not read as the Cumulative B\.C\. Regulations Bulletin 2026/);
});

test("a statute is not checked against the bulletin and reads unknown with the reason", async () => {
	const { getText, calls } = fakeBcLaws(PAGES);
	const { instruments: [result] } = await check([LIMITATION], fakeApi().getJson, getText);
	assert.equal(result.currency, "current");
	assert.equal(result.marker_date, "2013-06-01");
	assert.equal(result.amendments_after_marker, "unknown");
	assert.match(result.amendments_note, /only a B\.C\. Reg\. citation is checked/);
	assert.equal(calls.length, 0);
});
