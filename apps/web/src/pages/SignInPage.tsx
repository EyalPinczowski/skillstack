import { APP_NAME, APP_TAGLINE } from '@skillstack/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { AuthFailure } from '../auth/auth-service';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Logo';
import { Button, ErrorText, linkClass, TextField } from '../components/ui';

export const RESEND_COOLDOWN_SECONDS = 30;
const CODE_LENGTH = 6;

/** A plain, linear check (no regex on user input): something before and after one "@", no spaces. */
function looksLikeEmail(value: string): boolean {
  const at = value.indexOf('@');
  return at > 0 && at === value.lastIndexOf('@') && at < value.length - 1 && !value.includes(' ');
}

const isSixDigits = (value: string) =>
  value.length === CODE_LENGTH && [...value].every((c) => c >= '0' && c <= '9');

/** Same wording whether or not the email is invited: the form never reveals who has an account. */
function messageFor(error: unknown, whenFailed: string): string {
  if (error instanceof AuthFailure) {
    if (error.kind === 'rate_limited')
      return 'Too many attempts. Wait a few minutes and try again.';
    if (error.kind === 'network') {
      return 'Can’t reach the sign-in service. Check your connection and try again.';
    }
  }
  return whenFailed;
}

export function SignInPage() {
  const { state, service, notice } = useAuth();
  const location = useLocation();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Move focus to the field the person needs next, after the step has rendered.
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const counting = secondsLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  if (state.status === 'signedIn') {
    const from = (location.state as { from?: string } | null)?.from;
    return (
      <Navigate to={from && from.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />
    );
  }

  /** Sends a code. Resolves to null on success, or to the message to show. */
  async function sendCode(address: string): Promise<string | null> {
    try {
      // TURNSTILE SEAM (spec 3.A, not wired yet): render the Cloudflare Turnstile widget above
      // the button, keep its token in state, and pass it as `{ captchaToken }` here. Supabase
      // checks it when "CAPTCHA protection" is enabled. Until then the API's per-IP rate limit
      // and Supabase's own email limits are the only brakes.
      await service.sendCode(address);
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
      return null;
    } catch (error) {
      return messageFor(error, 'We couldn’t send a code. Check the address and try again.');
    }
  }

  async function onSubmitEmail(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    setEmailError(null);
    if (!looksLikeEmail(address)) {
      setEmailError('Enter your email address, for example name@example.com.');
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    const problem = await sendCode(address);
    setBusy(false);
    if (problem) {
      setEmailError(problem);
      emailRef.current?.focus();
      return;
    }
    setEmail(address);
    setCode('');
    setCodeError(null);
    setStep('code');
  }

  async function onSubmitCode(event: FormEvent) {
    event.preventDefault();
    const token = code.replaceAll(' ', '');
    setCodeError(null);
    if (!isSixDigits(token)) {
      setCodeError('Enter the 6-digit code from the email.');
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await service.verifyCode(email, token);
      // The auth state change redirects away from this page.
    } catch (error) {
      setCodeError(messageFor(error, 'That code didn’t work. Check it, or request a new one.'));
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setCodeError(null);
    setBusy(true);
    const problem = await sendCode(email);
    setBusy(false);
    if (problem) setCodeError(problem);
    codeRef.current?.focus();
  }

  function chooseOtherEmail() {
    setStep('email');
    setCode('');
    setCodeError(null);
    setSecondsLeft(0);
    // The email field is mounted again by the step change; focus it on the next frame.
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  async function onGoogle() {
    setGoogleError(null);
    try {
      await service.signInWithGoogle();
    } catch (error) {
      setGoogleError(messageFor(error, 'We couldn’t start Google sign-in. Try again.'));
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-md items-center py-4">
      <div className="w-full space-y-5 rounded-lg border border-border bg-surface p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <Logo className="size-11 text-accent" title={null} />
          <div>
            <p className="text-h2 font-bold leading-tight">{APP_NAME}</p>
            <p className="text-muted first-letter:uppercase">{APP_TAGLINE}</p>
          </div>
        </div>

        {notice === 'accountDeleted' ? (
          <p role="status" className="rounded-sm bg-ok-soft p-3 font-bold text-ok">
            Your account was deleted.
          </p>
        ) : null}

        <h1>Sign in</h1>
        <p className="text-muted">
          Skillstack is an invite-only beta. Use the email you were invited with.
        </p>

        {step === 'email' ? (
          <form onSubmit={onSubmitEmail} noValidate className="space-y-4">
            <TextField
              ref={emailRef}
              label="Email"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={emailError}
            />
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={onSubmitCode} noValidate className="space-y-4">
            <p role="status">
              We sent a 6-digit code to <strong>{email}</strong>. It can take a minute to arrive.
            </p>
            <TextField
              ref={codeRef}
              label="6-digit code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH + 2}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={codeError}
            />
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={onResend} disabled={busy || secondsLeft > 0}>
                {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
              </Button>
              <Button onClick={chooseOtherEmail}>Use a different email</Button>
            </div>
          </form>
        )}

        <div className="flex items-center gap-3 text-muted" aria-hidden="true">
          <span className="h-px grow bg-border" />
          or
          <span className="h-px grow bg-border" />
        </div>

        <div className="space-y-2">
          <Button className="w-full" onClick={onGoogle}>
            Continue with Google
          </Button>
          {googleError ? <ErrorText>{googleError}</ErrorText> : null}
        </div>

        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link className={linkClass} to="/privacy">
            Privacy
          </Link>
          <Link className={linkClass} to="/terms">
            Terms
          </Link>
          <Link className={linkClass} to="/disclaimer">
            Disclaimer
          </Link>
        </nav>
      </div>
    </div>
  );
}
