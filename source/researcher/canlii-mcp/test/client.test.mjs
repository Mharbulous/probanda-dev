import { test } from "node:test";
import assert from "node:assert/strict";
// build/, not dist/: the client and the tool handlers are tested from source.
import { CanliiClient } from "../build/client.js";
import { handlers } from "../build/tools.js";

// A fake fetch that records each URL and answers from `reply(url)`, and a clock
// that only moves when the client sleeps.
function fakeClient(reply, { key = "secret123", start = Date.UTC(2026, 9, 25, 12) } = {}) {
	const calls = [];
	const sleeps = [];
	let now = start;
	const client = new CanliiClient({
		fetch: async (url) => {
			calls.push({ url, at: now });
			return reply(url);
		},
		now: () => now,
		sleep: async (ms) => {
			sleeps.push(ms);
			now += ms;
		},
		persistKey: async () => {},
	});
	client.key = key;
	client.keySource = key ? "env" : "none";
	return { client, calls, sleeps, advance: (ms) => { now += ms; } };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("a request puts the key first in the query, then the caller's parameters", async () => {
	const { client, calls } = fakeClient(() => json({}));
	await client.request("caseBrowse/en/", new URLSearchParams({ publishedAfter: "2020-01-01" }));
	assert.equal(calls[0].url, "https://api.canlii.org/v1/caseBrowse/en/?api_key=secret123&publishedAfter=2020-01-01");
});

test("requests are spaced at least 500 ms apart", async () => {
	const { client, calls, sleeps } = fakeClient(() => json({}));
	await Promise.all([client.request("a/"), client.request("b/"), client.request("c/")]);
	assert.deepEqual(calls.map((c) => c.url.split("?")[0].slice(-2)), ["a/", "b/", "c/"]);
	assert.deepEqual(sleeps, [500, 500]);
	assert.ok(calls[1].at - calls[0].at >= 500 && calls[2].at - calls[1].at >= 500);
});

test("the daily cap refuses the 5,001st request and resets the next day", async () => {
	const { client, advance } = fakeClient(() => json({}));
	for (let i = 0; i < 5000; i++) {
		advance(500);
		await client.request("x/");
	}
	await assert.rejects(client.request("x/"), /Daily API limit reached \(5,000 queries\)/);
	advance(24 * 60 * 60 * 1000);
	await client.request("x/");
});

test("a failed request does not jam the queue for the ones after it", async () => {
	let fail = true;
	const { client } = fakeClient(() => {
		if (fail) {
			fail = false;
			throw new Error("boom");
		}
		return json({ ok: true });
	});
	await assert.rejects(client.request("x/"), /network: CanLII could not be reached \(boom\)/);
	assert.deepEqual(await client.getJson("x/", "Failed"), { ok: true });
});

test("a network error never carries the key", async () => {
	const { client } = fakeClient((url) => { throw new Error(`fetch failed for ${url}`); });
	await assert.rejects(client.request("x/"), (error) => {
		assert.match(error.message, /api_key=REDACTED/);
		assert.doesNotMatch(error.message, /secret123/);
		return true;
	});
});

test("without a key a request fails with the setup message and fetches nothing", async () => {
	const { client, calls } = fakeClient(() => json({}), { key: "" });
	client.credentialError = "DPAPI refused";
	await assert.rejects(client.request("x/"), /CanLII API key not configured.*DPAPI refused/);
	assert.equal(calls.length, 0);
});

test("getJson maps a non-2xx reply and a reply that is not JSON", async () => {
	const { client } = fakeClient((url) => url.includes("/bad/") ? new Response("nope", { status: 404 }) : new Response("<html> oops </html>"));
	await assert.rejects(client.getJson("bad/", "Failed to fetch thing"), { message: "Failed to fetch thing (404)" });
	await assert.rejects(client.getJson("ok/", "Failed"), { message: "CanLII returned a reply that is not JSON: <html> oops </html>" });
});

test("get_case_citator maps its inputs to the URL and a non-2xx reply to the old error text", async () => {
	const { client, calls } = fakeClient(() => new Response("", { status: 403 }));
	const result = await handlers.get_case_citator(client, {
		language: "en", databaseId: "bcsc", caseId: "2021bcsc1", metadataType: "citingCases", decisionDateAfter: "2020-01-01",
	});
	assert.equal(calls[0].url, "https://api.canlii.org/v1/caseCitator/en/bcsc/2021bcsc1/citingCases?api_key=secret123&decisionDateAfter=2020-01-01");
	assert.deepEqual(result, { content: [{ type: "text", text: "Error: Failed to fetch case citator data (403)" }], isError: true });
});

test("get_case_citator on a heavily cited decision returns the count and the 5 newest by neutral citation", async () => {
	const invented = (citation) => ({ databaseId: "bcsc", caseId: { en: citation }, title: "Invented v Fixture", citation, padding: "x".repeat(300) });
	const citingCases = Array.from({ length: 1100 }, (_, i) => invented(`2001 BCSC ${i + 1} (CanLII)`));
	citingCases.splice(40, 0,
		invented("2024 BCSC 9 (CanLII)"),
		invented("2024 BCSC 120 (CanLII)"),
		invented("[2025] 1 SCR 7, 2025 SCC 3 (CanLII)"),
		invented("2023 NLTD(G) 17 (CanLII)"),
		invented("2022 CanLII 613 (BC SC)"),
		invented("(1992), 65 BCLR 123 (CA)"),
	);
	const { client } = fakeClient(() => json({ citingCases }));
	const result = await handlers.get_case_citator(client, {
		language: "en", databaseId: "bcsc", caseId: "2000bcsc1", metadataType: "citingCases",
	});
	assert.ok(result.content[0].text.length < 5000);
	const body = JSON.parse(result.content[0].text);
	assert.equal(body._notice, "No decision text is included in this response or available through this API.");
	assert.deepEqual({ total: body.total, returned: body.returned }, { total: 1106, returned: 5 });
	assert.deepEqual(body.citingCases.map((c) => c.citation), [
		"[2025] 1 SCR 7, 2025 SCC 3 (CanLII)",
		"2024 BCSC 120 (CanLII)",
		"2024 BCSC 9 (CanLII)",
		"2023 NLTD(G) 17 (CanLII)",
		"2022 CanLII 613 (BC SC)",
	]);
});

test("get_case_citator returns a short citing list whole, a citation with no neutral form last, and other types uncapped", async () => {
	const invented = (citation) => ({ databaseId: "bcsc", caseId: { en: citation }, title: "Invented v Fixture", citation });
	const short = ["(1992), 65 BCLR 123 (CA)", "2020 BCSC 1"].map(invented);
	const cited = Array.from({ length: 8 }, (_, i) => invented(`2001 BCSC ${i + 1}`));
	const { client } = fakeClient((url) => json(url.includes("citingCases") ? { citingCases: short } : { citedCases: cited }));
	const params = { language: "en", databaseId: "bcsc", caseId: "2000bcsc1" };
	const citing = JSON.parse((await handlers.get_case_citator(client, { ...params, metadataType: "citingCases" })).content[0].text);
	assert.deepEqual({ total: citing.total, returned: citing.returned }, { total: 2, returned: 2 });
	assert.deepEqual(citing.citingCases.map((c) => c.citation), ["2020 BCSC 1", "(1992), 65 BCLR 123 (CA)"]);
	const other = JSON.parse((await handlers.get_case_citator(client, { ...params, metadataType: "citedCases" })).content[0].text);
	assert.equal(other.citedCases.length, 8);
	assert.equal(other.total, undefined);
});

test("browse_legislation filters and pages the database and reports the counts", async () => {
	const legislations = ["Limitation Act", "Family Law Act", "Limitation Regulation"].map((title, i) => ({
		databaseId: "bcs", legislationId: `id-${i}`, title, citation: `SBC ${i}`, type: "STATUTE",
	}));
	const { client } = fakeClient(() => json({ legislations }));
	const result = await handlers.browse_legislation(client, {
		language: "en", databaseId: "bcs", titleContains: " limitation ", offset: 1, resultCount: 5,
	});
	const body = JSON.parse(result.content[0].text);
	assert.equal(body._notice, "No decision text is included in this response or available through this API.");
	assert.deepEqual({ total: body.total, matched: body.matched, returned: body.returned }, { total: 3, matched: 2, returned: 1 });
	assert.equal(body.legislations[0].title, "Limitation Regulation");
});

test("legislation_currency without a key reports blocked and fetches nothing", async () => {
	const { client, calls } = fakeClient(() => json({}), { key: "" });
	const result = await handlers.legislation_currency(client, {
		instruments: [{ citation: "SBC 2012, c 13", title: "Limitation Act", jurisdiction: "bc" }],
	});
	assert.equal(JSON.parse(result.content[0].text).status, "blocked (no-api-key)");
	assert.equal(calls.length, 0);
});

test("configure_credential keeps the old key when the new one is refused", async () => {
	const { client } = fakeClient(() => new Response("", { status: 401 }), { key: "oldkey12345" });
	const result = await handlers.configure_credential(client, { api_key: " newkey " });
	assert.equal(result.isError, true);
	assert.match(result.content[0].text, /CanLII rejected the request \(HTTP 401\)/);
	assert.equal(client.key, "oldkey12345");
	assert.equal(client.keySource, "env");
});

test("configure_credential sets, persists and reports a key that works", async () => {
	const { client, calls } = fakeClient(() => json({}), { key: "" });
	const persisted = [];
	const live = new CanliiClient({ fetch: async (url) => { calls.push({ url }); return json({}); }, persistKey: async (k) => { persisted.push(k); } });
	const result = await handlers.configure_credential(live, { api_key: " newkey12345 " });
	assert.equal(result.isError, undefined);
	assert.equal(JSON.parse(result.content[0].text).persisted, true);
	assert.deepEqual(persisted, ["newkey12345"]);
	assert.equal(live.key, "newkey12345");
	assert.equal(live.keySource, "stored");
	assert.match(calls[0].url, /caseBrowse\/en\/\?api_key=newkey12345$/);
	assert.equal(JSON.parse((await handlers.configure_status(client)).content[0].text).configured, false);
});
