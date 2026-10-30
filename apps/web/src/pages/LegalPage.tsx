import { useEffect } from 'react';
import { Link } from 'react-router';
import { LEGAL_PAGES, type LegalSlug } from '../lib/legal';
import { linkClass } from '../components/ui';

export function LegalPage({ slug }: { slug: LegalSlug }) {
  const page = LEGAL_PAGES[slug];

  useEffect(() => {
    const previous = document.title;
    document.title = `${page.title} · Skillstack`;
    return () => {
      document.title = previous;
    };
  }, [page.title]);

  return (
    <article className="space-y-4">
      <p>
        <Link className={linkClass} to="/">
          Back to Skillstack
        </Link>
      </p>
      {/* Our own bundled text; see lib/legal.ts. */}
      <div className="legal-text" dangerouslySetInnerHTML={{ __html: page.html }} />
      <nav
        aria-label="Legal documents"
        className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4"
      >
        {Object.values(LEGAL_PAGES)
          .filter((p) => p.slug !== slug)
          .map((p) => (
            <Link key={p.slug} className={linkClass} to={p.path}>
              {p.title}
            </Link>
          ))}
      </nav>
    </article>
  );
}
