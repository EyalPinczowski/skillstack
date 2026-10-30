import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENT_LEGAL_VERSIONS } from '../src/modules/accounts/legal';

const FILES = { terms: 'terms-of-use.md', privacy: 'privacy-policy.md' } as const;

/** The "Version x · Effective date" line at the top of a draft in docs/legal/. */
function versionLine(file: string): string | undefined {
  const text = readFileSync(
    fileURLToPath(new URL(`../../../docs/legal/${file}`, import.meta.url)),
    'utf8',
  );
  return /\*\*Version ([^\s·*]+)/.exec(text)?.[1];
}

describe('legal document versions', () => {
  it.each(Object.entries(FILES))(
    'the API asks for the %s version that the published document shows',
    (document, file) => {
      expect(versionLine(file)).toBe(
        CURRENT_LEGAL_VERSIONS[document as keyof typeof CURRENT_LEGAL_VERSIONS],
      );
    },
  );
});
