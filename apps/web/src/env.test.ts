import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('defaults to the operational environment and a local API', () => {
    expect(parseEnv({})).toEqual({ appEnv: 'operational', apiUrl: 'http://localhost:3000' });
  });

  it('reads the variables and strips trailing slashes from the API url', () => {
    expect(parseEnv({ VITE_APP_ENV: 'rnd', VITE_API_URL: 'https://api.example.test//' })).toEqual({
      appEnv: 'rnd',
      apiUrl: 'https://api.example.test',
    });
  });

  it.each([
    'localhost:3000',
    'ftp://api.example.test',
    'javascript:alert(1)',
    'api.example.test',
    '',
  ])('rejects %j as the API url', (url) => {
    expect(() => parseEnv({ VITE_API_URL: url })).toThrow(/VITE_API_URL/);
  });

  it.each(['http://localhost:3000', 'https://api.example.test'])('accepts %s', (url) => {
    expect(parseEnv({ VITE_API_URL: url }).apiUrl).toBe(url);
  });

  it('rejects an unknown environment and a bad url, naming both', () => {
    expect(() => parseEnv({ VITE_APP_ENV: 'staging', VITE_API_URL: 'nope' })).toThrow(
      /VITE_APP_ENV[\s\S]*VITE_API_URL/,
    );
  });
});
