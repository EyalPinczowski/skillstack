import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  fakeAuth,
  installApi,
  json,
  meBody,
  renderApp,
  SESSION,
  unacceptedLegal,
} from '../test/helpers';

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('route guard', () => {
  it('sends a signed-out visitor to the sign-in page and never calls the API', async () => {
    const api = installApi({ 'GET /api/v1/me': () => json(meBody()) });
    renderApp({ auth: fakeAuth(null), path: '/' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No plan yet' })).not.toBeInTheDocument();
    expect(api.count('GET /api/v1/me')).toBe(0);
  });

  it.each(['/settings', '/'])('guards %s the same way', async (path) => {
    installApi({ 'GET /api/v1/me': () => json(meBody()) });
    renderApp({ auth: fakeAuth(null), path });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a status message, not the app or the sign-in page, while the session is being read', () => {
    installApi({});
    const auth = fakeAuth(null);
    auth.getSession.mockImplementation(() => new Promise(() => {}));
    renderApp({ auth, path: '/' });
    expect(screen.getByRole('status')).toHaveTextContent('Checking your sign-in…');
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('calls GET /me with the Bearer token after sign-in, then shows the empty state', async () => {
    const api = installApi({ 'GET /api/v1/me': () => json(meBody()) });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
    const call = api.calls.find((c) => new URL(c.url).pathname === '/api/v1/me')!;
    expect(call.headers.get('authorization')).toBe('Bearer access-token-placeholder');
  });

  it('opens the sign-in page, then the app, once the person signs in', async () => {
    installApi({ 'GET /api/v1/me': () => json(meBody()) });
    const auth = fakeAuth(null);
    renderApp({ auth, path: '/' });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    await act(async () => auth.emit(SESSION));
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
  });

  it('returns to the sign-in page when the session ends elsewhere', async () => {
    installApi({ 'GET /api/v1/me': () => json(meBody()) });
    const auth = fakeAuth(SESSION);
    renderApp({ auth, path: '/' });
    await screen.findByRole('heading', { name: 'No plan yet' });
    await act(async () => auth.emit(null));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('403 from GET /me', () => {
  beforeEach(() => {
    installApi({
      'GET /api/v1/me': () => apiError(403, 'forbidden', 'This account cannot use Skillstack.'),
    });
  });

  it('shows only the generic message and a sign-out button, with no hint why', async () => {
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    expect(
      await screen.findByRole('heading', { name: 'This account cannot use Skillstack.' }),
    ).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(
      /invite|allowlist|waitlist|beta is full|capacity|disabled|dana@example/i,
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No plan yet' })).not.toBeInTheDocument();
  });

  it('signs out from that screen and returns to the sign-in page', async () => {
    const auth = fakeAuth(SESSION);
    renderApp({ auth, path: '/' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledWith('local');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('401 from GET /me', () => {
  it('ends the session locally instead of showing the app', async () => {
    installApi({
      'GET /api/v1/me': () => apiError(401, 'unauthorized', 'Authentication is required.'),
    });
    const auth = fakeAuth(SESSION);
    renderApp({ auth, path: '/' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalledWith('local');
  });
});

describe('terms gate', () => {
  const needsTerms = () => meBody({ legal: { ...unacceptedLegal } });

  it('shows the acceptance screen before anything else, with the versions from /me', async () => {
    installApi({
      'GET /api/v1/me': () =>
        json(
          meBody({
            legal: {
              terms: { currentVersion: '0.7', accepted: false },
              privacy: { currentVersion: '0.3', accepted: false },
              allAccepted: false,
            },
          }),
        ),
    });
    renderApp({ auth: fakeAuth(SESSION), path: '/settings' });
    expect(await screen.findByRole('heading', { name: 'Before you continue' })).toBeInTheDocument();
    expect(screen.getByText(/version 0\.7/)).toBeInTheDocument();
    expect(screen.getByText(/version 0\.3/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('opens the documents in a new tab so the screen is not lost', async () => {
    installApi({ 'GET /api/v1/me': () => json(needsTerms()) });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    const link = await screen.findByRole('link', { name: /Terms of Use/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('refuses to continue until the box is ticked, and announces why', async () => {
    const api = installApi({ 'GET /api/v1/me': () => json(needsTerms()) });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    await userEvent.click(await screen.findByRole('button', { name: 'Accept and continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Tick the box to continue.');
    expect(screen.getByRole('checkbox')).toBeInvalid();
    expect(api.count('POST /api/v1/me/legal-acceptances')).toBe(0);
  });

  it('records both acceptances with the current versions, then opens the app', async () => {
    let accepted: string[] = [];
    const api = installApi({
      'GET /api/v1/me': () => json(needsTerms()),
      'POST /api/v1/me/legal-acceptances': async (request) => {
        const body = (await request.json()) as { document: string; version: string };
        accepted = [...accepted, `${body.document}@${body.version}`];
        return json(accepted.length === 2 ? meBody() : needsTerms());
      },
    });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
    expect(accepted).toEqual(['terms@0.1', 'privacy@0.1']);
    expect(api.count('POST /api/v1/me/legal-acceptances')).toBe(2);
  });

  it('keeps the screen and says so when saving fails', async () => {
    installApi({
      'GET /api/v1/me': () => json(needsTerms()),
      'POST /api/v1/me/legal-acceptances': () =>
        apiError(422, 'unprocessable', 'Only the current version can be accepted.'),
    });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t save your answer');
    expect(screen.getByRole('heading', { name: 'Before you continue' })).toBeInTheDocument();
  });

  it('lets the person sign out instead of accepting', async () => {
    installApi({ 'GET /api/v1/me': () => json(needsTerms()) });
    const auth = fakeAuth(SESSION);
    renderApp({ auth, path: '/' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledWith('local');
  });
});

describe('error and offline states', () => {
  it('says the server cannot be reached, and Retry asks again', async () => {
    let answer: () => Response | Promise<Response> = () => {
      throw new TypeError('Failed to fetch');
    };
    const api = installApi({ 'GET /api/v1/me': () => answer() });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Can’t reach the server.');
    expect(screen.queryByRole('heading', { name: 'No plan yet' })).not.toBeInTheDocument();

    answer = () => json(meBody());
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
    expect(api.count('GET /api/v1/me')).toBe(2);
  });

  it('tells a server-side failure apart from a lost connection', async () => {
    installApi({
      'GET /api/v1/me': () => apiError(500, 'internal_error', 'Something went wrong on our side.'),
    });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.');
  });

  it('says the person is offline instead of spinning forever', async () => {
    const api = installApi({ 'GET /api/v1/me': () => json(meBody()) });
    onlineManager.setOnline(false);
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    expect(await screen.findByText(/You're offline\./)).toBeInTheDocument();
    expect(api.count('GET /api/v1/me')).toBe(0);
    await act(async () => onlineManager.setOnline(true));
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
  });

  it('explains the cold start when the account call is slow', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installApi({ 'GET /api/v1/me': () => new Promise<Response>(() => {}) });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByRole('status')).toHaveTextContent('Loading your account…');
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Waking up the server… this can take up to a minute on the free plan',
    );
  });

  it('gives up with an error when the server never answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installApi({ 'GET /api/v1/me': () => new Promise<Response>(() => {}) });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    await act(() => vi.advanceTimersByTimeAsync(100));
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(await screen.findByRole('alert')).toHaveTextContent('Can’t reach the server.');
  });
});

describe('cache between people', () => {
  it('drops the previous person’s account data when someone else signs in', async () => {
    const api = installApi({
      'GET /api/v1/me': () => json(meBody({ displayName: 'Dana' })),
    });
    const auth = fakeAuth(SESSION);
    renderApp({ auth, path: '/settings' });
    expect(await screen.findByDisplayValue('Dana')).toBeInTheDocument();
    await act(async () => auth.emit(null));
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });

    // Lee's account answers slowly: until it does, nothing of Dana's may be on screen.
    let answer: (response: Response) => void = () => {};
    api.stub.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    await act(async () =>
      auth.emit({ userId: '22222222-2222-4222-8222-222222222222', email: 'lee@example.com' }),
    );
    expect(await screen.findByText('Loading your account…')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Dana')).not.toBeInTheDocument();
    expect(screen.queryByText('dana@example.com')).not.toBeInTheDocument();

    await act(async () => answer(json(meBody({ displayName: 'Lee' }))));
    // Sign-in returns to the page that was asked for: Settings.
    expect(await screen.findByDisplayValue('Lee')).toBeInTheDocument();
  });
});

describe('403 terms_not_accepted from a data call', () => {
  it('shows the Terms screen when the API reports a newer version than /me said', async () => {
    let accepted = true;
    const api = installApi({
      'GET /api/v1/me': () => json(meBody(accepted ? {} : { legal: unacceptedLegal })),
      'GET /api/v1/plans': () => {
        accepted = false; // the Terms were updated while this tab was open
        return apiError(403, 'terms_not_accepted', 'Accept the current Terms of Use to continue.');
      },
    });
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    expect(await screen.findByRole('heading', { name: 'Before you continue' })).toBeInTheDocument();
    expect(api.count('GET /api/v1/me')).toBe(2);
    expect(screen.queryByRole('heading', { name: 'No plan yet' })).not.toBeInTheDocument();
  });
});
