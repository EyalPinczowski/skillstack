/**
 * Personal-detail redaction for anything that may reach an AI model.
 *
 * Pure and deterministic, no I/O. Every pattern is linear-time: quantifiers are bounded and
 * no group is repeated inside another repeated group, so there is no catastrophic backtracking.
 *
 * Text is normalised before matching: NFKC, invisible and bidi format characters removed
 * (every Default_Ignorable_Code_Point), non-ASCII decimal digits mapped to ASCII, and dash
 * punctuation mapped to '-'. The returned text is the normalised text.
 *
 * Detection rules:
 * - emails, `scheme://` URLs, `www.` hosts, and any `host.tld/path` with a 2 to 24 letter TLD;
 * - bare hosts without a path only for an allowlist of lowercase TLDs (so ASP.NET, VB.NET and
 *   System.IO survive, and `LinkedIn.COM` without a path does not match);
 * - `@handles` of 3 to 32 characters, except code-looking ones (followed by `(`, CSS at-rules,
 *   after DECLARE/SET/SELECT, or inside backticks);
 * - digit runs of 9 or more with separators (space, dot, dash, slash, parentheses);
 * - the user's known identifiers, matched as whole words (letters and marks on both sides).
 *
 * Limits (also stated in the privacy page):
 * - names the app does not know (a recruiter in a job description, a friend in a chat turn)
 *   cannot be detected;
 * - obfuscated details are not detected: "name at example dot com", digits spelled as words,
 *   HTML entities, percent-encoding, `git@github.com:user/repo`;
 * - homoglyphs (a Cyrillic letter inside "Eyal") and accent-folded names do not match;
 * - a name written with niqqud or other optional marks does not match the same name without them;
 * - false positives are accepted: runs of 9+ digits in a number list ("10 20 30 40 50"),
 *   long numbers with thousands separators, and every occurrence of a user name that is also an
 *   ordinary word. Dash characters in user text become '-'.
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

const MAX_PASSES = 3;
/** What stands in for a removed span while checking, so digits on both sides never join up. */
const SENTINEL = '|';

