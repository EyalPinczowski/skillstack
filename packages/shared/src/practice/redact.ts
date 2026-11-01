/**
 * Personal-detail redaction for anything that may reach an AI model.
 *
 * Pure and deterministic, no I/O. Every pattern is linear-time: quantifiers are bounded and
 * no group is repeated inside another repeated group, so there is no catastrophic backtracking.
 *
 * Limits (also stated in the privacy page): names the app does not know (a recruiter in a job
 * description, a friend in a chat turn) cannot be detected reliably, and neither can obfuscated
 * contact details ("name at example dot com", digits spelled out as words).
 */

export const REDACTED = '[removed]';

export type PiiKind = 'email' | 'url' | 'handle' | 'phone' | 'identifier';

export class PiiLeakError extends Error {
  readonly kinds: PiiKind[];
  constructor(kinds: PiiKind[]) {
    super(`Personal details detected (${kinds.join(', ')})`);
    this.name = 'PiiLeakError';
    this.kinds = kinds;
  }
}

export interface RedactOptions {
  /** The user's own identifiers (email, its local part, name tokens). Matched as whole words. */
  knownIdentifiers?: readonly string[];
}

export interface RedactResult {
  text: string;
  /** How many spans were replaced. */
  count: number;
}

const EMAIL = /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63})+/gu;
const URL_SCHEME = /\b(?:https?|ftp|file):\/\/[^\s<>"]{1,2000}/giu;
const WWW = /\bwww\.[^\s<>"]{1,2000}/giu;
const TLDS = 'com|org|net|io|co|dev|app|ai|edu|gov|info|biz|me|uk|de|fr|il|us|ca|au|nl|ru|xyz|tech';
const DOMAIN = new RegExp(
  `(?<![\\p{L}\\p{N}@.-])(?:[\\p{L}\\p{N}-]{1,63}\\.){1,5}(?:${TLDS})(?![\\p{L}\\p{N}-])(?:\\/[^\\s<>"]{0,2000})?`,
  'giu',
);
const HANDLE = /(?<![\p{L}\p{N}_@])@[A-Za-z0-9_]{3,30}(?![\p{L}\p{N}_])/gu;
const PHONE = /(?<!\d)\+?\(?\d[\d \t().-]{7,40}\d/g;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const SLASH_DATE = /\d{1,2}[./]\d{1,2}[./]\d{2,4}/g;
const MIN_PHONE_DIGITS = 9;

/** Zero-width characters used to split an address so a pattern misses it. */
const INVISIBLE = new RegExp('[\\u200B-\\u200D\\u2060\\uFEFF]', 'g');

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalise(text: string): string {
  return text.replace(INVISIBLE, '').normalize('NFKC');
}

function isPhone(candidate: string): boolean {
  const withoutDates = candidate.replace(ISO_DATE, ' ').replace(SLASH_DATE, ' ');
  const digits = withoutDates.replace(/\D/g, '').length;
  if (digits < MIN_PHONE_DIGITS) return false;
  // Version numbers such as 10.2.3.4.5.6.7.8.9: only dots between groups of one or two digits.
  const dotsOnly = !/[^\d.]/.test(candidate);
  const groups = candidate.split(/\D+/).filter(Boolean);
  const versionLike = dotsOnly && groups.every((g) => g.length <= 2);
  return !versionLike;
}

function knownIdentifierPattern(ids: readonly string[]): RegExp | null {
  const clean = [...new Set(ids.map((s) => normalise(s).trim()).filter((s) => s.length > 0))];
  if (clean.length === 0) return null;
  clean.sort((a, b) => b.length - a.length);
  const alternation = clean.map(escapeRegExp).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'giu');
}

/** Replaces emails, URLs, handles, phone numbers and the known identifiers with `[removed]`. */
export function redactPii(text: string, options: RedactOptions = {}): RedactResult {
  let count = 0;
  const hit = (): string => {
    count += 1;
    return REDACTED;
  };
  let out = normalise(text);
  out = out.replace(EMAIL, hit);
  out = out.replace(URL_SCHEME, hit);
  out = out.replace(WWW, hit);
  out = out.replace(DOMAIN, hit);
  out = out.replace(HANDLE, hit);
  const known = knownIdentifierPattern(options.knownIdentifiers ?? []);
  if (known) out = out.replace(known, hit);
  out = out.replace(PHONE, (m) => (isPhone(m) ? hit() : m));
  return { text: out, count };
}

function test(re: RegExp, text: string): boolean {
  return new RegExp(re.source, re.flags.replace('g', '')).test(text);
}

/** Which kinds of personal detail are still present in `text` (empty when it is clean). */
export function findPii(text: string, options: RedactOptions = {}): PiiKind[] {
  // Redacted spans are not leaks; strip them so the marker itself can never trigger a match.
  const probe = normalise(text).split(REDACTED).join(' ');
  const kinds: PiiKind[] = [];
  if (test(EMAIL, probe)) kinds.push('email');
  if (test(URL_SCHEME, probe) || test(WWW, probe) || test(DOMAIN, probe)) kinds.push('url');
  if (test(HANDLE, probe)) kinds.push('handle');
  if ((probe.match(PHONE) ?? []).some(isPhone)) kinds.push('phone');
  const known = knownIdentifierPattern(options.knownIdentifiers ?? []);
  if (known && test(known, probe)) kinds.push('identifier');
  return kinds;
}

/** Final gate: throws `PiiLeakError` when anything personal survived. Fails closed. */
export function assertNoPii(text: string, options: RedactOptions = {}): void {
  const kinds = findPii(text, options);
  if (kinds.length > 0) throw new PiiLeakError(kinds);
}

/**
 * The identifiers to hide for one user: the email, its local part, and each display-name token
 * of three or more letters.
 */
export function knownIdentifiersFor(user: {
  email?: string | null;
  displayName?: string | null;
}): string[] {
  const ids: string[] = [];
  const email = user.email?.trim();
  if (email) {
    ids.push(email);
    const local = email.split('@')[0] as string;
    if (local.length >= 3) ids.push(local);
  }
  for (const token of (user.displayName ?? '').split(/[^\p{L}]+/u)) {
    if (token.length >= 3) ids.push(token);
  }
  return ids;
}
