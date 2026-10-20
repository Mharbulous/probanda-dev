// The shape of a request for Probanda's key, for key-request-submit. It imports
// nothing, so it runs under Node as well as Deno. It keeps only what verifying
// that a person is a practising lawyer requires
// (docs/Plans/2026-10-18_lawyer-only-access.md section 2.1), plus an email and an
// optional phone Brahm uses only to contact the applicant, all Account
// Information (COMMANDMENTS.md, Commandment 2) (never to deliver the
// key, which goes to the publicly listed address), and returns the row to save,
// or a guiding question about the request when it would not be saved
// (Commandment 6).

export const MAX_NAME = 200;
export const MAX_EMAIL = 254;
export const MAX_PHONE = 40;
export const FIELDS = ["full_name", "jurisdiction", "year_of_call", "call_date", "firm_name", "email", "phone", "token_hash"];

export interface KeyRequest {
  full_name: string;
  jurisdiction: "BC";
  year_of_call: number;
  call_date: string | null;
  firm_name: string;
  email: string;
  phone: string | null;
  token_hash: string;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function checkRequest(body: Record<string, unknown>, thisYear = new Date().getUTCFullYear()): { ok: KeyRequest } | { question: string } {
  if (Object.keys(body).some((key) => !FIELDS.includes(key))) {
    return { question: "Could this request hold only the full name, jurisdiction, year of call, call date, firm name, email and phone?" };
  }
  const fullName = text(body.full_name);
  const firmName = text(body.firm_name);
  if (!fullName || !firmName || fullName.length > MAX_NAME || firmName.length > MAX_NAME) {
    return { question: `What are your full name and your firm's name as the Law Society's directory shows them, each in 1 to ${MAX_NAME} characters?` };
  }
  if (body.jurisdiction !== "BC") {
    return { question: "Are you called to the bar in British Columbia (BC)?" };
  }
  const year = body.year_of_call;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 1900 || year > thisYear) {
    return { question: "In which year were you called to the bar?" };
  }
  const callDate = body.call_date === undefined || body.call_date === null ? null : text(body.call_date);
  if (callDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(callDate) || Number(callDate.slice(0, 4)) !== year)) {
    return { question: "On which date in your year of call were you called, as YYYY-MM-DD?" };
  }
  const email = text(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > MAX_EMAIL) {
    return { question: "At which email address can Probanda contact you about this request?" };
  }
  const phone = body.phone === undefined || body.phone === null ? null : text(body.phone);
  if (phone !== null && (!/^[0-9+().\- ]+$/.test(phone) || phone.length > MAX_PHONE)) {
    return { question: `At which phone number can Probanda reach you, in digits, spaces and + ( ) - only, up to ${MAX_PHONE} characters?` };
  }
  const tokenHash = text(body.token_hash);
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) {
    return { question: "Which request is this? Ask for a new link and send the request again." };
  }
  return {
    ok: {
      full_name: fullName, jurisdiction: "BC", year_of_call: year, call_date: callDate, firm_name: firmName,
      email, phone, token_hash: tokenHash,
    },
  };
}
