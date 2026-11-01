import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PiiLeakError,
  REDACTED,
  assertNoPii,
  findPii,
  knownIdentifiersFor,
  redactPii,
} from './redact';

describe('redactPii: what is removed', () => {
  const cases: [string, string][] = [
    ['email', 'write to jane.doe+work@example.co.il please'],
    ['https url', 'see https://linkedin.com/in/jane-doe-123?x=1 now'],
    ['ftp url', 'get ftp://files.example.org/a.zip today'],
    ['www host', 'my site is www.janedoe.dev/portfolio ok'],
    ['bare domain', 'profile at github.com/janedoe is public'],
    ['handle', 'ping me @jane_doe99 on chat'],
    ['intl phone', 'call +972 50-123-4567 tomorrow'],
    ['local phone', 'call 050-123-4567 tomorrow'],
    ['us phone', 'call (555) 123-4567 tomorrow'],
    ['dotted phone', 'call 555.123.4567 tomorrow'],
    ['plain digit run', 'my number is 0501234567'],
    ['unicode email', 'mail josé@exämple.com now'],
  ];
  it.each(cases)('%s', (_name, text) => {
    const r = redactPii(text);
    expect(r.count).toBeGreaterThan(0);
    expect(r.text).toContain(REDACTED);
    expect(findPii(r.text)).toEqual([]);
  });

  it('keeps the text around a removed span', () => {
    expect(redactPii('mail a@b.com now').text).toBe(`mail ${REDACTED} now`);
  });

  it('sees through zero-width characters and compatibility forms', () => {
    const r = redactPii('mail ja\u200Bne@exam\u200Cple.com or ｊａｎｅ@example.com');
    expect(r.count).toBe(2);
    expect(r.text).not.toContain('@');
  });
});

describe('redactPii: no false positives', () => {
  const clean = [
    'PL-300',
    'SQL 2019',
    '3.5 hours',
    'Finish by 2026-11-01 and review on 2026-11-08',
    'Plan: 2026-11-01 - 2026-11-30',
    'on 01/02/2026 we met',
    'Version 10.2.3.4.5.6.7.8.9 of the tool',
    'Score 7/10, 70% done, 1,000 requests',
    'Node.js and e.g. i.e. U.S. a.m.',
    'Use VLOOKUP, XLOOKUP and a pivot table.',
    'Section 3.3 and step 4.',
    'Call at 10:00-11:30',
  ];
  it.each(clean)('%s', (text) => {
    const r = redactPii(text);
    expect(r.text).toBe(text);
    expect(r.count).toBe(0);
  });
});

describe('redactPii: known identifiers', () => {
  const ids = ['Jane', 'jane.doe@example.com', 'janedoe'];
  it('removes names and the local part on word boundaries, case-insensitively', () => {
    const r = redactPii('JANE said janedoe is fine; Janet is not Jane.', { knownIdentifiers: ids });
    expect(r.text).toBe(`${REDACTED} said ${REDACTED} is fine; Janet is not ${REDACTED}.`);
    expect(r.count).toBe(3);
  });
  it('escapes regex characters in identifiers', () => {
    const r = redactPii('who is a+b? (x)', { knownIdentifiers: ['a+b', '(x)'] });
    expect(r.text).toBe(`who is ${REDACTED}? ${REDACTED}`);
    expect(redactPii('aab', { knownIdentifiers: ['a+b'] }).count).toBe(0);
  });
  it('ignores empty identifiers', () => {
    const r = redactPii('hello', { knownIdentifiers: ['', '  '] });
    expect(r).toEqual({ text: 'hello', count: 0 });
  });
  it('works on non-latin names', () => {
    const r = redactPii('שלום דנה, מה שלומך', { knownIdentifiers: ['דנה'] });
    expect(r.text).toBe(`שלום ${REDACTED}, מה שלומך`);
  });
  it('is idempotent', () => {
    const once = redactPii('jane at jane@x.com', { knownIdentifiers: ids });
    expect(redactPii(once.text, { knownIdentifiers: ids }).count).toBe(0);
  });
});

describe('knownIdentifiersFor', () => {
  it('uses the email, its local part and each name token of 3+ letters', () => {
    expect(
      knownIdentifiersFor({ email: ' jane.doe@example.com ', displayName: 'Jane Q. Doe-Smith' }),
    ).toEqual(['jane.doe@example.com', 'jane.doe', 'Jane', 'Doe', 'Smith']);
  });
  it('skips a short local part and empty inputs', () => {
    expect(knownIdentifiersFor({ email: 'ab@x.io' })).toEqual(['ab@x.io']);
    expect(knownIdentifiersFor({ email: '', displayName: null })).toEqual([]);
    expect(knownIdentifiersFor({})).toEqual([]);
  });
});

