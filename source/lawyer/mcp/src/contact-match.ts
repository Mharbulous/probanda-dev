// The one set of rules for deciding whether two contact records may be the same contact,
// shared by practice data's contact_lookup and the address-book tools.

const CORPORATE_SUFFIX = /\s+(ltd|limited|inc|incorporated|llp|lp|llc|corp|corporation|co)$/;

/** A name with case, punctuation and trailing corporate suffixes ignored. */
export function normalizeName(value: unknown): string {
  let name = String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  while (CORPORATE_SUFFIX.test(name)) name = name.replace(CORPORATE_SUFFIX, "");
  return name;
}

export const PHONE_EXTENSION =/\s*(?:x|ext\.?|extension|#)\s*\d+\s*$/i;

/** A phone's digits without its extension, cut to the last ten so a country code does not matter. */
export function phoneDigits(value: string): string {
  const digits = value.replace(PHONE_EXTENSION, "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function emailKey(value: string): string {
  return value.trim().toLowerCase();
}

export function postalKey(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** What one record, or a set of records, can be matched on. */
export interface MatchKeys {
  names: Set<string>;
  emails: Set<string>;
  phones: Set<string>;
  postals: Set<string>;
}

const MIN_PHONE_DIGITS = 7;

/** The keys of raw values. Empty values, and phones too short to identify anyone, are left out. */
export function matchKeys(raw: { names?: unknown[]; emails?: string[]; phones?: string[]; postals?: string[] }): MatchKeys {
  const keys = (values: string[] | undefined, key: (value: string) => string) =>
    new Set((values ?? []).map(key).filter((value) => value !== ""));
  return {
    names: new Set((raw.names ?? []).map(normalizeName).filter((name) => name !== "")),
    emails: keys(raw.emails, emailKey),
    phones: new Set([...keys(raw.phones, phoneDigits)].filter((digits) => digits.length >= MIN_PHONE_DIGITS)),
    postals: keys(raw.postals, postalKey),
  };
}

/** Why two records may be the same contact. None of these alone proves it: an office line is shared. */
export function matchReasons(a: MatchKeys, b: MatchKeys): string[] {
  const shares = (left: Set<string>, right: Set<string>) => [...left].some((value) => right.has(value));
  const reasons: string[] = [];
  if (shares(a.names, b.names)) reasons.push("same name");
  if (shares(a.emails, b.emails)) reasons.push("shared email");
  if (shares(a.phones, b.phones)) reasons.push("shared phone");
  if (shares(a.postals, b.postals)) reasons.push("same postal code");
  return reasons;
}
