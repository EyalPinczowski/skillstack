import { marked } from 'marked';
import disclaimerMd from '../../../../docs/legal/disclaimer.md?raw';
import privacyMd from '../../../../docs/legal/privacy-policy.md?raw';
import termsMd from '../../../../docs/legal/terms-of-use.md?raw';

export type LegalSlug = 'terms' | 'privacy' | 'disclaimer';

export interface LegalPageContent {
  slug: LegalSlug;
  path: `/${LegalSlug}`;
  /** Short name for links and the browser tab. */
  title: string;
  html: string;
}

/**
 * The drafts in docs/legal/ are the single source: they are bundled at build time and rendered
 * here, so the pages cannot drift from the files. The text is our own, committed in this repo
 * (never user input), and placeholders in square brackets are kept exactly as written (spec 3.C).
 */
const render = (markdown: string): string => marked.parse(markdown, { async: false });

export const LEGAL_PAGES: Record<LegalSlug, LegalPageContent> = {
  terms: { slug: 'terms', path: '/terms', title: 'Terms of Use', html: render(termsMd) },
  privacy: { slug: 'privacy', path: '/privacy', title: 'Privacy Policy', html: render(privacyMd) },
  disclaimer: {
    slug: 'disclaimer',
    path: '/disclaimer',
    title: 'Disclaimer',
    html: render(disclaimerMd),
  },
};