const EMAIL = /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63})+/gu;
const URL_SCHEME = /\b(?:https?|ftp|file):\/\/[^\s<>"]{1,2000}/giu;
const WWW = /\bwww\.[^\s<>"]{1,2000}/giu;
const PATH_URL =
  /(?<![\p{L}\p{N}@.-])(?:[\p{L}\p{N}-]{1,63}\.){1,5}\p{L}{2,24}\/[^\s<>"]{1,2000}/gu;
const TLDS =
  'com|org|net|io|co|dev|app|ai|edu|gov|info|biz|me|uk|de|fr|il|us|ca|au|nl|ru|xyz|tech|' +
  'ly|ee|site|page|in|to|gg|sh|tv|so|eu|ch|it|es|pl|se';
// Lowercase only: ASP.NET, VB.NET, ML.NET and System.IO are code, not hosts.
const BARE_HOST = new RegExp(
  `(?<![\\p{L}\\p{N}@.-])(?:[\\p{L}\\p{N}-]{1,63}\\.){1,5}(?:${TLDS})(?![\\p{L}\\p{N}-])`,
  'gu',
);
const HANDLE = /(?<![\p{L}\p{N}_@])@[A-Za-z0-9_]{3,32}(?![\p{L}\p{N}_])/gu;
const CSS_AT_RULES = new Set([
  'media',
  'import',
  'keyframes',
  'font-face',
  'supports',
  'charset',
  'page',
  'layer',
  'container',
  'namespace',
  'property',
]);
const PHONE = /(?<!\d)\+?\(?\d[\d \t().\/-]{7,40}\d/g;
const ISO_DATE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g;
const SLASH_DATE = /(?<!\d)\d{1,2}[./]\d{1,2}[./]\d{4}(?!\d)/g;
const MIN_PHONE_DIGITS = 9;
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const DECIMAL = /\p{Nd}/gu;
const DASHES = /[\p{Pd}−]/gu;

/** The value (0 to 9) of a non-ASCII decimal digit: its offset in its block of ten. */
function digitValue(ch: string): string {
  let cp = ch.codePointAt(0) as number;
  const previousIsDigit = (c: number): boolean => /\p{Nd}/u.test(String.fromCodePoint(c - 1));
  let offset = 0;
  while (previousIsDigit(cp)) {
    cp -= 1;
    offset += 1;
  }
  return String(offset % 10);
}

/** Unicode form used for all matching: see the header comment. */
export function normaliseForMatching(text: string): string {
  return text
    .replace(IGNORABLE, '')
    .normalize('NFKC')
    .replace(IGNORABLE, '')
    .replace(DECIMAL, (d) => (d >= '0' && d <= '9' ? d : digitValue(d)))
    .replace(DASHES, '-');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPhone(candidate: string): boolean {
  const withoutDates = candidate.replace(ISO_DATE, ' ').replace(SLASH_DATE, ' ');
  const digits = withoutDates.replace(/\D/g, '').length;
  if (digits < MIN_PHONE_DIGITS) return false;
  // Version numbers such as 10.2.3.4.5.6.7.8.9: dots between one or two digit groups, none of
  // which starts with 0 (06.12.34.56.78 is a phone number).
  const dotsOnly = !/[^\d.]/.test(candidate);
  const groups = candidate.split(/\D+/).filter(Boolean);
  const versionLike = dotsOnly && groups.every((g) => g.length <= 2 && !g.startsWith('0'));
  return !versionLike;
}

function isCodeHandle(match: string, offset: number, full: string): boolean {
  const name = match.slice(1).toLowerCase();
  if (CSS_AT_RULES.has(name)) return true;
  if (full[offset + match.length] === '(') return true;
  const before = full.slice(Math.max(0, offset - 80), offset);
  if (/\b(?:declare|set|select)\b[^;\n]*$/i.test(before)) return true;
  const ticks = full.slice(0, offset).split('`').length - 1;
  return ticks % 2 === 1;
}

function keptHandles(text: string): string[] {
  return [...text.matchAll(HANDLE)]
    .filter((m) => !isCodeHandle(m[0], m.index, text))
    .map((m) => m[0]);
}

function knownIdentifierPattern(ids: readonly string[]): RegExp | null {
  const clean = [
    ...new Set(ids.map((s) => normaliseForMatching(s).trim()).filter((s) => s.length > 0)),
  ];
  if (clean.length === 0) return null;
  clean.sort((a, b) => b.length - a.length);
  const alternation = clean.map(escapeRegExp).join('|');
  return new RegExp(`(?<![\\p{L}\\p{M}])(?:${alternation})(?![\\p{L}\\p{M}])`, 'giu');
}

function redactOnce(text: string, known: RegExp | null): RedactResult {
  let count = 0;
  const hit = (): string => {
    count += 1;
    return REDACTED;
  };
  let out = text;
  out = out.replace(EMAIL, hit);
  out = out.replace(URL_SCHEME, hit);
  out = out.replace(WWW, hit);
  out = out.replace(PATH_URL, hit);
  out = out.replace(BARE_HOST, hit);
  out = out.replace(HANDLE, (m, offset: number, full: string) =>
    isCodeHandle(m, offset, full) ? m : hit(),
  );
  if (known) out = out.replace(known, hit);
  out = out.replace(PHONE, (m) => (isPhone(m) ? hit() : m));
  return { text: out, count };
}

/**
 * Replaces emails, URLs, handles, phone numbers and the known identifiers with `[removed]`.
 * Runs up to three passes, because removing one span can expose another (`@ab4com@abi`).
 */
export function redactPii(text: string, options: RedactOptions = {}): RedactResult {
  const known = knownIdentifierPattern(options.knownIdentifiers ?? []);
  let current = normaliseForMatching(text);
  let total = 0;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const r = redactOnce(current, known);
    current = r.text;
    total += r.count;
    if (r.count === 0) break;
  }
  return { text: current, count: total };
}

function test(re: RegExp, text: string): boolean {
  return new RegExp(re.source, re.flags.replace('g', '')).test(text);
}

/** Which kinds of personal detail are still present in `text` (empty when it is clean). */
export function findPii(text: string, options: RedactOptions = {}): PiiKind[] {
  // Redacted spans are not leaks; replace them so the marker never matches and digits on
  // either side of one never join into a phone number.
  const probe = normaliseForMatching(text).split(REDACTED).join(SENTINEL);
  const kinds: PiiKind[] = [];
  if (test(EMAIL, probe)) kinds.push('email');
  if (
    test(URL_SCHEME, probe) ||
    test(WWW, probe) ||
    test(PATH_URL, probe) ||
    test(BARE_HOST, probe)
  ) {
    kinds.push('url');
  }
  if (keptHandles(probe).length > 0) kinds.push('handle');
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
 * The identifiers to hide for one user: the email, its local part (only when it is distinctive:
 * 5+ characters or containing a digit or punctuation), and each display-name token of three or
 * more letters.
 */
export function knownIdentifiersFor(user: {
  email?: string | null;
  displayName?: string | null;
}): string[] {
  const ids: string[] = [];
  const email = user.email?.trim();
  if (email) {
    ids.push(email);
    const local = normaliseForMatching(email.split('@')[0] as string);
    const distinctive = local.length >= 5 || /[^\p{L}\p{M}]/u.test(local);
    if (distinctive && local.length >= 3) ids.push(local);
  }
  for (const token of normaliseForMatching(user.displayName ?? '').split(/[^\p{L}\p{M}]+/u)) {
    if ([...token.replace(/\p{M}/gu, '')].length >= 3) ids.push(token);
  }
  return ids;
}
