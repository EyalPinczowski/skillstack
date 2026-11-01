/**
 * Practice feedback: the schema, the repair pipeline for model JSON, and the parser for the
 * pasted `===FEEDBACK===` block. Pure; the parse functions never throw.
 *
 * Free models often return broken JSON, and a practice is never lost because of it: whatever
 * cannot be repaired is returned as `freeText` so the caller can save it as-is.
 */
import { z } from 'zod';

export const MAX_STRENGTHS_LENGTH = 2000;
export const MAX_IMPROVE_LENGTH = 2000;
export const MAX_NEXT_FOCUS_LENGTH = 500;
/** The most raw text kept as free-text feedback. */
export const MAX_FREE_TEXT_LENGTH = 8000;
/** How many `{` positions are tried before giving up on a model answer. */
const MAX_OBJECT_ATTEMPTS = 8;
/** Longer input is cut before any scanning, so hostile text cannot cost more than this. */
export const MAX_PARSE_INPUT_LENGTH = 64 * 1024;

export const FeedbackSchema = z.object({
  score: z.number().min(0).max(10),
  strengths: z.string().trim().min(1).max(MAX_STRENGTHS_LENGTH),
  improve: z.string().trim().min(1).max(MAX_IMPROVE_LENGTH),
  next_focus: z.string().trim().min(1).max(MAX_NEXT_FOCUS_LENGTH),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export type FeedbackFlag = 'score_clamped' | 'text_truncated';

export type FeedbackParseResult =
  | {
      ok: true;
      feedback: Feedback;
      /** True when the text needed any repair beyond plain `JSON.parse` plus validation. */
      repaired: boolean;
      flags: FeedbackFlag[];
      raw: string;
    }
  | {
      ok: false;
      feedback: null;
      /** The raw text (trimmed and capped), to be saved as free-text feedback. */
      freeText: string;
      raw: string;
    };

// ---------------------------------------------------------------------------
// Shared coercion
// ---------------------------------------------------------------------------

const KEY_ALIASES: Record<string, keyof Feedback> = {
  score: 'score',
  strengths: 'strengths',
  strength: 'strengths',
  improve: 'improve',
  improvement: 'improve',
  improvements: 'improve',
  nextfocus: 'next_focus',
};

/** `next_focus`, `nextFocus`, `Next Focus` and `next-focus` all become `nextfocus`. */
function canonicalKey(key: string): keyof Feedback | undefined {
  const k = key.toLowerCase().replace(/[^a-z]/g, '');
  return Object.hasOwn(KEY_ALIASES, k) ? KEY_ALIASES[k] : undefined;
}

const SCORE_TEXT = /^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)|(%))?$/;

/** `"7"`, `"7/10"`, `"7 / 10"`, `"4/5"` and `"70%"` as a 0 to 10 number; null when unreadable. */
export function parseScoreText(text: string): number | null {
  const m = SCORE_TEXT.exec(text.trim());
  if (!m) return null;
  const value = Number(m[1]);
  if (m[3]) return value / 10;
  if (m[2] !== undefined) {
    const max = Number(m[2]);
    return max === 0 ? null : (value * 10) / max;
  }
  return value;
}

function asScore(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return parseScoreText(value);
  return null;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
      .map((v) => String(v).trim())
      .filter((s) => s.length > 0);
    return parts.length > 0 ? parts.join('; ') : null;
  }
  return null;
}

function capped(text: string, max: number, flags: FeedbackFlag[]): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (!flags.includes('text_truncated')) flags.push('text_truncated');
  return trimmed.slice(0, max).trim();
}

/** Maps key aliases, coerces values, clamps and caps, then validates. Null when unusable. */
function coerceFeedback(
  source: Record<string, unknown>,
): { feedback: Feedback; flags: FeedbackFlag[] } | null {
  const picked: Partial<Record<keyof Feedback, unknown>> = {};
  for (const [key, value] of Object.entries(source)) {
    const canonical = canonicalKey(key);
    if (canonical && !(canonical in picked)) picked[canonical] = value;
  }
  const flags: FeedbackFlag[] = [];
  let score = asScore(picked.score);
  if (score !== null && (score < 0 || score > 10)) {
    score = Math.min(10, Math.max(0, score));
    flags.push('score_clamped');
  }
  const strengths = asText(picked.strengths);
  const improve = asText(picked.improve);
  const nextFocus = asText(picked.next_focus);
  if (score === null || strengths === null || improve === null || nextFocus === null) return null;
  const parsed = FeedbackSchema.safeParse({
    score: Math.round(score * 10) / 10,
    strengths: capped(strengths, MAX_STRENGTHS_LENGTH, flags),
    improve: capped(improve, MAX_IMPROVE_LENGTH, flags),
    next_focus: capped(nextFocus, MAX_NEXT_FOCUS_LENGTH, flags),
  });
  return parsed.success ? { feedback: parsed.data, flags } : null;
}

