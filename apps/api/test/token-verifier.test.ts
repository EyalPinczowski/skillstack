import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSupabaseVerifier,
  InvalidTokenError,
  rejectAllVerifier,
  type TokenVerifier,
} from '../src/modules/accounts/token-verifier';
import { ISSUER, makeTestKeys, unsignedToken, type TestKeys } from './tokens';

const SUB = '3f2b8a2e-6c1d-4f47-9a55-0d2f6f1c9b10';

describe('Supabase token verifier', () => {
  let t: TestKeys;
  let verifier: TokenVerifier;

  beforeAll(async () => {
    t = await makeTestKeys();
    verifier = createSupabaseVerifier({ issuer: ISSUER, keys: t.keys });
  });

  it('accepts a valid token and returns the sub and the lower-cased email', async () => {
    const token = await t.sign({ sub: SUB, email: 'Some.One@Example.com' });
    await expect(verifier.verify(token)).resolves.toEqual({
      userId: SUB,
      email: 'some.one@example.com',
    });
  });

  it('accepts RS256 as well as ES256', async () => {
    await expect(verifier.verify(await t.sign({ sub: SUB, alg: 'RS256' }))).resolves.toMatchObject({
      userId: SUB,
    });
  });

  it('allows a token without an email claim (the allowlist then refuses it)', async () => {
    await expect(verifier.verify(await t.sign({ sub: SUB, email: null }))).resolves.toEqual({
      userId: SUB,
      email: null,
    });
  });

  const rejected: Array<[string, () => Promise<string>]> = [
    ['an expired token', () => t.sign({ sub: SUB, expiresIn: -60 })],
    ['the wrong issuer', () => t.sign({ sub: SUB, iss: 'https://evil.example.test/auth/v1' })],
    ['the wrong audience', () => t.sign({ sub: SUB, aud: 'anon' })],
    ['a signature from another key', () => t.sign({ sub: SUB, otherKey: true })],
    ['alg none', async () => unsignedToken(SUB)],
    ['a missing sub', () => t.sign({ sub: null })],
    ['a sub that is not a UUID', () => t.sign({ sub: 'admin' })],
    ['a sub that is an SQL fragment', () => t.sign({ sub: "x' or '1'='1" })],
    ['garbage', async () => 'not.a.jwt'],
    ['an empty string', async () => ''],
  ];

  it.each(rejected)('rejects %s', async (_name, make) => {
    await expect(verifier.verify(await make())).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects a token whose payload was tampered with after signing', async () => {
    const [h, , s] = (await t.sign({ sub: SUB })).split('.');
    const forged = Buffer.from(
      JSON.stringify({
        sub: '99999999-9999-4999-8999-999999999999',
        iss: ISSUER,
        aud: 'authenticated',
        exp: 9999999999,
      }),
    ).toString('base64url');
    await expect(verifier.verify(`${h}.${forged}.${s}`)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('never accepts anything when verification is not configured', async () => {
    await expect(rejectAllVerifier.verify(await t.sign({ sub: SUB }))).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });
});