describe('findPii and assertNoPii', () => {
  it('reports each kind', () => {
    expect(findPii('a@b.com')).toEqual(['email']);
    expect(findPii('https://x.org')).toEqual(['url']);
    expect(findPii('@someone')).toEqual(['handle']);
    expect(findPii('0501234567')).toEqual(['phone']);
    expect(findPii('hi Jane', { knownIdentifiers: ['Jane'] })).toEqual(['identifier']);
  });
  it('treats the redaction marker as clean even for a user called "removed"', () => {
    expect(findPii(REDACTED, { knownIdentifiers: ['removed'] })).toEqual([]);
  });
  it('throws PiiLeakError with the kinds, and passes clean text', () => {
    expect(() => assertNoPii('mail a@b.com or 0501234567')).toThrow(PiiLeakError);
    try {
      assertNoPii('mail a@b.com or 0501234567');
    } catch (e) {
      expect((e as PiiLeakError).kinds).toEqual(['email', 'phone']);
      expect((e as PiiLeakError).name).toBe('PiiLeakError');
    }
    expect(() => assertNoPii('Practice SQL for 45 minutes')).not.toThrow();
  });
});

describe('redactPii: properties', () => {
  const word = fc.stringMatching(/^[a-z]{1,8}$/);
  const filler = fc.stringMatching(/^[a-zA-Z ,.!?]{0,30}$/);
  const email = fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9._]{2,10}$/),
      fc.stringMatching(/^[a-z]{2,8}$/),
      fc.constantFrom('com', 'org', 'io', 'co.uk'),
    )
    .map(([l, d, t]) => `${l}@${d}.${t}`);
  const url = fc
    .tuple(
      fc.constantFrom('https://', 'http://', 'www.'),
      word,
      fc.constantFrom('.com', '.org', '.io'),
      fc.stringMatching(/^(\/[a-z0-9]{1,6}){0,3}$/),
    )
    .map(([s, h, t, p]) => `${s}${h}${t}${p}`);
  const phone = fc
    .tuple(
      fc.constantFrom('', '+972 ', '+1 ', '(555) '),
      fc.stringMatching(/^[1-9][0-9]{2}$/),
      fc.constantFrom('-', ' ', '.'),
      fc.stringMatching(/^[0-9]{3}$/),
      fc.constantFrom('-', ' ', '.'),
      fc.stringMatching(/^[0-9]{4}$/),
    )
    .map(([cc, a, s1, b, s2, c]) => `${cc}${a}${s1}${b}${s2}${c}`);
  const name = fc.stringMatching(/^[A-Z][a-z]{3,9}$/).filter((n) => !/^(and|the)$/i.test(n));

  it('always removes generated emails, urls and phones from random positions', () => {
    fc.assert(
      fc.property(filler, fc.oneof(email, url, phone), filler, (before, pii, after) => {
        const r = redactPii(`${before} ${pii} ${after}`);
        expect(r.count).toBeGreaterThan(0);
        expect(r.text).not.toContain(pii);
        expect(findPii(r.text)).toEqual([]);
      }),
    );
  });

  it('always removes a known name wherever it sits, in any case', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('hello', 'there', 'and'), { maxLength: 4 }),
        name,
        fc.constantFrom('lower', 'upper', 'same'),
        (words, n, mode) => {
          const shown = mode === 'lower' ? n.toLowerCase() : mode === 'upper' ? n.toUpperCase() : n;
          const text = [...words, shown, ...words].join(' ');
          const r = redactPii(text, { knownIdentifiers: [n] });
          expect(r.text.toLowerCase()).not.toContain(n.toLowerCase());
        },
      ),
    );
  });

  it('terminates quickly on hostile input', () => {
    const hostile = [
      'a'.repeat(50_000),
      '1 '.repeat(25_000),
      '.'.repeat(50_000),
      'a@'.repeat(25_000),
      'a.'.repeat(25_000),
      '-'.repeat(50_000),
      'http://' + 'a'.repeat(50_000),
    ];
    const started = Date.now();
    for (const h of hostile) {
      redactPii(h, { knownIdentifiers: ['Jane'] });
      findPii(h);
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
