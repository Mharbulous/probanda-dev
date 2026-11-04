import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	CitedCasesResponseSchema,
	CitingCasesResponseSchema,
	CitedLegislationsResponseSchema,
	LegislationResponseSchema,
	LegislationItemResponseSchema,
	LegislationMetadataSchema,
} from "./schema.js";
import { redactedKeyHint } from "./dpapi-store.js";
import { CanliiClient, readJson, sanitizeError } from "./client.js";
import { checkLegislationCurrency } from "./legislation-currency.js";

// Each tool is a thin mapping from its inputs to CanliiClient calls and from the
// result to an MCP response. The handlers are exported so they can be tested with
// a client over a fake fetch; createServer registers them in this order.

// Input validation schemas for path segments
const pathSegmentSchema = z.string().regex(/^[a-zA-Z0-9_\-]{1,100}$/, "Invalid identifier — must be alphanumeric, hyphens, or underscores only");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional();

interface DateParams {
	publishedBefore?: string;
	publishedAfter?: string;
	modifiedBefore?: string;
	modifiedAfter?: string;
	changedBefore?: string;
	changedAfter?: string;
	decisionDateBefore?: string;
	decisionDateAfter?: string;
}

function buildDateParams(options: DateParams): URLSearchParams {
	const params = new URLSearchParams();
	if (options.publishedBefore) params.append('publishedBefore', options.publishedBefore);
	if (options.publishedAfter) params.append('publishedAfter', options.publishedAfter);
	if (options.modifiedBefore) params.append('modifiedBefore', options.modifiedBefore);
	if (options.modifiedAfter) params.append('modifiedAfter', options.modifiedAfter);
	if (options.changedBefore) params.append('changedBefore', options.changedBefore);
	if (options.changedAfter) params.append('changedAfter', options.changedAfter);
	if (options.decisionDateBefore) params.append('decisionDateBefore', options.decisionDateBefore);
	if (options.decisionDateAfter) params.append('decisionDateAfter', options.decisionDateAfter);
	return params;
}

