import { describe, expect, it } from 'vitest';
import { REDACTED, findPii, knownIdentifiersFor, redactPii } from './redact';

describe('a decorator needs code on the next line (1)', () => {
  it.each([
    'My handle:\n@janedoe\nPrivate messages welcome.',
    'Reach me on X:\n@janedoe\nPublic profile, DM open',
    'Find me:\n@janedoe\nStatic site coming soon',
    'Find me:\n@janedoe\nExport of my notes is online',
    'Find me:\n@janedoe\nasync is fine by me',
    'Find me:\n@janedoe\nclass of 2019 alumna',
    'Find me:\n@janedoe\nClass of 2019 alumna',
    'Find me:\n@janedoe\nDef leppard fan',
    'Find me:\n@janedoe\nPUBLIC NOTICE',
  ])('redacted: %j', (text) => {
    expect(redactPii(text).count).toBe(1);
    expect(findPii(text)).toEqual(['handle']);
  });
  it.each([
    '@dataclass\nclass Point:\n    x: int',
    '@Override\npublic void run() {}',
    '@Override\n  protected static int count(int x) {}',
    '@decorator\nasync def handler(request):',
    '@app.route("/")\ndef index(): pass',
    '@Injectable()\nexport class Service {',
    '@x1\nfunction go() {}',
    '@x1\nexport default async function go() {}',
  ])('still exempt: %j', (text) => {
    expect(redactPii(text).count).toBe(0);
  });
});

describe('a host right after a dot or an ellipsis is still a host (2)', () => {
  it.each([
    ['Find me\u2026janedoe.com', 'Find me\u2026[removed]'],
    ['My site...janedoe.studio', 'My site...[removed]'],
    ['Portfolio:.janedoe.dev', 'Portfolio:.[removed]'],
    ['see (janedoe.dev)', 'see ([removed])'],
  ])('%s', (text) => {
    expect(redactPii(text).count).toBe(1);
    expect(findPii(text)).toEqual(['url']);
  });
  it('a dot after a letter still means the middle of a host', () => {
    expect(redactPii('a.b.c.example.com').text).toBe(REDACTED);
  });
});

describe('handles (round 4)', () => {
  it.each([
    ['dotted', 'ping @jane.doe now', 'ping [removed] now'],
    ['dotted twice', 'ping @jane.doe.design now', 'ping [removed] now'],
    ['dashed', 'ping @jane-doe now', 'ping [removed] now'],
    ['doubled at', 'ping @@janedoe now', 'ping @[removed] now'],
    ['underscore before', 'ping _@janedoe now', 'ping _[removed] now'],
    ['trailing dot is punctuation', 'ping @janedoe. Bye', 'ping [removed]. Bye'],
  ])('%s', (_n, text, expected) => {
    expect(redactPii(text).text).toBe(expected);
    expect(findPii(text)).toEqual(['handle']);
  });
  it('npm scopes need an install command, or a known scope after a quote', () => {
    for (const ok of [
      'npm i @janedoe/pkg',
      "import a from '@testing-library/react'",
      'import a from "@aws-sdk/client-s3"',
      "import a from '@tanstack/query'",
    ]) {
      expect(redactPii(ok).count, ok).toBe(0);
    }
    for (const leak of [
      "DM '@janedoe/twitter'",
      'DM "@janedoe/twitter" please',
      "import a from '@janedoe/twitter'",
      'ping @types/node',
    ]) {
      expect(redactPii(leak).count, leak).toBe(1);
    }
  });
  it('a fence must start its line, be closed, and not hide a handle on the same line', () => {
    const f = '```';
    expect(redactPii(`${f}\n@janedoe\n${f}`).count).toBe(0);
    expect(redactPii(`  ${f}\n@janedoe\n${f}`).count).toBe(0);
    expect(redactPii(`my ${f}@janedoe${f} handle`).count).toBe(1);
    expect(redactPii(`x ${f} then @janedoe ${f} y`).count).toBe(1);
    expect(redactPii(`${f}\ncode\n${f} @janedoe`).count).toBe(1);
  });
});

describe('numbers and names (round 4 nits)', () => {
  it('single digits joined by symbols', () => {
    expect(redactPii('call 0*5*0*1*2*3*4*5*6 now').text).toBe(`call ${REDACTED} now`);
    expect(findPii('0|5|0|1|2|3|4|5|6')).toEqual(['phone']);
    expect(redactPii('1*2*3*4*5*6*7*8').count).toBe(0);
  });
  it('reversed name joins', () => {
    const ids = knownIdentifiersFor({ displayName: 'Eyal Pinto' });
    for (const t of ['PintoEyal', 'pinto.eyal', 'Pinto_Eyal']) {
      expect(redactPii(`by ${t} ok`, { knownIdentifiers: ids }).text).toBe(`by ${REDACTED} ok`);
    }
  });
});
