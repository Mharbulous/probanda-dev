#!/usr/bin/env node
// REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
	CitedCasesResponseSchema,
	CitingCasesResponseSchema,
	CitedLegislationsResponseSchema,
	LegislationResponseSchema,
	LegislationItemResponseSchema,
	LegislationMetadataSchema,
} from "./schema.js";
import { loadApiKey, persistApiKey, redactedKeyHint } from "./dpapi-store.js";
import { checkLegislationCurrency } from "./legislation-currency.js";

// The key is optional: the server must start without it so canlii tools stay
// registered. Requests fail at point of use (see apiFetch) with instructions to
// add the key, rather than blocking the base practice at startup.
//
// Resolved in main() before the transport connects: env var first (Claude Code
// CLI inherits the user env), then the DPAPI-persisted credential — the only
// path that reaches Cowork's LocalSystem VM service, see dpapi-store.ts. Mutable
// so configure_credential can update it live, mid-session, without a restart.
let apiKey = "";
let apiKeySource: "env" | "stored" | "none" = "none";
// Set when a persisted credential existed but could not be decrypted/read (e.g.
// a DPAPI key invalidated by a Windows profile change). Rides on the "not
// configured" error so the cause is named rather than silently swallowed.
let credentialError: string | undefined;

// Rate limiter: 2 req/sec, 1 concurrent, 5000/day (per CanLII API terms)
// Uses a promise queue to serialize all requests — prevents concurrent API calls.
let requestQueue: Promise<void> = Promise.resolve();
let dailyCount = 0;
let dailyResetDate = new Date().toDateString();
const MIN_INTERVAL_MS = 500;
const TIMEOUT_MS = 60_000;
let lastRequestTime = 0;

function missingKeyMessage(): string {
	return "CanLII API key not configured. Case-law and legislation lookup is an optional feature. " +
		"To enable it, either set the CANLII_API_KEY environment variable (Claude Code CLI inherits it), " +
		"or — if the environment variable is not reaching this server, which is the case in Cowork — call " +
		"the canlii configure_credential tool with your key. Request a free research key via CanLII's " +
		"feedback form. Every other litigation feature works without it." +
		(credentialError
			? ` (Note: a saved key exists on this machine but could not be read — ${credentialError} — ` +
			  "so re-supply it via configure_credential.)"
			: "");
}

async function apiFetch(url: string): Promise<Response> {
	if (!apiKey) {
		throw new Error(missingKeyMessage());
	}
	return new Promise((resolve, reject) => {
		requestQueue = requestQueue.then(async () => {
			const today = new Date().toDateString();
			if (today !== dailyResetDate) {
				dailyCount = 0;
				dailyResetDate = today;
			}
			if (dailyCount >= 5000) {
				throw new Error("Daily API limit reached (5,000 queries). Try again tomorrow.");
			}
			const now = Date.now();
			const elapsed = now - lastRequestTime;
			if (elapsed < MIN_INTERVAL_MS) {
				await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
			}
			lastRequestTime = Date.now();
			dailyCount++;
			try {
				return await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
			} catch (error) {
				// The detail must never carry the URL: it holds api_key.
				const detail = sanitizeError(error instanceof Error ? error.message : String(error));
				throw new Error(`network: CanLII could not be reached (${detail})`);
			}
		}).then(resolve, reject);
	});
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		const flat = text.replace(/\s+/g, " ").trim();
		throw new Error(`CanLII returned a reply that is not JSON: ${flat.length > 200 ? `${flat.slice(0, 200)}…` : flat}`);
	}
}

// Version is injected at bundle time by esbuild `define` (scripts/bundle.mjs).
// Do NOT read package.json at runtime: the packaged plugin ships only dist/, so a
// runtime require("../package.json") crashes the server at startup in the installed copy.
declare const __CANLII_VERSION__: string;
const version = __CANLII_VERSION__;

const server = new McpServer({
	name: "CanLII MCP",
	version,
	description: "Local MCP server for Canadian legal research via the CanLII API. Always include CanLII URLs in responses so the user can verify sources directly."
});

// Input validation schemas for path segments
const pathSegmentSchema = z.string().regex(/^[a-zA-Z0-9_\-]{1,100}$/, "Invalid identifier — must be alphanumeric, hyphens, or underscores only");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional();

