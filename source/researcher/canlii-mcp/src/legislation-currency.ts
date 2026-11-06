// REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/.
//
// Leg 1 of .claude/skills/shared/statute-currency.md, as code. The rules are
// .claude/skills/shared/legislation-currency.md; this module
// applies them and nothing else. It reports CanLII metadata about each
// instrument's own record and, for a current B.C. Reg., the amendments after its
// marker (amendments.ts). It never states what an instrument says.
import {
	LegislationItemResponseSchema,
	LegislationMetadataSchema,
	LegislationResponseSchema,
} from "./schema.js";
import { amendmentsAfterMarker, regulationNumber, unknown, type Amendment, type GetText } from "./amendments.js";

export type Currency = "current" | "repealed" | "archived" | "not-found" | "validation_unavailable";

export interface InstrumentInput {
	citation: string;
	title: string;
	jurisdiction: string;
	/** The filed consolidation's "current to" date (YYYY-MM-DD), when the caller holds one. */
	currency_marker?: string;
}

export interface NearItem {
	databaseId: string;
	legislationId: string;
	title: string;
	citation: string;
}

export interface CurrencyResult {
	key: string;
	inputs: number[];
	citation: string;
	title: string;
	jurisdiction: string;
	currency: Currency;
	databaseId: string | null;
	database_name: string | null;
	legislationId: string | null;
	returned_title: string | null;
	returned_citation: string | null;
	repealed: string | null;
	startDate: string | null;
	endDate: string | null;
	dateScheme: string | null;
	url: string | null;
	near_items: NearItem[];
	error: string | null;
	marker_date: string | null;
	marker_source: "currency_marker" | "canlii_startDate" | null;
	fetched_on: string;
	bulletin_current_to: string | null;
	amendments_after_marker: Amendment[] | "unknown";
	amendments_note: string;
}

/** Reads one CanLII API path (e.g. `legislationBrowse/en/bcs/`) and returns its JSON. Throws on failure. */
export type GetJson = (path: string) => Promise<unknown>;

const NEAR_ITEMS_CAP = 10;

