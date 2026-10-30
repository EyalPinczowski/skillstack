/**
 * Current versions of the legal documents (spec 3.C). They match the "Version" line at the top of
 * docs/legal/terms-of-use.md and docs/legal/privacy-policy.md; change both together. Bumping a
 * version makes every user accept again (GET /me reports it as not accepted).
 */
export const LEGAL_DOCUMENTS = ['terms', 'privacy'] as const;

export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

export const CURRENT_LEGAL_VERSIONS: Record<LegalDocument, string> = {
  terms: '0.1',
  privacy: '0.1',
};
