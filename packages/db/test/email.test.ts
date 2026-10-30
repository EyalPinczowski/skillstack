import { describe, expect, it } from 'vitest';
import { InvalidEmailError, normalizeEmail } from '../src/admin';

describe('normalizeEmail', () => {
  it('lower-cases and trims a normal address', () => {
    expect(normalizeEmail('  Eyal@Example.COM ')).toBe('eyal@example.com');
  });

  it.each(['', 'a', 'a@b', '@b.com', 'a@.com', 'a@b.', 'a b@c.com', 'a@@b.com', 'a@b@c.com'])(
    'rejects %j',
    (value) => {
      expect(() => normalizeEmail(value)).toThrow(InvalidEmailError);
    },
  );

  it('rejects an address longer than 254 characters', () => {
    expect(() => normalizeEmail(`${'a'.repeat(250)}@b.com`)).toThrow(InvalidEmailError);
  });

  it('stays fast on a long run of repeated "!." after the at sign', () => {
    const started = Date.now();
    expect(() => normalizeEmail(`a@${'!.'.repeat(20_000)}`)).toThrow(InvalidEmailError);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
