// Amendments after the marker: the B.C. regulations that BC Laws' Cumulative B.C.
// Regulations Bulletin lists against a consolidated B.C. Reg. with an effective
// date after the consolidation's marker date, and the provisions each amends as
// its B.C. Gazette Part II text names them. Rules:
// .claude/skills/shared/research-paralegal/legislation-currency.md. It quotes the
// publisher's own words and never states what an amendment does or whether it
// matters.

/** Reads one URL and returns its body as text. Throws on failure. */
export type GetText = (url: string) => Promise<string>;

export interface Amendment {
	instrument: string;
	effective_date: string | null;
	deposit_date: string | null;
	bulletin_text: string;
	provisions_amended: string[] | "unknown";
	provisions_reason: string | null;
	source_url: string;
}

export interface AmendmentsReport {
	bulletin_current_to: string | null;
	amendments_after_marker: Amendment[] | "unknown";
	amendments_note: string;
}

const BCLAWS = "https://www.bclaws.gov.bc.ca";
const GAZETTE_PATH = /^\/civix\/document\/id\/lc\/bcgaz2\/[A-Za-z0-9_.\-]+$/;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
	"august", "september", "october", "november", "december"];
const DATE = "(January|February|March|April|May|June|July|August|September|October|November|December) (\\d{1,2}), (\\d{4})";

export function bulletinUrl(year: number): string {
	return `${BCLAWS}/civix/document/id/regulationbulletin/regulationbulletin/${year}cumulati`;
}

