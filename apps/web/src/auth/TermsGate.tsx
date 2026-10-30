import { useState, type FormEvent } from 'react';
import { isApiError } from '../api/errors';
import type { LegalDocument, Me } from '../api/client';
import { useAcceptLegal } from '../api/hooks';
import { Button, ErrorText, linkClass } from '../components/ui';
import { useAuth } from './AuthProvider';

const NEW_TAB = ' (opens in a new tab)';

/** The one-time acceptance of the current Terms and Privacy Policy, before anything else (spec 3.A/3.C). */
export function TermsGate({ me }: { me: Me }) {
  const { signOut } = useAuth();
  const accept = useAcceptLegal();
  const [checked, setChecked] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);

  const { terms, privacy } = me.legal;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!checked) {
      setNeedsCheck(true);
      return;
    }
    setNeedsCheck(false);
    // The versions come from the API, never from this app's own copy.
    const pending: { document: LegalDocument; version: string }[] = [];
    if (!terms.accepted) pending.push({ document: 'terms', version: terms.currentVersion });
    if (!privacy.accepted) pending.push({ document: 'privacy', version: privacy.currentVersion });
    accept.mutate(pending);
  }

  const failure = accept.error
    ? isApiError(accept.error) && accept.error.kind !== 'http'
      ? 'Can’t reach the server. Check your connection and try again.'
      : 'We couldn’t save your answer. Reload the page and try again.'
    : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <h1>Before you continue</h1>
      <p>
        Please read and accept the current Terms of Use (version {terms.currentVersion}) and Privacy
        Policy (version {privacy.currentVersion}). Skillstack is a free beta, and these are drafts.
      </p>
      <ul className="list-disc space-y-1 pl-6">
        <li>
          <a className={linkClass} href="/terms" target="_blank" rel="noopener">
            Terms of Use{NEW_TAB}
          </a>
        </li>
        <li>
          <a className={linkClass} href="/privacy" target="_blank" rel="noopener">
            Privacy Policy{NEW_TAB}
          </a>
        </li>
        <li>
          <a className={linkClass} href="/disclaimer" target="_blank" rel="noopener">
            Disclaimer{NEW_TAB}
          </a>
        </li>
      </ul>

      <div className="space-y-2">
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            aria-describedby={needsCheck ? 'terms-error' : undefined}
            aria-invalid={needsCheck ? true : undefined}
            className="mt-1 size-5 shrink-0 accent-accent"
          />
          <span className="font-bold">
            I have read and accept the Terms of Use and the Privacy Policy.
          </span>
        </label>
        {needsCheck ? <ErrorText id="terms-error">Tick the box to continue.</ErrorText> : null}
        {failure ? <ErrorText>{failure}</ErrorText> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={accept.isPending}>
          {accept.isPending ? 'Saving…' : 'Accept and continue'}
        </Button>
        <Button onClick={() => void signOut('local').catch(() => undefined)}>Sign out</Button>
      </div>
    </form>
  );
}