function freeTextResult(raw: string): FeedbackParseResult {
  return { ok: false, feedback: null, freeText: raw.trim().slice(0, MAX_FREE_TEXT_LENGTH), raw };
}

// ---------------------------------------------------------------------------
// Model JSON: extract the first object and rewrite it into valid JSON
// ---------------------------------------------------------------------------

const SMART_QUOTES: Record<string, string> = {
  '“': '"',
  '”': '"',
  '„': '"',
  '‘': "'",
  '’': "'",
};
const FRACTION_OR_PERCENT = /-?\d+(?:\.\d+)?\s*(?:\/\s*\d+(?:\.\d+)?|%)/y;
const DIGIT_RUN = /\d+/y;
const BARE_WORD = /[A-Za-z_$][\w$-]*/y;
const ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '', '\t': '\\t' };

function nextNonSpace(src: string, from: number): string {
  let i = from;
  while (i < src.length && /\s/.test(src[i] as string)) i += 1;
  return src[i] ?? '';
}

/**
 * Reads the object that starts at `start` and returns it as strict JSON text, or null when it
 * never closes. Fixes on the way: single quotes, smart quotes, bare keys, trailing commas, raw
 * newlines inside strings, unescaped inner quotes, and `7/10` or `70%` written without quotes.
 */
function objectToJson(src: string, start: number): string | null {
  let out = '';
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let body = '';
      i += 1;
      // A quote closes the string only when the next significant character ends a value.
      while (i < src.length) {
        const c = src[i] as string;
        if (c === '\\' && i + 1 < src.length) {
          const next = src[i + 1] as string;
          body += next === "'" ? "'" : c + next;
          i += 2;
          continue;
        }
        if (c === quote && (i + 1 >= src.length || ',}]:'.includes(nextNonSpace(src, i + 1)))) {
          break;
        }
        body += c === '"' ? '\\"' : (ESCAPES[c] ?? c);
        i += 1;
      }
      out += `"${body}"`;
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return out + ch;
    }
    if (ch === ',' && '}]'.includes(nextNonSpace(src, i + 1))) {
      i += 1;
      continue;
    }
    FRACTION_OR_PERCENT.lastIndex = i;
    const fraction = FRACTION_OR_PERCENT.exec(src);
    if (fraction) {
      out += JSON.stringify(fraction[0]);
      i += fraction[0].length;
      continue;
    }
    // A digit run that is not a fraction or percent is copied whole, so a long run is scanned once.
    DIGIT_RUN.lastIndex = i;
    const digits = DIGIT_RUN.exec(src);
    if (digits) {
      out += digits[0];
      i += digits[0].length;
      continue;
    }
    BARE_WORD.lastIndex = i;
    const word = BARE_WORD.exec(src);
    if (word) {
      out += nextNonSpace(src, i + word[0].length) === ':' ? JSON.stringify(word[0]) : word[0];
      i += word[0].length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return null;
}

function replaceSmartQuotes(text: string): string {
  return text.replace(/[“”„‘’]/g, (c) => SMART_QUOTES[c] as string);
}

/**
 * Parses the JSON a model returned for the end of a practice.
 *
 * Repair steps, in order, stopping at the first valid result: plain `JSON.parse` plus the
 * schema; then take the first balanced `{...}` (this drops code fences and prose around it)
 * and rewrite it into strict JSON; then coerce the values (`"7/10"`, `70%`, arrays, key
 * aliases, clamping) and validate. When nothing works the raw text comes back as `freeText`.
 */
