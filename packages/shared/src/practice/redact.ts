/**
 * Personal-detail redaction for anything that may reach an AI model.
 *
 * Pure and deterministic, no I/O. Every pattern is linear-time: quantifiers are bounded and
 * no group is repeated inside another repeated group, so there is no catastrophic backtracking.
 *
 * Matching runs on a normalised copy of the text: NFKC (except superscripts, subscripts,
 * fractions and circled digits, which stay as they are), every default-ignorable code point and
 * combining mark removed, non-ASCII decimal digits mapped to ASCII, dash punctuation mapped to
 * '-', and blank or space-like characters mapped to a space. Found spans are mapped back by
 * position and replaced in the ORIGINAL text, so everything outside a removed span is sent
 * unchanged (`10⁹`, `E=mc²`, `½`, Persian ZWNJ, emoji joiners, niqqud).
 *
 * Detection rules:
 * - emails, `scheme://` URLs, `www.` hosts, and any `host.tld/path` with a 2 to 24 letter TLD;
 * - bare hosts without a path only for an allowlist of lowercase TLDs (so ASP.NET, VB.NET and
 *   System.IO survive, and `LinkedIn.COM` without a path does not match);
 * - `@handles` of 3 to 32 characters, except code: a handle followed by `(`, `.x` or `/x`
 *   (`@app.route`, `@angular/core`), CSS at-rules, a decorator at the start of a line before
 *   def/class/function/public..., T-SQL variables right after DECLARE/SET/SELECT/EXEC or after
 *   `=`, `<`, `>`, `,` or `(` on a line with a SQL keyword, and anything inside backticks;
 * - digit runs of 9 or more with separators (space, dot, dash, slash, parentheses, `_`, `~`,
 *   middle dots, fraction slash, and a comma directly between digits);
 * - the user's known identifiers, matched as whole words (letters on both sides, marks ignored).
 *
 * Limits (also stated in the privacy page):
 * - names the app does not know (a recruiter in a job description, a friend in a chat turn)
 *   cannot be detected;
 * - obfuscated details are not detected: "name at example dot com", digits spelled as words,
 *   HTML entities, percent-encoding, `git@github.com:user/repo`, a number split by a newline;
 * - homoglyphs (a Cyrillic letter inside "Eyal") and accent-folded names do not match;
 * - false positives are accepted: runs of 9+ digits in a number list ("10 20 30 40 50"), long
 *   numbers with thousands separators, `snake_case_ids_123_456_789`, every occurrence of a user
 *   name that is also an ordinary word, and a real handle on a line that looks like SQL.
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

/** Redaction repeats because removing one span can expose another (`@abc@abc@abc`). */
export const MAX_PASSES = 5;
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
const PHONE = /(?<!\d)\+?\(?\d(?:[\d \t()./_~·•⁄-]|(?<=\d),(?=\d)){7,40}\d/g;
const ISO_DATE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g;
const SLASH_DATE = /(?<!\d)\d{1,2}[./]\d{1,2}[./]\d{4}(?!\d)/g;
const MIN_PHONE_DIGITS = 9;

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const MARKS = /\p{M}/gu;
const DECIMAL = /\p{Nd}/gu;
const DASHES = /[\p{Pd}−]/gu;
const SPACES = /[⠀\p{Zs}]/gu;
/** A base character and the combining marks after it (or a run of stray marks). */
const CHUNK = /[^\p{M}]\p{M}*|\p{M}+/uy;
/** Compatibility characters whose meaning NFKC would change: kept as they are. */
const KEEP_AS_IS = /^[²³¹¼-¾⁰-₟⅐-↏①-⓿❶-➓㈠-㈩㉀-㊿]/u;

/** The value (0 to 9) of a non-ASCII decimal digit: its offset in its block of ten. */
function digitValue(ch: string): string {
  let cp = ch.codePointAt(0) as number;
  let offset = 0;
  while (/\p{Nd}/u.test(String.fromCodePoint(cp - 1))) {
    cp -= 1;
    offset += 1;
  }
  return String(offset % 10);
}

const chunkCache = new Map<string, string>();

function normaliseChunk(chunk: string): string {
  const cached = chunkCache.get(chunk);
  if (cached !== undefined) return cached;
  const base = KEEP_AS_IS.test(chunk) ? chunk : chunk.normalize('NFKC');
  const out = base
    .replace(IGNORABLE, '')
    .replace(MARKS, '')
    .replace(DECIMAL, (d) => (d >= '0' && d <= '9' ? d : digitValue(d)))
    .replace(DASHES, '-')
    .replace(SPACES, ' ');
  if (chunkCache.size > 5000) chunkCache.clear();
  chunkCache.set(chunk, out);
  return out;
}

interface Normalised {
  text: string;
  /** For each UTF-16 unit of `text`, where its source starts and ends in the original. */
  from: number[];
  to: number[];
}

function normaliseWithMap(original: string): Normalised {
  const parts: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  const n = original.length;
  let i = 0;
  while (i < n) {
    const code = original.charCodeAt(i);
    // ASCII not followed by a combining mark (all marks are U+0300 or above): no work needed.
    if (code < 0x80 && (i + 1 >= n || original.charCodeAt(i + 1) < 0x300)) {
      parts.push(original[i] as string);
      from.push(i);
      to.push(i + 1);
      i += 1;
      continue;
    }
    CHUNK.lastIndex = i;
    const chunk = (CHUNK.exec(original) as RegExpExecArray)[0];
    const out = normaliseChunk(chunk);
    parts.push(out);
    for (let k = 0; k < out.length; k += 1) {
      from.push(i);
      to.push(i + chunk.length);
    }
    i += chunk.length;
  }
  return { text: parts.join(''), from, to };
}

/** Text as it is compared: see the header comment. */
export function normaliseForMatching(text: string): string {
  return normaliseWithMap(text).text;
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

const DECORATED =
  /^\s*(?:def|class|function|public|private|protected|static|async|export|final|abstract|override)\b/i;
const SQL_WORD =
  /\b(?:select|where|from|insert|update|delete|exec|execute|declare|join|having|values)\b/i;

function backticksBefore(ticks: readonly number[], offset: number): number {
  let lo = 0;
  let hi = ticks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((ticks[mid] as number) < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function backtickPositions(text: string): number[] {
  const ticks: number[] = [];
  for (let i = text.indexOf('`'); i !== -1; i = text.indexOf('`', i + 1)) ticks.push(i);
  return ticks;
}

/** Code that merely looks like a handle. Looks at a bounded window, never the whole text. */
function isCodeHandle(
  match: string,
  offset: number,
  full: string,
  ticks: readonly number[],
): boolean {
  if (CSS_AT_RULES.has(match.slice(1).toLowerCase())) return true;
  const end = offset + match.length;
  if (full[end] === '(') return true;
  if ((full[end] === '.' || full[end] === '/') && /[A-Za-z0-9_]/.test(full[end + 1] ?? '')) {
    return true;
  }
  if (backticksBefore(ticks, offset) % 2 === 1) return true;
  const windowStart = Math.max(0, offset - 200);
  const seg = full.slice(windowStart, offset);
  const newline = seg.lastIndexOf('\n');
  const linePrefix = newline >= 0 ? seg.slice(newline + 1) : windowStart === 0 ? seg : 'x';
  if (linePrefix.trim() === '' && DECORATED.test(full.slice(end, end + 80))) return true;
  const before = seg.slice(-120);
  if (/\b(?:declare|set|select|exec|execute)\s+$/i.test(before.slice(-12))) return true;
  return SQL_WORD.test(before) && /[=<>,(]\s*$/.test(before);
}

function handleSpans(text: string): [number, number][] {
  const ticks = backtickPositions(text);
  const spans: [number, number][] = [];
  for (const m of text.matchAll(HANDLE)) {
    if (!isCodeHandle(m[0], m.index, text, ticks)) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

function knownIdentifierPattern(ids: readonly string[]): RegExp | null {
  const clean = [
    ...new Set(ids.map((s) => normaliseForMatching(s).trim()).filter((s) => s.length > 0)),
  ];
  if (clean.length === 0) return null;
  clean.sort((a, b) => b.length - a.length);
  const alternation = clean.map(escapeRegExp).join('|');
  return new RegExp(`(?<![\\p{L}])(?:${alternation})(?![\\p{L}])`, 'giu');
}

function spansOf(text: string, re: RegExp): [number, number][] {
  return [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
}

/** Every span to remove from the normalised text. */
function findSpans(text: string, known: RegExp | null): [number, number][] {
  const spans = [
    ...spansOf(text, EMAIL),
    ...spansOf(text, URL_SCHEME),
    ...spansOf(text, WWW),
    ...spansOf(text, PATH_URL),
    ...spansOf(text, BARE_HOST),
    ...handleSpans(text),
    ...(known ? spansOf(text, known) : []),
    ...[...text.matchAll(PHONE)]
      .filter((m) => isPhone(m[0]))
      .map((m): [number, number] => [m.index, m.index + m[0].length]),
  ];
  return spans;
}

function redactOnce(original: string, known: RegExp | null): RedactResult {
  const norm = normaliseWithMap(original);
  const spans = findSpans(norm.text, known)
    .map(([s, e]): [number, number] => [norm.from[s] as number, norm.to[e - 1] as number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s < last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let out = '';
  let at = 0;
  for (const [s, e] of merged) {
    out += original.slice(at, s) + REDACTED;
    at = e;
  }
  return { text: out + original.slice(at), count: merged.length };
}

/**
 * Replaces emails, URLs, handles, phone numbers and the known identifiers with `[removed]`.
 * Only the matched spans change; the rest of the text is returned exactly as given.
 */
export function redactPii(text: string, options: RedactOptions = {}): RedactResult {
  const known = knownIdentifierPattern(options.knownIdentifiers ?? []);
  let current = text;
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
  if (handleSpans(probe).length > 0) kinds.push('handle');
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
    const distinctive = local.length >= 5 || /\P{L}/u.test(local);
    if (distinctive && local.length >= 3) ids.push(local);
  }
  for (const token of normaliseForMatching(user.displayName ?? '').split(/\P{L}+/u)) {
    if ([...token].length >= 3) ids.push(token);
  }
  return ids;
}
