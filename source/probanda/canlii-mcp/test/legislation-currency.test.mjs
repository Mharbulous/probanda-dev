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

const LIMITATION = { citation: "S.B.C. 2012, c. 13", title: "Limitation Act", jurisdiction: "bc" };

test("a citation matches ignoring periods and case; CanLII's 'NO' and an empty endDate read as current", async () => {
	const { getJson } = fakeApi();
	const { instruments: [result] } = await checkLegislationCurrency([LIMITATION], getJson);
	assert.equal(result.currency, "current");
	assert.equal(result.databaseId, "bcs");
	assert.equal(result.returned_citation, "SBC 2012, c 13");
	assert.equal(result.error, null);
});

test("a regulation cited with periods matches CanLII's unpunctuated citation", async () => {
	const { getJson } = fakeApi();
	const { instruments: [result] } = await checkLegislationCurrency(
		[{ citation: "B.C. Reg. 168/2009", title: "Supreme Court Civil Rules", jurisdiction: "bc" }], getJson);
	assert.equal(result.currency, "current");
	assert.equal(result.legislationId, "bc-reg-168-2009");
});

test("a title hit whose citation differs is a near item, never a match", async () => {
	const { getJson } = fakeApi();
	const { instruments: [result] } = await checkLegislationCurrency(
		[{ citation: "B.C. Reg. 28/2024", title: "Supreme Court Civil Rules", jurisdiction: "bc" }], getJson);
	assert.equal(result.currency, "not-found");
	assert.deepEqual(result.near_items.map(item => item.citation), ["BC Reg 168/2009"]);
	assert.equal(result.legislationId, null);
});

test("a match only in an archive database reads archived", async () => {
	const { getJson } = fakeApi();
	const { instruments: [result] } = await checkLegislationCurrency(
		[{ citation: "RSBC 1996, c 266", title: "Limitation Act", jurisdiction: "bc" }], getJson);
	assert.equal(result.currency, "archived");
	assert.equal(result.database_name, "Archived Statutes of British Columbia");
});

test("a repealed field other than NO, or any endDate, reads repealed", async () => {
	for (const fields of [{ repealed: "YES" }, { repealed: "NO", endDate: "2020-01-01" }]) {
		const saved = METADATA["bcs/sbc-2012-c-13"];
		METADATA["bcs/sbc-2012-c-13"] = { ...saved, ...fields };
		try {
			const { instruments: [result] } = await checkLegislationCurrency([LIMITATION], fakeApi().getJson);
			assert.equal(result.currency, "repealed", JSON.stringify(fields));
		} finally {
			METADATA["bcs/sbc-2012-c-13"] = saved;
		}
	}
});

test("a call that fails once is retried and the check completes", async () => {
	const { getJson, calls } = fakeApi({ "legislationBrowse/en/bcs/": 1 });
	const { instruments: [result] } = await checkLegislationCurrency([LIMITATION], getJson);
	assert.equal(result.currency, "current");
	assert.equal(calls.filter(path => path === "legislationBrowse/en/bcs/").length, 2);
});

test("a call that still fails after one retry reads validation_unavailable, never an inferred value", async () => {
	for (const path of ["legislationBrowse/en/", "legislationBrowse/en/bcr/", "legislationBrowse/en/bcs/sbc-2012-c-13/"]) {
		const { getJson } = fakeApi({ [path]: 2 });
		const { instruments: [result] } = await checkLegislationCurrency([LIMITATION], getJson);
		assert.equal(result.currency, "validation_unavailable", path);
		assert.match(result.error, /HTTP 502/);
	}
});

test("instruments naming the same Act are checked once and returned as one result", async () => {
	const { getJson, calls } = fakeApi();
	const report = await checkLegislationCurrency([
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
