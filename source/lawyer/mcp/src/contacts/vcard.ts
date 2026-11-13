// vCard 3.0 reading (the version iCloud stores). Nothing here builds or changes a
// card: vcard-edit.ts and merge-cards.ts do, from these lines. Ported from the
// practitioner's own mail, calendar and contacts desktop extension (MIT).

export const unescape = (v: string): string => v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

function splitUnescaped(v: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "\\" && i + 1 < v.length) {
      cur += v[i] + v[++i];
      continue;
    }
    if (v[i] === sep) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += v[i];
  }
  out.push(cur);
  return out;
}

/** Split on `sep` outside double quotes. */
function splitOutsideQuotes(v: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of v) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === sep && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export interface Line {
  group?: string;
  name: string;
  params: Record<string, string[]>;
  value: string;
}

/** Parse into raw lines: { group, name, params: {key: [values]}, value }. */
export function parseLines(text: string): Line[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines: Line[] = [];
  for (const raw of unfolded.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let inQuote = false;
    let colon = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '"') inQuote = !inQuote;
      else if (raw[i] === ":" && !inQuote) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const [nameWithGroup, ...paramParts] = splitOutsideQuotes(raw.slice(0, colon), ";");
    const dot = nameWithGroup.indexOf(".");
    const group = dot >= 0 ? nameWithGroup.slice(0, dot) : undefined;
    const name = (dot >= 0 ? nameWithGroup.slice(dot + 1) : nameWithGroup).toUpperCase();
    const params: Record<string, string[]> = {};
    for (const p of paramParts) {
      const eq = p.indexOf("=");
      const key = (eq >= 0 ? p.slice(0, eq) : "TYPE").toUpperCase();
      const vals = splitOutsideQuotes(eq >= 0 ? p.slice(eq + 1) : p, ",").map((s) => s.replace(/^"|"$/g, ""));
      params[key] = [...(params[key] ?? []), ...vals];
    }
    lines.push({ group, name, params, value: raw.slice(colon + 1) });
  }
  return lines;
}

const GENERIC_TYPES = ["internet", "voice", "pref", "x400"];
const typesOf = (l: Line): string[] => (l.params.TYPE ?? []).map((t) => t.toLowerCase()).filter((t) => !GENERIC_TYPES.includes(t));
const isPref = (l: Line): true | undefined => (l.params.TYPE ?? []).some((t) => t.toLowerCase() === "pref") || undefined;

/** Custom X-ABLabel for grouped lines, otherwise the type words, e.g. "work fax". */
function labelFor(lines: Line[], l: Line): string | undefined {
  const custom = l.group && lines.find((x) => x.group === l.group && x.name === "X-ABLABEL");
  if (custom) {
    const v = unescape(custom.value);
    const apple = /^_\$!<(.*)>!\$_$/.exec(v); // Apple's built-in labels, e.g. _$!<Other>!$_
    return apple ? apple[1].toLowerCase() : v;
  }
  return typesOf(l).join(" ") || undefined;
}

function parseBirthday(line: Line | undefined): string | undefined {
  if (!line) return undefined;
  const v = line.value.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  if (line.params["X-APPLE-OMIT-YEAR"] || v.startsWith("1604-")) return `--${v.slice(5, 10)}`;
  return v;
}

export interface Entry {
  label?: string;
  value: string;
  preferred?: true;
}

export interface Contact {
  uid?: string;
  name: string;
  prefix?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  organization?: string;
  department?: string;
  jobTitle?: string;
  emails: Entry[];
  phones: Entry[];
  addresses: Array<{
    label?: string;
    preferred?: true;
    poBox?: string;
    extended?: string;
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  }>;
  birthday?: string;
  notes?: string;
  isGroup: boolean;
}

/** Structured contact from vCard text. */
export function parseContact(text: string): Contact {
  const lines = parseLines(text);
  const one = (n: string): Line | undefined => lines.find((l) => l.name === n);
  const nLine = one("N");
  const orgLine = one("ORG");
  const n = nLine ? splitUnescaped(nLine.value, ";").map(unescape) : [];
  const org = orgLine ? splitUnescaped(orgLine.value, ";").map(unescape) : [];
  const text1 = (name: string): string | undefined => {
    const l = one(name);
    return l ? unescape(l.value) : undefined;
  };
  const entry = (l: Line, value: string): Entry => ({ label: labelFor(lines, l), value, preferred: isPref(l) });
  return {
    uid: text1("UID"),
    name: text1("FN") ?? [n[1], n[0]].filter(Boolean).join(" "),
    prefix: n[3] || undefined,
    firstName: n[1] || undefined,
    middleName: n[2] || undefined,
    lastName: n[0] || undefined,
    suffix: n[4] || undefined,
    organization: org[0] || undefined,
    department: org[1] || undefined,
    jobTitle: text1("TITLE"),
    emails: lines.filter((l) => l.name === "EMAIL").map((l) => entry(l, unescape(l.value))),
    phones: lines.filter((l) => l.name === "TEL").map((l) => entry(l, unescape(l.value))),
    addresses: lines
      .filter((l) => l.name === "ADR")
      .map((l) => {
        const [poBox, extended, street, city, region, postalCode, country] = splitUnescaped(l.value, ";").map(unescape);
        return {
          label: labelFor(lines, l),
          preferred: isPref(l),
          poBox: poBox || undefined,
          extended: extended || undefined,
          street,
          city,
          region,
          postalCode,
          country,
        };
      }),
    birthday: parseBirthday(one("BDAY")),
    notes: text1("NOTE"),
    isGroup: /^group$/i.test(text1("X-ADDRESSBOOKSERVER-KIND") ?? ""),
  };
}
