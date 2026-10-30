import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const SUPABASE = {
  VITE_SUPABASE_URL: 'https://abc.supabase.test',
  VITE_SUPABASE_ANON_KEY: 'anon-key-placeholder',
};

describe('parseEnv', () => {
  it('defaults to the operational environment and a local API', () => {
    expect(parseEnv({ ...SUPABASE })).toEqual({
      appEnv: 'operational',
      apiUrl: 'http://localhost:3000',
      supabaseUrl: 'https://abc.supabase.test',
      supabaseAnonKey: 'anon-key-placeholder',
    });
  });

  it('reads the variables and strips trailing slashes from the API url', () => {
    const env = parseEnv({
      ...SUPABASE,
      VITE_APP_ENV: 'rnd',
      VITE_API_URL: 'https://api.example.test//',
    });
    expect(env.appEnv).toBe('rnd');
    expect(env.apiUrl).toBe('https://api.example.test');
  });

  it.each([
    'localhost:3000',
    'ftp://api.example.test',
    'javascript:alert(1)',
    'api.example.test',
    '',
  ])('rejects %j as the API url', (url) => {
    expect(() => parseEnv({ ...SUPABASE, VITE_API_URL: url })).toThrow(/VITE_API_URL/);
  });

  it.each(['http://localhost:3000', 'https://api.example.test'])('accepts %s', (url) => {
    expect(parseEnv({ ...SUPABASE, VITE_API_URL: url }).apiUrl).toBe(url);
  });

  it('rejects an unknown environment and a bad url, naming both', () => {
    expect(() => parseEnv({ ...SUPABASE, VITE_APP_ENV: 'staging', VITE_API_URL: 'nope' })).toThrow(
      /VITE_APP_ENV[\s\S]*VITE_API_URL/,
    );
  });

  it('requires the Supabase url and key, naming the missing variables', () => {
    expect(() => parseEnv({})).toThrow(/VITE_SUPABASE_URL[\s\S]*VITE_SUPABASE_ANON_KEY/);
    expect(() => parseEnv({ ...SUPABASE, VITE_SUPABASE_ANON_KEY: '  ' })).toThrow(
      /VITE_SUPABASE_ANON_KEY/,
    );
  });

  it.each(['abc.supabase.co', 'javascript:alert(1)', ''])(
    'rejects %j as the Supabase url',
    (url) => {
      expect(() => parseEnv({ ...SUPABASE, VITE_SUPABASE_URL: url })).toThrow(/VITE_SUPABASE_URL/);
    },
  );
});
