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

describe('only narrow code shapes keep an @ token (6)', () => {
  const FENCE = '```';
  const exempt = [
    `${FENCE}\nSELECT * FROM users WHERE id = @UserId\n${FENCE}`,
    `text\n${FENCE}sql\nDECLARE @total INT; SET @total = 5\nEXEC @result = proc\n${FENCE}\nmore`,
    `${FENCE}\n@media screen { }\n@Component(selector)\n${FENCE}`,
    '@dataclass\nclass Point:\n    x: int',
    'intro line\n@dataclass\nclass Later: pass',
    '  @staticmethod\n  def f(): pass',
    '@Override\npublic void run() {}',
    '@app.route("/")\ndef index(): pass',
    "import x from '@angular/core'",
    'import y from "@types/node"',
    'npm i @types/node',
    'pnpm add -D @types/node',
  ];
  it.each(exempt)('exempt: %j', (text) => {
    expect(redactPii(text).count).toBe(0);
    expect(findPii(text)).toEqual([]);
  });
  const leaks = [
    'Feedback from my mentor, @janedoe',
    'Greetings from Tel Aviv (@janedoe)',
    'Please select @janedoe for the panel',
    'I set @janedoe as reviewer',
    'can`t` then ping @janedoe',
    'my twitter is `@janedoe`',
    'ping @janedoe.Thanks',
    'ping @janedoe/twitter',
    'ping @janedoe(thanks)',
    'thanks @eyalcohen for the help',
    '@eyalcohen is the owner',
    '@eyalcohen is the owner\nclass starts at nine',
    'ping @jane.',
    'ping @jane, thanks',
    'hi, @jane_doe',
    'cc @eyalcohen\nclass starts at nine',
    'please set up a call with @eyalcohen',
    '@Override public void run() {}',
    'SELECT * FROM users WHERE id = @UserId',
    `${FENCE}\nunclosed fence @janedoe`,
    `${FENCE}\ncode\n${FENCE}\nafter the fence @janedoe`,
    '@media screen and @import url',
    'from @janedoe/twitter',
  ];
  it.each(leaks)('redacted: %j', (text) => {
    expect(redactPii(text).count).toBeGreaterThan(0);
    expect(findPii(text)).toEqual(['handle']);
  });
  it('limits the handle length to 32', () => {
    expect(redactPii('ping @' + 'a'.repeat(32) + ' now').count).toBe(1);
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
  it('a short list of numbers is not a phone', () => {
    expect(redactPii('scores 10, 20, 30').count).toBe(0);
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