/** Tags removed, the entities BC Laws uses decoded, whitespace runs collapsed. */
export function htmlText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&#8212;/g, "—")
		.replace(/&#8211;/g, "–")
		.replace(/&#8209;/g, "-")
		.replace(/&#47;/g, "/")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&quot;/g, "\"")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

/** "October 1, 2026" as 2026-10-01. */
function isoDate(month: string, day: string, year: string): string {
	return `${year}-${String(MONTHS.indexOf(month.toLowerCase()) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function firstDate(text: string): string | null {
	const found = new RegExp(DATE).exec(text);
	return found ? isoDate(found[1], found[2], found[3]) : null;
}

/** The regulation number a B.C. Reg. citation names (`B.C. Reg. 168/2009` gives `168/2009`), or null. */
export function regulationNumber(citation: string): string | null {
	return /\bReg\.?\s*(\d+\/\d{2,4})(?!\d)/i.exec(citation)?.[1] ?? null;
}

function names(text: string, number: string): boolean {
	return new RegExp(`(?<!\\d)${number.replace("/", "\\/")}(?!\\d)`).test(text);
}

interface BulletinRow {
	description: string;
	instrument: string;
	href: string | null;
	deposit_date: string | null;
	bulletin_url: string;
}

export function parseBulletin(html: string, year: number): { current_to: string; rows: BulletinRow[] } | string {
	const text = htmlText(html);
	if (!text.includes(`Cumulative B.C. Regulations Bulletin ${year}`)) {
		return `the page does not read as the Cumulative B.C. Regulations Bulletin ${year}`;
	}
	const marker = new RegExp(`current to ${DATE}`).exec(text);
	if (!marker) return `the Cumulative B.C. Regulations Bulletin ${year} states no "current to" date`;
	const rows: BulletinRow[] = [];
	for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]);
		if (cells.length !== 4) continue;
		const instrument = htmlText(cells[2]);
		if (!/^\d+\/\d{2,4}$/.test(instrument)) continue;
		const href = /<a\s[^>]*href="([^"]+)"/i.exec(cells[2])?.[1] ?? null;
		rows.push({
			description: htmlText(cells[1]),
			instrument: `B.C. Reg. ${instrument}`,
			href: href && GAZETTE_PATH.test(href) ? href : null,
			deposit_date: firstDate(htmlText(cells[3])),
			bulletin_url: bulletinUrl(year),
		});
	}
	return { current_to: isoDate(marker[1], marker[2], marker[3]), rows };
}

const OPERATIVE = /\b(?:is|are) (?:amended|repealed|added)\b(?: to [^:.,;]+)?/;

/**
 * The opening clause, through its operative verb, of each amending section in the
 * schedule (or, with no schedules, the body) whose first amending section names
 * `number`. A string is the reason none could be read.
 */
export function parseAmendingSections(html: string, number: string): string[] | string {
	const segments = html.split(/<p[^>]*class="SchHeading"[^>]*>\s*Schedule/i);
	const found: string[] = [];
	for (const segment of segments) {
		const sections = [...segment.matchAll(/<p[^>]*class="amendsec"[^>]*>([\s\S]*?)<\/p>/gi)]
			.map(section => htmlText(section[1]));
		if (sections.length === 0 || !names(sections[0], number)) continue;
		for (const section of sections) {
			const verb = OPERATIVE.exec(section);
			found.push(verb ? section.slice(0, verb.index + verb[0].length) : section);
		}
	}
	return found.length > 0 ? found : `the amending text has no amending section that names ${number}`;
}

/**
 * Every bulletin row naming the instrument whose stated effective date, or, with
 * none stated, whose deposit date falls after `markerDate`. Reads the bulletins of
 * the marker's year before through `today`'s year.
 */
export async function amendmentsAfterMarker(
	number: string,
	markerDate: string,
	today: string,
	getText: GetText,
	pages: Map<string, Promise<string>>,
): Promise<AmendmentsReport> {
	const read = (url: string) => {
		let pending = pages.get(url);
		if (!pending) {
			pending = getText(url);
			pages.set(url, pending);
		}
		return pending;
	};
	const first = Number(markerDate.slice(0, 4)) - 1;
	const last = Number(today.slice(0, 4));
	const rows: BulletinRow[] = [];
	let currentTo = "";
	for (let year = first; year <= last; year++) {
		let parsed;
		try {
			parsed = parseBulletin(await read(bulletinUrl(year)), year);
		} catch (error) {
			return unknown(`Cumulative B.C. Regulations Bulletin ${year} (${bulletinUrl(year)}) could not be read: ${errorText(error)}`);
		}
		if (typeof parsed === "string") return unknown(parsed);
		rows.push(...parsed.rows.filter(row => names(row.description, number)));
		currentTo = parsed.current_to;
	}

	const amendments: Amendment[] = [];
	for (const row of rows) {
		const effective = [...row.description.matchAll(new RegExp(`effective ${DATE}`, "g"))]
			.map(found => isoDate(found[1], found[2], found[3]));
		const after = effective.length > 0
			? effective.some(date => date > markerDate)
			: (row.deposit_date ?? "") > markerDate;
		if (!after) continue;
		const amendment: Amendment = {
			instrument: row.instrument,
			effective_date: effective[0] ?? null,
			deposit_date: row.deposit_date,
			bulletin_text: row.description,
			provisions_amended: "unknown",
			provisions_reason: null,
			source_url: row.href ? BCLAWS + row.href : row.bulletin_url,
		};
		if (!row.href) {
			amendment.provisions_reason = "the bulletin links no B.C. Gazette Part II text for this regulation";
		} else {
			try {
				const sections = parseAmendingSections(await read(amendment.source_url), number);
				if (typeof sections === "string") amendment.provisions_reason = sections;
				else amendment.provisions_amended = sections;
			} catch (error) {
				amendment.provisions_reason = `the amending text could not be read: ${errorText(error)}`;
			}
		}
		amendments.push(amendment);
	}
	return {
		bulletin_current_to: currentTo,
		amendments_after_marker: amendments,
		amendments_note: `Checked the Cumulative B.C. Regulations Bulletins ${first} to ${last} for regulations ` +
			`deposited from ${first}-01-01 to ${currentTo}. Regulations deposited outside those dates are outside this check.`,
	};
}

export function unknown(reason: string): AmendmentsReport {
	return { bulletin_current_to: null, amendments_after_marker: "unknown", amendments_note: reason };
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
