import { describe, expect, it } from 'vitest';
import { environmentNames } from '../src/names';
import { renderSql } from '../src/render';

const names = environmentNames('rnd');

describe('renderSql', () => {
  it('replaces tokens, with or without spaces inside the braces', () => {
    expect(renderSql('{{schema}} {{ owner }}', names)).toBe(`${names.schema} ${names.owner}`);
  });

  it('rejects an unknown token', () => {
    expect(() => renderSql('{{nope}}', names)).toThrow(/Unknown token/);
  });

  it('stays fast on a long run of spaces after an opening brace', () => {
    const hostile = '{{{{{{{{' + ' '.repeat(50_000);
    const started = Date.now();
    expect(renderSql(hostile, names)).toBe(hostile);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
