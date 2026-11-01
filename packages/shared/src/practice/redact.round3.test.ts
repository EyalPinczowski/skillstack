import { describe, expect, it } from 'vitest';
import { MAX_USER_TEXT_LENGTH, neutraliseMarkup, sanitizeUserText } from './prompt';
import { REDACTED, findPii, knownIdentifiersFor, redactPii } from './redact';

describe('enclosed letters are folded, enclosed digits are kept (3)', () => {
  it('finds an email written in circled letters', () => {
    const r = redactPii('mail ⓙⓞⓗⓝ@gmail.com now');
    expect(r.text).toBe(`mail ${REDACTED} now`);
    expect(findPii('ⓙⓞⓗⓝ@gmail.com')).toEqual(['email']);
  });
  it('finds a name written in circled capitals', () => {
    const ids = { knownIdentifiers: ['Eyal'] };
    expect(redactPii('⒠ⓎⒶⓁ here'.replace('⒠', 'Ⓔ'), ids).count).toBe(1);
    expect(findPii('ⒺⓎⒶⓁ here', ids)).toEqual(['identifier']);
  });
  it('keeps circled digits as they are', () => {
    const t = 'steps ①②③ and ⓪';
    expect(redactPii(t)).toEqual({ text: t, count: 0 });
  });
});

describe('the chat path neutralises markup like the prompt builder (4)', () => {
  it('does not join a name split by tags', () => {
    const r = sanitizeUserText('Hi Ey<task>al Pin</task>to', {
      knownIdentifiers: ['Eyal', 'Pinto'],
    });
    expect(r.text).toBe('Hi Ey al Pin to');
    expect(sanitizeUserText('Ey<b>al', { knownIdentifiers: ['Eyal'] }).text).toBe('Ey al');
  });
  it('folds fullwidth and small angle brackets', () => {
    expect(neutraliseMarkup('＜task＞x＜/task＞')).toBe(' x ');
    expect(neutraliseMarkup('﹤task﹥x﹤/task﹥')).toBe(' x ');
  });
});

describe('joined display-name tokens are known identifiers', () => {
  it('EyalPinto, Eyal.Pinto and Eyal_Pinto', () => {
    const ids = knownIdentifiersFor({ displayName: 'Eyal Pinto' });
    for (const joined of ['EyalPinto', 'eyal.pinto', 'Eyal_Pinto']) {
      expect(redactPii(`by ${joined} today`, { knownIdentifiers: ids }).text).toBe(
        `by ${REDACTED} today`,
      );
    }
  });
});

describe('any short run of symbols can join digit groups', () => {
  it.each([
    ['dot operator', '054∙123∙4567'],
    ['asterisk', '054*123*4567'],
    ['colon', '054:123:4567'],
    ['pipe', '054|123|4567'],
    ['katakana middle dot', '054・123・4567'],
    ['comma and space', '054, 123, 4567'],
    ['line separator', '054 123 4567'],
    ['wide joiners', '054 ∙ 123 * 4567'],
  ])('%s', (_n, phone) => {
    expect(redactPii(`call ${phone} now`).text).toBe(`call ${REDACTED} now`);
    expect(findPii(`call ${phone} now`)).toEqual(['phone']);
  });
  it('needs 9 digits, groups of two or more, and no newline', () => {
    for (const t of ['10, 20, 30', '054\n123\n4567', 'a 12:30 or 14:45']) {
      expect(redactPii(t).count, t).toBe(0);
    }
  });
});

describe('truncation happens at a boundary, so a cut address cannot survive (3)', () => {
  it('drops an email that straddles the limit', () => {
    const text = `${'w '.repeat((MAX_USER_TEXT_LENGTH - 6) / 2)}jane@example.com after`;
    const r = sanitizeUserText(text);
    expect(r.truncated).toBe(true);
    expect(r.text).not.toContain('jane');
    expect(r.text).not.toContain('example');
    expect(r.text.length).toBeLessThanOrEqual(MAX_USER_TEXT_LENGTH);
  });
  it('cuts a long token to the limit', () => {
    const r = sanitizeUserText('a'.repeat(MAX_USER_TEXT_LENGTH + 100));
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(MAX_USER_TEXT_LENGTH);
  });
  it('never splits a surrogate pair', () => {
    const r = sanitizeUserText('\u{1F600}'.repeat(MAX_USER_TEXT_LENGTH));
    expect(r.text.length).toBe(MAX_USER_TEXT_LENGTH);
    expect(r.text).not.toMatch(/[\uD800-\uDBFF]$/);
    const odd = sanitizeUserText('a' + '\u{1F600}'.repeat(MAX_USER_TEXT_LENGTH));
    expect(odd.text.length).toBe(MAX_USER_TEXT_LENGTH - 1);
  });
  it('drops a phone number that straddles the limit', () => {
    const text = `${'w '.repeat((MAX_USER_TEXT_LENGTH - 6) / 2)}0501234567 after`;
    expect(sanitizeUserText(text).text).not.toMatch(/\d{3}/);
  });
  it('drops a host that straddles the limit', () => {
    const text = `${'w '.repeat((MAX_USER_TEXT_LENGTH - 6) / 2)}janedoe.com after`;
    expect(sanitizeUserText(text).text).not.toContain('janedoe');
  });
});

describe('hosts (round 3)', () => {
  it.each([
    ['a long host', 'see a.b.c.d.e.f.g.example.com now'],
    ['a long host with a path', 'see a.b.c.d.e.f.g.h.example.org/x now'],
    ['scheme glued to a word', 'xhttps://evil.example/x now'],
    ['ideographic full stop', 'see jane。me now'],
    ['fullwidth full stop', 'see jane．com now'],
    ['uppercase allowlisted tld', 'see Jane.ME now'],
    ['an unlisted lowercase tld', 'see host.example now'],
  ])('%s', (_n, text) => {
    const r = redactPii(text);
    expect(r.count).toBe(1);
    const expected = text.startsWith('xhttps')
      ? `x${REDACTED} now`
      : text.replace(/\S+(?= now$)/, REDACTED);
    expect(r.text).toBe(expected);
  });
  it('file names and mixed-case code tokens survive', () => {
    for (const t of [
      'notes.txt',
      'main.py',
      'app.test.ts',
      'Console.WriteLine',
      'Math.PI',
      'Node.js',
    ]) {
      expect(redactPii(`open ${t} now`).count, t).toBe(0);
    }
  });
});