/** The matcher's comparison form: periods removed, case folded, whitespace runs collapsed. */
export function normalizeCitation(text: string): string {
	return text.replace(/\./g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** One currency check per Act: inputs sharing this key are checked once. */
export function instrumentKey(instrument: InstrumentInput): string {
	return `${instrument.jurisdiction.trim().toLowerCase()}|${normalizeCitation(instrument.citation)}`;
}

/** A tool that errors is tried once more before the instrument reads validation_unavailable. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch {
		return await call();
	}
}

function isArchiveDatabase(name: string): boolean {
	return /archive|historical/i.test(name);
}

function isRepealed(repealed: string | undefined, endDate: string | undefined): boolean {
	const flag = repealed?.trim() ?? "";
	return (flag !== "" && flag.toUpperCase() !== "NO") || (endDate?.trim() ?? "") !== "";
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function blank(instrument: InstrumentInput, key: string, inputs: number[], today: string): CurrencyResult {
	return {
		key, inputs,
		citation: instrument.citation, title: instrument.title, jurisdiction: instrument.jurisdiction,
		currency: "not-found",
		databaseId: null, database_name: null, legislationId: null,
		returned_title: null, returned_citation: null,
		repealed: null, startDate: null, endDate: null, dateScheme: null, url: null,
		near_items: [], error: null,
		marker_date: null, marker_source: null, fetched_on: today,
		...unknown("no amendment check: the instrument is not current"),
	};
}

type Item = { databaseId: string; legislationId: string; title: string; citation: string };
type Database = { databaseId: string; name: string; jurisdiction: string };

/**
 * `getText` reads BC Laws pages for the amendment check; `today` (YYYY-MM-DD) is
 * the date the check runs.
 */
export async function checkLegislationCurrency(
	instruments: InstrumentInput[],
	getJson: GetJson,
	getText: GetText,
	today: string,
): Promise<{ instruments: CurrencyResult[] }> {
	const groups = new Map<string, { instrument: InstrumentInput; inputs: number[] }>();
	instruments.forEach((instrument, index) => {
		const key = instrumentKey(instrument);
		const group = groups.get(key);
		if (group) {
			group.inputs.push(index);
			// Inputs naming one Act with different markers: the earliest checks the most.
			const marker = instrument.currency_marker;
			const held = group.instrument.currency_marker;
			if (marker && (!held || marker < held)) group.instrument = { ...group.instrument, currency_marker: marker };
		} else groups.set(key, { instrument, inputs: [index] });
	});

	let databases: Database[];
	try {
		const data = await withRetry(() => getJson("legislationBrowse/en/"));
		databases = LegislationResponseSchema.parse(data).legislationDatabases;
	} catch (error) {
		const detail = `get_legislation_databases: ${errorText(error)}`;
		return {
			instruments: [...groups.entries()].map(([key, { instrument, inputs }]) => ({
				...blank(instrument, key, inputs, today), currency: "validation_unavailable" as const, error: detail,
			})),
		};
	}

	// The endpoint returns a whole database per call, so each is read once and
	// filtered here for every instrument.
	const listings = new Map<string, Promise<Item[]>>();
	const listing = (databaseId: string) => {
		let pending = listings.get(databaseId);
		if (!pending) {
			pending = withRetry(() => getJson(`legislationBrowse/en/${encodeURIComponent(databaseId)}/`))
				.then(data => LegislationItemResponseSchema.parse(data).legislations);
			listings.set(databaseId, pending);
		}
		return pending;
	};

	const pages = new Map<string, Promise<string>>();
	const results: CurrencyResult[] = [];
	for (const [key, { instrument, inputs }] of groups) {
		const result = await checkOne(instrument, key, inputs, databases, listing, getJson, today);
		if (result.currency === "current") await checkAmendments(result, instrument, today, getText, pages);
		results.push(result);
	}
	return { instruments: results };
}

/** Sets the marker and the amendments after it on a `current` result. Never changes `currency`. */
async function checkAmendments(
	result: CurrencyResult,
	instrument: InstrumentInput,
	today: string,
	getText: GetText,
	pages: Map<string, Promise<string>>,
): Promise<void> {
	if (instrument.currency_marker) {
		result.marker_date = instrument.currency_marker;
		result.marker_source = "currency_marker";
	} else if (result.startDate) {
		result.marker_date = result.startDate;
		result.marker_source = "canlii_startDate";
	}
	const number = regulationNumber(instrument.citation);
	let report;
	if (instrument.jurisdiction.trim().toLowerCase() !== "bc" || !number) {
		report = unknown("no amendment source: only a B.C. Reg. citation is checked, against BC Laws' " +
			"Cumulative B.C. Regulations Bulletin");
	} else if (!result.marker_date) {
		report = unknown("no marker date: the caller gave no currency_marker and CanLII returned no startDate");
	} else {
		report = await amendmentsAfterMarker(number, result.marker_date, today,
			url => withRetry(() => getText(url)), pages);
	}
	Object.assign(result, report);
}

async function checkOne(
	instrument: InstrumentInput,
	key: string,
	inputs: number[],
	databases: Database[],
	listing: (databaseId: string) => Promise<Item[]>,
	getJson: GetJson,
	today: string,
): Promise<CurrencyResult> {
	const result = blank(instrument, key, inputs, today);
	const jurisdiction = instrument.jurisdiction.trim().toLowerCase();
	const kept = databases.filter(db => db.jurisdiction.toLowerCase() === jurisdiction);

	const items: Array<Item & { database: Database }> = [];
	for (const database of kept) {
		try {
			for (const item of await listing(database.databaseId)) items.push({ ...item, database });
		} catch (error) {
			result.currency = "validation_unavailable";
			result.error = `browse_legislation ${database.databaseId}: ${errorText(error)}`;
			return result;
		}
	}

	// Browse by the citation (periods removed); if nothing comes back, by the title.
	const contains = (needle: string) => items.filter(item =>
		normalizeCitation(item.title).includes(needle) || normalizeCitation(item.citation).includes(needle));
	let hits = contains(normalizeCitation(instrument.citation));
	if (hits.length === 0 && instrument.title.trim() !== "") hits = contains(normalizeCitation(instrument.title));

	const wanted = normalizeCitation(instrument.citation);
	const matches = hits.filter(item => normalizeCitation(item.citation) === wanted);
	result.near_items = hits
		.filter(item => normalizeCitation(item.citation) !== wanted)
		.slice(0, NEAR_ITEMS_CAP)
		.map(({ databaseId, legislationId, title, citation }) => ({ databaseId, legislationId, title, citation }));
	if (matches.length === 0) return result;

	const live = matches.filter(item => !isArchiveDatabase(item.database.name));
	const match = live[0] ?? matches[0];
	result.databaseId = match.databaseId;
	result.database_name = match.database.name;
	result.legislationId = match.legislationId;

	let metadata;
	try {
		const data = await withRetry(() => getJson(
			`legislationBrowse/en/${encodeURIComponent(match.databaseId)}/${encodeURIComponent(match.legislationId)}/`));
		metadata = LegislationMetadataSchema.parse(data);
	} catch (error) {
		result.currency = "validation_unavailable";
		result.error = `get_legislation_regulation_metadata ${match.databaseId}/${match.legislationId}: ${errorText(error)}`;
		return result;
	}

	result.returned_title = metadata.title;
	result.returned_citation = metadata.citation;
	result.repealed = metadata.repealed ?? null;
	result.startDate = metadata.startDate ?? null;
	result.endDate = metadata.endDate ?? null;
	result.dateScheme = metadata.dateScheme ?? null;
	result.url = metadata.url;
	result.currency = isRepealed(metadata.repealed, metadata.endDate)
		? "repealed"
		: live.length === 0 ? "archived" : "current";
	return result;
}