function textResponse(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

// Every data response says, in the payload itself, that CanLII serves no decision
// text: the model reads this at the moment it decides what a result is good for.
const NO_TEXT_NOTICE = "No decision text is included in this response or available through this API.";

function jsonResponse(data: object) {
	return textResponse(JSON.stringify({ _notice: NO_TEXT_NOTICE, ...data }, null, 2));
}

export function errorResponse(message: string) {
	return { ...textResponse(sanitizeError(message)), isError: true };
}

function caughtResponse(error: unknown) {
	return errorResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
}

const dateParametersSchema = {
	publishedBefore: dateSchema.describe("Date first published on CanLII (YYYY-MM-DD)"),
	publishedAfter: dateSchema.describe("Date first published on CanLII (YYYY-MM-DD)"),
	modifiedBefore: dateSchema.describe("Date content last modified on CanLII (YYYY-MM-DD)"),
	modifiedAfter: dateSchema.describe("Date content last modified on CanLII (YYYY-MM-DD)"),
	changedBefore: dateSchema.describe("Date metadata or content last changed on CanLII (YYYY-MM-DD)"),
	changedAfter: dateSchema.describe("Date metadata or content last changed on CanLII (YYYY-MM-DD)"),
	decisionDateBefore: dateSchema.describe("Decision date upper bound (YYYY-MM-DD)"),
	decisionDateAfter: dateSchema.describe("Decision date lower bound (YYYY-MM-DD)"),
};

const citatorSchemas = {
	citedCases: CitedCasesResponseSchema,
	citingCases: CitingCasesResponseSchema,
	citedLegislations: CitedLegislationsResponseSchema,
} as const;

type Language = "en" | "fr";
type MetadataType = keyof typeof citatorSchemas;

// A heavily cited decision's list runs past the tool output limit (326,621 characters seen).
// CanLII's citator gives no date, so the neutral citation's year, then number, stands in for it.
// The number only orders decisions of one court exactly. A citation with none sorts last.
const CITING_CASES_RETURNED = 5;

function neutralOrder(citation: string): [number, number] {
	const match = citation.match(/\b(\d{4}) [A-Za-z][\w()-]* (\d+)\b/);
	return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function newestCitingCases({ citingCases }: z.infer<typeof CitingCasesResponseSchema>) {
	const ranked = citingCases.map((entry) => ({ entry, order: neutralOrder(entry.citation) }));
	ranked.sort((a, b) => b.order[0] - a.order[0] || b.order[1] - a.order[1]);
	return {
		total: citingCases.length,
		returned: Math.min(citingCases.length, CITING_CASES_RETURNED),
		order: "newest first by neutral citation: year, then number",
		citingCases: ranked.slice(0, CITING_CASES_RETURNED).map(({ entry }) => entry),
	};
}

export interface Instrument {
	citation: string;
	title: string;
	jurisdiction: string;
	currency_marker?: string;
}

export const handlers = {
	async get_case_citator(client: CanliiClient, params: {
		language: Language; databaseId: string; caseId: string; metadataType: MetadataType;
	} & DateParams) {
		try {
			const { language, databaseId, caseId, metadataType, ...dateParams } = params;
			const data = await client.getJson(
				`caseCitator/${language}/${encodeURIComponent(databaseId)}/${encodeURIComponent(caseId)}/${metadataType}`,
				"Failed to fetch case citator data",
				buildDateParams(dateParams),
			);
			if (metadataType === "citingCases") return jsonResponse(newestCitingCases(CitingCasesResponseSchema.parse(data)));
			return jsonResponse(citatorSchemas[metadataType].parse(data));
		} catch (error) {
			return caughtResponse(error);
		}
	},

	async get_case_citator_tease(client: CanliiClient, { language, databaseId, caseId, metadataType }: {
		language: Language; databaseId: string; caseId: string; metadataType: MetadataType;
	}) {
		try {
			const data = await client.getJson(
				`caseCitatorTease/${language}/${encodeURIComponent(databaseId)}/${encodeURIComponent(caseId)}/${metadataType}`,
				"Failed to fetch citator tease data",
			);
			return jsonResponse(citatorSchemas[metadataType].parse(data));
		} catch (error) {
			return caughtResponse(error);
		}
	},

	async get_legislation_databases(client: CanliiClient, params: { language: Language } & DateParams) {
		try {
			const { language, ...dateParams } = params;
			const data = await client.getJson(
				`legislationBrowse/${language}/`,
				"Failed to fetch legislation databases",
				buildDateParams(dateParams),
			);
			return jsonResponse(LegislationResponseSchema.parse(data));
		} catch (error) {
			return caughtResponse(error);
		}
	},

	async browse_legislation(client: CanliiClient, params: {
		language: Language; databaseId: string; titleContains?: string; offset: number; resultCount: number;
	} & DateParams) {
		try {
			const { language, databaseId, titleContains, offset, resultCount, ...dateParams } = params;
			// The upstream endpoint has no pagination or filter parameters — it
			// returns the entire database in one response (bcr: ~800 KB), so the
			// bounding must happen here before the payload reaches the model.
			const data = await client.getJson(
				`legislationBrowse/${language}/${encodeURIComponent(databaseId)}/`,
				"Failed to fetch legislation list",
				buildDateParams(dateParams),
			);
			const parsed = LegislationItemResponseSchema.parse(data);

			const needle = titleContains?.trim().toLowerCase();
			const matched = needle
				? parsed.legislations.filter(l =>
					l.title.toLowerCase().includes(needle) || l.citation.toLowerCase().includes(needle))
				: parsed.legislations;
			const page = matched.slice(offset, offset + resultCount);

			return jsonResponse({
				databaseId,
				total: parsed.legislations.length,
				matched: matched.length,
				offset,
				returned: page.length,
				legislations: page,
			});
		} catch (error) {
			return caughtResponse(error);
		}
	},

	async get_legislation_regulation_metadata(client: CanliiClient, { language, databaseId, legislationId }: {
		language: Language; databaseId: string; legislationId: string;
	}) {
		try {
			const data = await client.getJson(
				`legislationBrowse/${language}/${encodeURIComponent(databaseId)}/${encodeURIComponent(legislationId)}/`,
				"Failed to fetch legislation metadata",
			);
			return jsonResponse(LegislationMetadataSchema.parse(data));
		} catch (error) {
			return caughtResponse(error);
		}
	},

	// Leg 1 of shared/statute-currency.md in one call, so the main session needs no
	// agent for it. Inputs sharing a key (jurisdiction + normalized citation) are
	// checked once: one currency check per Act.
	async legislation_currency(client: CanliiClient, { instruments }: { instruments: Instrument[] }) {
		if (!client.key) {
			return jsonResponse({ status: "blocked (no-api-key)", detail: client.missingKeyMessage() });
		}
		try {
			const report = await checkLegislationCurrency(
				instruments,
				async (path) => {
					const response = await client.request(path);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					return readJson(response);
				},
				(url) => client.fetchText(url),
				new Date(client.now()).toLocaleDateString("en-CA"),
			);
			for (const result of report.instruments) {
				if (result.error) result.error = sanitizeError(result.error);
			}
			return jsonResponse({ status: "complete", ...report });
		} catch (error) {
			return caughtResponse(error);
		}
	},

	// Cowork delivery workaround (see dpapi-store.ts). Cowork runs this server inside
	// a LocalSystem VM service that never sees the practitioner's CANLII_API_KEY
	// user env var, so in Cowork the key can only arrive as a tool argument. Accepts
	// it, validates it with one cheap authenticated request, then persists it
	// DPAPI-encrypted so every later session finds it. env still wins outright.
	async configure_credential(client: CanliiClient, { api_key }: { api_key: string }) {
		const key = api_key.trim();
		if (!key) {
			return errorResponse("Error: configure_credential requires a non-empty api_key.");
		}

		// Set live BEFORE validating, so the probe uses the new key; restore on
		// failure so a bad key never knocks out an already-working session.
		const previousKey = client.key;
		const previousSource = client.keySource;
		client.key = key;
		client.keySource = "stored";

		try {
			await probeKey(client);
		} catch (error) {
			client.key = previousKey;
			client.keySource = previousSource;
			return errorResponse(
				`Error: that key did not work against CanLII, so it was not saved: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}

		try {
			await client.persistKey(key);
		} catch (error) {
			// The key works and stays live for this session, but the caller must
			// know it will not survive a restart.
			return jsonResponse({
				configured: true,
				persisted: false,
				warning:
					"The key works and is active for this session, but could not be saved to disk, so it must " +
					`be supplied again after a restart: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
		return jsonResponse({ configured: true, persisted: true, key_hint: redactedKeyHint(key) });
	},

	async configure_status(client: CanliiClient) {
		return jsonResponse({
			configured: Boolean(client.key),
			source: client.keySource,
			key_hint: redactedKeyHint(client.key),
		});
	},
};

// One cheap authenticated request (the matter-database index) — confirms a key is
// accepted before it is persisted, so a wrong-but-plausible key fails here with
// a clear cause instead of on some later lookup.
async function probeKey(client: CanliiClient): Promise<void> {
	const response = await client.request("caseBrowse/en/");
	if (!response.ok) {
		throw new Error(`CanLII rejected the request (HTTP ${response.status}).`);
	}
}

export function createServer(client: CanliiClient, version: string): McpServer {
	const server = new McpServer({
		name: "CanLII MCP",
		version,
		description: "Local MCP server for Canadian legal research via the CanLII API. Always include CanLII URLs in responses so the user can verify sources directly."
	});

	server.tool(
		"get_case_citator",
		"Look up citation relationships for a case. Critical for verifying if a case is still good law. " +
		"Use 'citingCases' to see what later cases cite this decision — if many recent cases cite it approvingly, it is strong authority. " +
		"Use 'citedCases' to see what authorities this case relied on. " +
		"Use 'citedLegislations' to see what statutes the case references. " +
		"Returns the full list of cited items. For 'citingCases' it returns the total and the 5 newest by neutral citation (year, then number).",
		{
			language: z.enum(["en", "fr"]).default("en")
				.describe("Language: 'en' for English (default), 'fr' for French"),
			databaseId: pathSegmentSchema
				.describe("Court database ID (e.g., 'onsc', 'onca', 'csc-scc')"),
			caseId: pathSegmentSchema
				.describe("Case unique identifier (e.g., '2021onsc8582')"),
			metadataType: z.enum(["citedCases", "citingCases", "citedLegislations"])
				.describe("'citingCases' = what later cases cite this one (check if still good law); 'citedCases' = what this case relies on; 'citedLegislations' = statutes referenced"),
			...dateParametersSchema,
		},
		(params) => handlers.get_case_citator(client, params)
	);

	server.tool(
		"get_case_citator_tease",
		"Quick preview of citation relationships (max 5 results). Faster than the full citator. " +
		"Use this for a quick check on whether a case has been cited, then use get_case_citator for the count and the newest citing cases.",
		{
			language: z.enum(["en", "fr"]).default("en")
				.describe("Language: 'en' for English (default), 'fr' for French"),
			databaseId: pathSegmentSchema
				.describe("Court database ID (e.g., 'onsc', 'onca', 'csc-scc')"),
			caseId: pathSegmentSchema
				.describe("Case unique identifier (e.g., '2021onsc8582')"),
			metadataType: z.enum(["citedCases", "citingCases", "citedLegislations"])
				.describe("Type of citation data to preview"),
		},
		(params) => handlers.get_case_citator_tease(client, params)
	);

	server.tool(
		"get_legislation_databases",
		"List all available legislation databases in Canada. Returns database IDs for browsing statutes and regulations. " +
		"Key databases: ons (Ontario Statutes), onr (Ontario Regulations), cas (Canada Statutes), car (Canada Regulations), " +
		"bcs (BC Statutes), abs (Alberta Statutes).",
		{
			language: z.enum(["en", "fr"]).default("en")
				.describe("Language: 'en' for English (default), 'fr' for French"),
			...dateParametersSchema,
		},
		(params) => handlers.get_legislation_databases(client, params)
	);

	server.tool(
		"browse_legislation",
		"List legislation items in a specific database, filtered and paginated. Use to find legislation IDs for metadata lookup. " +
		"Large databases are unusable unfiltered (e.g. 'bcr' holds ~2,400 BC regulations), so pass titleContains to pinpoint an " +
		"instrument — e.g. databaseId 'bcr' with titleContains 'supreme court civil' returns exactly the Supreme Court Civil Rules. " +
		"The response reports total and matched counts so you can tell what was elided and page if needed. " +
		"Key statutes by database — ons: Children's Law Reform Act, Family Law Act, Employment Standards Act. " +
		"cas: Divorce Act, Criminal Code, Canada Labour Code, Federal Child Support Guidelines. " +
		"The CanLII API serves metadata only, never legislative text: follow up with get_legislation_regulation_metadata " +
		"for the instrument's canlii.org URL and table of contents, and read the text at that URL.",
		{
			language: z.enum(["en", "fr"]).default("en")
				.describe("Language: 'en' for English (default), 'fr' for French"),
			databaseId: pathSegmentSchema
				.describe("Legislation database ID (e.g., 'ons' for Ontario Statutes, 'cas' for Canada Statutes, 'onr' for Ontario Regulations)"),
			titleContains: z.string().max(200).optional()
				.describe("Case-insensitive substring filter applied to each item's title and citation (e.g. 'supreme court civil', 'limitation act'). Strongly recommended on regulation databases."),
			offset: z.number().min(0).default(0)
				.describe("Pagination offset into the filtered list (default 0)"),
			resultCount: z.number().min(1).max(200).default(50)
				.describe("Maximum items to return (1-200, default 50)"),
			...dateParametersSchema,
		},
		(params) => handlers.browse_legislation(client, params)
	);

	server.tool(
		"get_legislation_regulation_metadata",
		"Get metadata for a specific statute or regulation including its CanLII URL, citation, and table of contents. " +
		"The URL links directly to the full legislation text on canlii.org — always provide this to the user.",
		{
			language: z.enum(["en", "fr"]).default("en")
				.describe("Language: 'en' for English (default), 'fr' for French"),
			databaseId: pathSegmentSchema
				.describe("Legislation database ID (e.g., 'ons' for Ontario Statutes)"),
			legislationId: pathSegmentSchema
				.describe("Specific legislation ID from browse results"),
		},
		(params) => handlers.get_legislation_regulation_metadata(client, params)
	);

	server.tool(
		"legislation_currency",
		"Report whether each cited statute, regulation or rule of court exists in CanLII's legislation databases " +
		"and is unrepealed: currency is current, repealed, archived, not-found or validation_unavailable. " +
		"Pass the instrument as consolidated, never an amending regulation. Inputs naming the same instrument " +
		"are checked once and returned as one result listing their input indexes. For a current B.C. Reg., it " +
		"also lists from BC Laws' Cumulative B.C. Regulations Bulletin the regulations taking effect after the " +
		"marker date (the caller's currency_marker, else CanLII's startDate), with the provisions each amends " +
		"quoted from its text, or `unknown` with the reason. `current` alone never shows the filed text is in " +
		"force: read it with marker_date and amendments_after_marker. It states nothing about what an " +
		"instrument says.",
		{
			instruments: z.array(z.object({
				citation: z.string().min(1).max(200)
					.describe("The instrument's citation as consolidated, as the caller stores it (e.g. 'SBC 2012, c 13')"),
				title: z.string().max(300)
					.describe("The instrument's title as the caller has it"),
				jurisdiction: z.string().regex(/^[a-zA-Z]{2,3}$/)
					.describe("CanLII jurisdiction code (e.g. 'bc', 'ca')"),
				currency_marker: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
					.describe("The filed consolidation's \"current to\" date (YYYY-MM-DD), when the caller holds one"),
			})).min(1).max(50),
		},
		(params) => handlers.legislation_currency(client, params)
	);

	server.tool(
		"configure_credential",
		"Save your CanLII API key to this machine so case-law and legislation lookup works in every future " +
		"session without re-entering it. Use this when the CANLII_API_KEY environment variable is not reaching " +
		"the server — which is the case in Cowork. The key is validated with one cheap authenticated request " +
		"before it is saved, and stored encrypted at rest (Windows DPAPI). An environment variable, if set, " +
		"always takes precedence over the saved key.",
		{
			api_key: z.string().describe("Your CanLII API key (free research key via CanLII's feedback form)."),
		},
		(params) => handlers.configure_credential(client, params)
	);

	server.tool(
		"configure_status",
		"Report whether a CanLII API key is currently configured on this machine, and where it came from " +
		"(environment variable or saved credential), without revealing the key.",
		{},
		() => handlers.configure_status(client)
	);

	return server;
}
