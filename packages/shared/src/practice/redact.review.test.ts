import { describe, expect, it } from 'vitest';
import { MAX_PASSES, REDACTED, findPii, knownIdentifiersFor, redactPii } from './redact';

const timed = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe('the text outside a removed span is sent unchanged (5)', () => {
  const keep = [
    '10⁹ ops',
    'E=mc² and H₂O',
    '½ cup and 3¾',
    'می‌خواهم',
    'family \u{1F468}‍\u{1F469}‍\u{1F467} here',
    'מקף־x and wave〜wave',
    'steps ①②③④⑤⑥⑦⑧⑨⑩',
    'big 1⁰⁰⁰⁰⁰⁰⁰⁰⁰ number',
    'דָּנָה says shalom',
    'dash – and — stay',
  ];
  it.each(keep)('%s', (text) => {
    expect(redactPii(text)).toEqual({ text, count: 0 });
    expect(findPii(text)).toEqual([]);
  });
  it('still removes personal details next to those characters, and only those', () => {
    const r = redactPii('E=mc² mail a@b.com ½ call ٠٥٠-١٢٣-٤٥٦٧ – ok');
    expect(r.text).toBe(`E=mc² mail ${REDACTED} ½ call ${REDACTED} – ok`);
  });
  it('removes a name written with a joiner inside, leaving the rest of the text alone', () => {
    const r = redactPii('Ey‍al ½', { knownIdentifiers: ['Eyal'] });
    expect(r.text).toBe(`${REDACTED} ½`);
  });
});

describe('code is not redacted, real handles are (6)', () => {
  const code = [
    '@dataclass\nclass Point:\n    x: int',
    'intro line\n@dataclass\nclass Later: pass',
    '@Override\npublic void run() {}',
    '  @staticmethod\n  def f(): pass',
    '@app.route("/")',
    "import x from '@angular/core'",
    'npm i @types/node',
    'SELECT * FROM users WHERE id = @UserId',
    'SELECT * FROM t WHERE a = @First AND b IN (@Second, @Third)',
    'EXEC @result = proc',
  ];
  it.each(code)('%j', (text) => {
    expect(redactPii(text).count).toBe(0);
    expect(findPii(text)).toEqual([]);
  });
  const real = [
    'thanks @eyalcohen for the help',
    '@eyalcohen is the owner',
    'ping @jane.',
    'ping @jane, thanks',
    'hi, @jane_doe',
    'cc @eyalcohen\nclass starts at nine',
    'please set up a call with @eyalcohen',
  ];
  it.each(real)('%j', (text) => {
    expect(redactPii(text).count).toBe(1);
    expect(findPii(text)).toEqual(['handle']);
  });
});

describe('phone separators (7)', () => {
  it.each([
    ['middle dot', '054·123·1234'],
    ['bullet', '054•123•1234'],
    ['braille blank', '054⠀123⠀1234'],
    ['underscore', '054_123_1234'],
    ['comma between digits', '054,123,1234'],
    ['tilde', '054~123~1234'],
    ['fraction slash', '054⁄123⁄1234'],
    ['ideographic space', '054　123　1234'],
  ])('%s', (_n, phone) => {
    const r = redactPii(`call ${phone} now`);
    expect(r.text).toBe(`call ${REDACTED} now`);
    expect(findPii(`call ${phone} now`)).toEqual(['phone']);
  });
  it('a comma followed by a space does not join numbers', () => {
    expect(redactPii('scores 10, 20, 30, 40, 50').count).toBe(0);
  });
});

describe('robustness (3, nits)', () => {
  it('counts backticks in one pass: many handles on a long line are fast', () => {
    const text = '`@abcd '.repeat(40_000);
    expect(timed(() => redactPii(text))).toBeLessThan(1500);
    expect(timed(() => findPii(text))).toBeLessThan(1500);
    const plain = '@abcd '.repeat(40_000);
    expect(timed(() => redactPii(plain))).toBeLessThan(2500);
  });
  it('maps a million non-ASCII digits quickly', () => {
    const text = '٠١٢٣٤'.repeat(200_000);
    expect(timed(() => redactPii(text))).toBeLessThan(20_000);
  }, 60_000);
  it('many distinct characters overflow the chunk cache without changing the result', () => {
    const text = Array.from({ length: 6500 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    expect(redactPii(text)).toEqual({ text, count: 0 });
    expect(redactPii(`${text} a@b.com`).count).toBe(1);
  });
  it('finds a handle far into a long line, and one near the start', () => {
    expect(redactPii(`${'word '.repeat(100)}@eyalcohen`).count).toBe(1);
    expect(redactPii(`${'w '.repeat(20)}@eyalcohen`).count).toBe(1);
  });
  it('a chain of handles needs several passes and is bounded', () => {
    expect(MAX_PASSES).toBeGreaterThanOrEqual(5);
    const five = '@abc@abc@abc@abc@abc';
    expect(findPii(redactPii(five).text)).toEqual([]);
    const long = '@abc'.repeat(200);
    expect(timed(() => redactPii(long))).toBeLessThan(500);
  });
  it('a stray combining mark after a name does not hide it, and marks in names do not matter', () => {
    const ids = { knownIdentifiers: ['Eyal'] };
    expect(redactPii('hi Eyal̀ there', ids).count).toBe(1);
    const niqqud = knownIdentifiersFor({ displayName: 'דָּנָה' });
    expect(redactPii('שלום דנה', { knownIdentifiers: niqqud }).count).toBe(1);
    expect(redactPii('שלום דָּנָה', { knownIdentifiers: ['דנה'] }).count).toBe(1);
  });
});