export function parseModelFeedback(text: string): FeedbackParseResult {
  const raw = text;
  const input = text.slice(0, MAX_PARSE_INPUT_LENGTH);
  try {
    const direct = FeedbackSchema.safeParse(JSON.parse(input.trim()));
    if (direct.success) return { ok: true, feedback: direct.data, repaired: false, flags: [], raw };
  } catch {
    // Not plain JSON; fall through to the repair path.
  }
  const src = replaceSmartQuotes(input);
  let from = src.indexOf('{');
  for (let attempt = 0; attempt < MAX_OBJECT_ATTEMPTS && from !== -1; attempt += 1) {
    const json = objectToJson(src, from);
    if (json !== null) {
      try {
        // `json` always starts with `{`, so a successful parse is an object.
        const coerced = coerceFeedback(JSON.parse(json) as Record<string, unknown>);
        if (coerced) {
          return {
            ok: true,
            feedback: coerced.feedback,
            repaired: true,
            flags: coerced.flags,
            raw,
          };
        }
      } catch {
        // This object is not repairable; try the next `{`.
      }
    }
    from = src.indexOf('{', from + 1);
  }
  return freeTextResult(raw);
}

// ---------------------------------------------------------------------------
// The pasted ===FEEDBACK=== block
// ---------------------------------------------------------------------------

const MIN_MARKER_EQUALS = 3;

/** ASCII-only lowercase: never changes the length, so indexes stay valid. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/**
 * Finds `===word===` (3 or more equals signs on each side, spaces and tabs allowed around the
 * word) at or after `from`. Linear: it looks for the word and walks outwards from each hit.
 * Returns the span of the whole marker. With `last`, the last marker wins instead of the first.
 */
function findMarker(
  lower: string,
  word: string,
  from: number,
  last: boolean,
): { start: number; end: number } | null {
  let found: { start: number; end: number } | null = null;
  let at = lower.indexOf(word, from);
  while (at !== -1) {
    let left = at;
    while (left > from && (lower[left - 1] === ' ' || lower[left - 1] === '\t')) left -= 1;
    const equalsEnd = left;
    while (left > from && lower[left - 1] === '=') left -= 1;
    let right = at + word.length;
    while (right < lower.length && (lower[right] === ' ' || lower[right] === '\t')) right += 1;
    const equalsStart = right;
    while (right < lower.length && lower[right] === '=') right += 1;
    if (equalsEnd - left >= MIN_MARKER_EQUALS && right - equalsStart >= MIN_MARKER_EQUALS) {
      found = { start: left, end: right };
      if (!last) return found;
    }
    at = lower.indexOf(word, at + word.length);
  }
  return found;
}

const KEY_LINE = /^[ \t]*([A-Za-z][A-Za-z _-]{1,19}?)[ \t]*:[ \t]*(.*)$/;
const BULLET = /^[-*•][ \t]+/;

/**
 * Parses the fixed block a chat assistant writes at the end of a practice. Tolerant of case,
 * extra whitespace, a missing end marker, `score: 7 / 10` and CRLF line ends. When several
 * blocks are present the last one wins (an assistant may echo the template first).
 */
export function parseFeedbackBlock(text: string): FeedbackParseResult {
  const raw = text;
  const norm = text.slice(0, MAX_PARSE_INPUT_LENGTH).replace(/\r\n?/g, '\n');
  const start = findMarker(asciiLower(norm), 'feedback', 0, true);
  if (!start) return freeTextResult(raw);
  let body = norm.slice(start.end);
  const end = findMarker(asciiLower(body), 'end', 0, false);
  if (end) body = body.slice(0, end.start);

  const fields: Partial<Record<keyof Feedback, string[]>> = {};
  let current: keyof Feedback | undefined;
  for (const line of body.split('\n')) {
    const m = KEY_LINE.exec(line);
    const key = m ? canonicalKey(m[1] as string) : undefined;
    if (key) {
      current = key;
      fields[key] = [(m as RegExpExecArray)[2] as string];
    } else if (current && line.trim().length > 0) {
      (fields[current] as string[]).push(line.trim().replace(BULLET, ''));
    }
  }
  const joined: Record<string, string> = {};
  for (const [key, parts] of Object.entries(fields)) {
    joined[key] = parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join('; ');
  }
  const coerced = coerceFeedback(joined);
  if (!coerced) return freeTextResult(raw);
  return { ok: true, feedback: coerced.feedback, repaired: false, flags: coerced.flags, raw };
}