function buildDateParams(params: URLSearchParams, options: {
	publishedBefore?: string;
	publishedAfter?: string;
	modifiedBefore?: string;
	modifiedAfter?: string;
	changedBefore?: string;
	changedAfter?: string;
	decisionDateBefore?: string;
	decisionDateAfter?: string;
}) {
	if (options.publishedBefore) params.append('publishedBefore', options.publishedBefore);
	if (options.publishedAfter) params.append('publishedAfter', options.publishedAfter);
	if (options.modifiedBefore) params.append('modifiedBefore', options.modifiedBefore);
	if (options.modifiedAfter) params.append('modifiedAfter', options.modifiedAfter);
	if (options.changedBefore) params.append('changedBefore', options.changedBefore);
	if (options.changedAfter) params.append('changedAfter', options.changedAfter);
	if (options.decisionDateBefore) params.append('decisionDateBefore', options.decisionDateBefore);
	if (options.decisionDateAfter) params.append('decisionDateAfter', options.decisionDateAfter);
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

function sanitizeError(message: string): string {
	return message.replace(/api_key=[^&\s]*/gi, "api_key=REDACTED");
}

export function errorResponse(message: string) {
	return { ...textResponse(sanitizeError(message)), isError: true };
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

// ============================================================
// TOOL: get_case_citator
// ============================================================
server.tool(
	"get_case_citator",
	"Look up citation relationships for a case. Critical for verifying if a case is still good law. " +
	"Use 'citingCases' to see what later cases cite this decision — if many recent cases cite it approvingly, it is strong authority. " +
	"Use 'citedCases' to see what authorities this case relied on. " +
	"Use 'citedLegislations' to see what statutes the case references. " +
	"Returns the full list of citing/cited items.",
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
	async (params) => {
		try {
			const { language, databaseId, caseId, metadataType, ...dateParams } = params;
			const urlParams = new URLSearchParams({ api_key: apiKey });
			buildDateParams(urlParams, dateParams);

			const response = await apiFetch(
				`https://api.canlii.org/v1/caseCitator/${language}/${encodeURIComponent(databaseId)}/${encodeURIComponent(caseId)}/${metadataType}?${urlParams.toString()}`
			);

			if (!response.ok) {
				return errorResponse(`Error: Failed to fetch case citator data (${response.status})`);
			}

			const data = await readJson(response);

			const schemaMap = {
				citedCases: CitedCasesResponseSchema,
				citingCases: CitingCasesResponseSchema,
				citedLegislations: CitedLegislationsResponseSchema,
			} as const;

			const parsed = schemaMap[metadataType].parse(data);
			return jsonResponse(parsed);
		} catch (error) {
			return errorResponse(
				`Error: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	}
);

// ============================================================
// TOOL: get_case_citator_tease
// ============================================================
server.tool(
	"get_case_citator_tease",
	"Quick preview of citation relationships (max 5 results). Faster than the full citator. " +
	"Use this for a quick check on whether a case has been cited, then use get_case_citator for the complete list if needed.",
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
	async ({ language, databaseId, caseId, metadataType }) => {
		try {
			const params = new URLSearchParams({ api_key: apiKey });

			const response = await apiFetch(
				`https://api.canlii.org/v1/caseCitatorTease/${language}/${encodeURIComponent(databaseId)}/${encodeURIComponent(caseId)}/${metadataType}?${params.toString()}`
			);

			if (!response.ok) {
				return errorResponse(`Error: Failed to fetch citator tease data (${response.status})`);
			}

			const data = await readJson(response);

			const schemaMap = {
				citedCases: CitedCasesResponseSchema,
				citingCases: CitingCasesResponseSchema,
				citedLegislations: CitedLegislationsResponseSchema,
			} as const;

			const parsed = schemaMap[metadataType].parse(data);
			return jsonResponse(parsed);
		} catch (error) {
			return errorResponse(
				`Error: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	}
);

// ============================================================
// TOOL: get_legislation_databases
// ============================================================
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
	async (params) => {
		try {
			const { language, ...dateParams } = params;
			const urlParams = new URLSearchParams({ api_key: apiKey });
			buildDateParams(urlParams, dateParams);

			const response = await apiFetch(
				`https://api.canlii.org/v1/legislationBrowse/${language}/?${urlParams.toString()}`
			);

			if (!response.ok) {
				return errorResponse(`Error: Failed to fetch legislation databases (${response.status})`);
			}

			const data = await readJson(response);
			const parsed = LegislationResponseSchema.parse(data);
			return jsonResponse(parsed);
		} catch (error) {
			return errorResponse(
				`Error: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	}
);

// ============================================================
// TOOL: browse_legislation
// ============================================================
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
	async (params) => {
		try {
			const { language, databaseId, titleContains, offset, resultCount, ...dateParams } = params;
			const urlParams = new URLSearchParams({ api_key: apiKey });
			buildDateParams(urlParams, dateParams);

			// The upstream endpoint has no pagination or filter parameters — it
			// returns the entire database in one response (bcr: ~800 KB), so the
			// bounding must happen here before the payload reaches the model.
			const response = await apiFetch(
				`https://api.canlii.org/v1/legislationBrowse/${language}/${encodeURIComponent(databaseId)}/?${urlParams.toString()}`
			);

			if (!response.ok) {
				return errorResponse(`Error: Failed to fetch legislation list (${response.status})`);
			}

			const data = await readJson(response);
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
			return errorResponse(
				`Error: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	}
);

// ============================================================
// TOOL: get_legislation_regulation_metadata
// ============================================================
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
	async ({ language, databaseId, legislationId }) => {
		try {
			const params = new URLSearchParams({ api_key: apiKey });

			const response = await apiFetch(
				`https://api.canlii.org/v1/legislationBrowse/${language}/${encodeURIComponent(databaseId)}/${encodeURIComponent(legislationId)}/?${params.toString()}`
			);

			if (!response.ok) {
				return errorResponse(`Error: Failed to fetch legislation metadata (${response.status})`);
			}

			const data = await readJson(response);
			const parsed = LegislationMetadataSchema.parse(data);
			return jsonResponse(parsed);
		} catch (error) {
			return errorResponse(
				`Error: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	}
);

// ============================================================
// TOOL: legislation_currency
// ============================================================
// Leg 1 of shared/statute-currency.md in one call, so the main session needs no
// agent for it. Inputs sharing a key (jurisdiction + normalized citation) are
// checked once: one currency check per Act.
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
	async ({ instruments }) => {
		if (!apiKey) {
			return jsonResponse({ status: "blocked (no-api-key)", detail: missingKeyMessage() });
		}
		try {
			const report = await checkLegislationCurrency(instruments, async (path) => {
				const params = new URLSearchParams({ api_key: apiKey });
				const response = await apiFetch(`https://api.canlii.org/v1/${path}?${params.toString()}`);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return readJson(response);
			}, async (url) => {
				const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.text();
			}, new Date().toLocaleDateString("en-CA"));
			for (const result of report.instruments) {
				if (result.error) result.error = sanitizeError(result.error);
			}
			return jsonResponse({ status: "complete", ...report });
		} catch (error) {
			return errorResponse(
				`Error: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	}
);

// ============================================================
// TOOL: configure_credential
// ============================================================
// Cowork delivery workaround (see dpapi-store.ts). Cowork runs this server inside
// a LocalSystem VM service that never sees the practitioner's CANLII_API_KEY
// user env var, so in Cowork the key can only arrive as a tool argument. Accepts
// it, validates it with one cheap authenticated request, then persists it
// DPAPI-encrypted so every later session finds it. env still wins outright.
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
	async ({ api_key }) => {
		const key = api_key.trim();
		if (!key) {
			return errorResponse("Error: configure_credential requires a non-empty api_key.");
		}

		// Set live BEFORE validating, so the probe uses the new key; restore on
		// failure so a bad key never knocks out an already-working session.
		const previousKey = apiKey;
		const previousSource = apiKeySource;
		apiKey = key;
		apiKeySource = "stored";

		try {
			await probeKey();
		} catch (error) {
			apiKey = previousKey;
			apiKeySource = previousSource;
			return errorResponse(
				`Error: that key did not work against CanLII, so it was not saved: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}

		try {
			await persistApiKey(key);
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
	}
);

// ============================================================
// TOOL: configure_status
// ============================================================
server.tool(
	"configure_status",
	"Report whether a CanLII API key is currently configured on this machine, and where it came from " +
	"(environment variable or saved credential), without revealing the key.",
	{},
	async () => jsonResponse({
		configured: Boolean(apiKey),
		source: apiKeySource,
		key_hint: redactedKeyHint(apiKey),
	})
);

// One cheap authenticated request (the matter-database index) — confirms a key is
// accepted before it is persisted, so a wrong-but-plausible key fails here with
// a clear cause instead of on some later lookup.
async function probeKey(): Promise<void> {
	const params = new URLSearchParams({ api_key: apiKey });
	const response = await apiFetch(`https://api.canlii.org/v1/caseBrowse/en/?${params.toString()}`);
	if (!response.ok) {
		throw new Error(`CanLII rejected the request (HTTP ${response.status}).`);
	}
}

async function main() {
	const resolved = await loadApiKey();
	apiKey = resolved.key;
	apiKeySource = resolved.source;
	credentialError = resolved.error;
	if (resolved.error) {
		process.stderr.write(
			`canlii-mcp: stored credential could not be read — ${resolved.error}\n` +
			"Starting without a key; call configure_credential to supply one.\n"
		);
	}

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	main().catch((error) => {
		console.error("Fatal error:", error);
		process.exit(1);
	});
}
