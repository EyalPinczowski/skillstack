import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthFailure } from '../auth/auth-service';
import { expectNoAxeViolations } from '../test/axe';
import { fakeAuth, installApi, json, meBody, renderApp, SESSION } from '../test/helpers';
import { RESEND_COOLDOWN_SECONDS } from './SignInPage';

beforeEach(() => {
  installApi({ 'GET /api/v1/me': () => json(meBody()) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const emailBox = () => screen.getByRole('textbox', { name: 'Email' });
const codeBox = () => screen.getByRole('textbox', { name: '6-digit code' });

async function toCodeStep(auth = fakeAuth(null)) {
  const user = userEvent.setup();
  renderApp({ auth, path: '/signin' });
  await user.type(emailBox(), 'dana@example.com');
  await user.click(screen.getByRole('button', { name: 'Email me a code' }));
  await screen.findByRole('textbox', { name: '6-digit code' });
  return { user, auth };
}

describe('sign-in page', () => {
  it('asks for an email first, with Google and the legal links', () => {
    renderApp({ auth: fakeAuth(null), path: '/signin' });
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(emailBox()).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    const legal = within(screen.getByRole('navigation', { name: 'Legal' }));
    expect(legal.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(legal.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(legal.getByRole('link', { name: 'Disclaimer' })).toHaveAttribute('href', '/disclaimer');
  });

  it('sends the code to the trimmed email, then moves focus to the code field', async () => {
    const auth = fakeAuth(null);
    const user = userEvent.setup();
    renderApp({ auth, path: '/signin' });
    await user.type(emailBox(), '  dana@example.com ');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(auth.sendCode).toHaveBeenCalledExactlyOnceWith('dana@example.com');
    expect(await screen.findByRole('textbox', { name: '6-digit code' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(
      'We sent a 6-digit code to dana@example.com',
    );
    expect(codeBox()).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('does not send a malformed address, and says so in an announced error', async () => {
    const auth = fakeAuth(null);
    const user = userEvent.setup();
    renderApp({ auth, path: '/signin' });
    await user.type(emailBox(), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(auth.sendCode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email address');
    expect(emailBox()).toHaveFocus();
    expect(emailBox()).toBeInvalid();
    expect(emailBox()).toHaveAccessibleDescription(/Enter your email address/);
  });

  it('shows the same neutral error whatever the reason a code could not be sent', async () => {
    const auth = fakeAuth(null);
    auth.sendCode.mockRejectedValueOnce(new AuthFailure('failed'));
    const user = userEvent.setup();
    renderApp({ auth, path: '/signin' });
    await user.type(emailBox(), 'stranger@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t send a code. Check the address and try again.',
    );
    expect(screen.queryByRole('textbox', { name: '6-digit code' })).not.toBeInTheDocument();
  });

  it.each([
    ['rate_limited', /Too many attempts/],
    ['network', /Can’t reach the sign-in service/],
  ] as const)('explains a %s failure', async (kind, message) => {
    const auth = fakeAuth(null);
    auth.sendCode.mockRejectedValueOnce(new AuthFailure(kind));
    const user = userEvent.setup();
    renderApp({ auth, path: '/signin' });
    await user.type(emailBox(), 'dana@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('signs in with the 6-digit code and lands in the app', async () => {
    const { user, auth } = await toCodeStep();
    await user.type(codeBox(), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.verifyCode).toHaveBeenCalledExactlyOnceWith('dana@example.com', '123456');
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
  });

  it('accepts a code typed with a space and rejects anything that is not six digits', async () => {
    const { user, auth } = await toCodeStep();
    await user.type(codeBox(), '12ab56');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.verifyCode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the 6-digit code');
    expect(codeBox()).toHaveFocus();

    await user.clear(codeBox());
    await user.type(codeBox(), '123 456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.verifyCode).toHaveBeenCalledExactlyOnceWith('dana@example.com', '123456');
  });

  it('keeps the person on the code step with a clear message when the code is wrong', async () => {
    const auth = fakeAuth(null);
    auth.verifyCode.mockRejectedValueOnce(new AuthFailure('invalid_code'));
    const { user } = await toCodeStep(auth);
    await user.type(codeBox(), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code didn’t work');
    expect(codeBox()).toHaveFocus();
    expect(codeBox()).toBeInvalid();
  });

  it('lets the person resend only after a cooldown, counting down in seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, auth } = await toCodeStep();
    const resend = () => screen.getByRole('button', { name: /^Resend code/ });
    expect(resend()).toBeDisabled();
    expect(resend()).toHaveTextContent(`Resend code in ${RESEND_COOLDOWN_SECONDS}s`);

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(resend()).toHaveTextContent(`Resend code in ${RESEND_COOLDOWN_SECONDS - 5}s`);
    expect(resend()).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_SECONDS * 1000));
    expect(resend()).toBeEnabled();
    expect(resend()).toHaveTextContent('Resend code');

    await user.click(resend());
    expect(auth.sendCode).toHaveBeenCalledTimes(2);
    expect(resend()).toBeDisabled();
  });

  it('goes back to the email step to use a different address', async () => {
    const { user } = await toCodeStep();
    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(emailBox()).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '6-digit code' })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(emailBox()).toHaveFocus());
  });

  it('starts Google sign-in, and reports a failure in words', async () => {
    const auth = fakeAuth(null);
    auth.signInWithGoogle.mockRejectedValueOnce(new AuthFailure('failed'));
    const user = userEvent.setup();
    renderApp({ auth, path: '/signin' });
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(auth.signInWithGoogle).toHaveBeenCalledOnce();
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t start Google sign-in');
  });

  it('does not wire Turnstile yet: no captcha token is passed on', async () => {
    const { auth } = await toCodeStep();
    expect(auth.sendCode.mock.calls[0]).toHaveLength(1);
  });

  it('sends an already signed-in person on to the app', async () => {
    renderApp({ auth: fakeAuth(SESSION), path: '/signin' });
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
  });

  it('returns to the page the person came from, but never to another site', async () => {
    const first = renderApp({
      auth: fakeAuth(SESSION),
      path: { pathname: '/signin', state: { from: '/settings' } },
    });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    first.unmount();

    renderApp({
      auth: fakeAuth(SESSION),
      path: { pathname: '/signin', state: { from: '//evil.example' } },
    });
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
  });

  it('has no automatically detectable accessibility violations, on either step', async () => {
    renderApp({ auth: fakeAuth(null), path: '/signin' });
    await expectNoAxeViolations();
    const user = userEvent.setup();
    await user.type(emailBox(), 'dana@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByRole('textbox', { name: '6-digit code' });
    await expectNoAxeViolations();
  });
});
