import { useState } from 'react';
import { Button, ErrorText } from '../components/ui';
import { useAuth } from './AuthProvider';

/**
 * Shown when the API answers 403. The words are the API's own generic message on purpose: the
 * screen must not hint at why (not invited, beta full, disabled), so nobody can probe the list.
 */
export function ForbiddenScreen() {
  const { signOut } = useAuth();
  const [failed, setFailed] = useState(false);

  async function onSignOut() {
    setFailed(false);
    try {
      await signOut('local');
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="space-y-4">
      <h1>This account cannot use Skillstack.</h1>
      <Button variant="primary" onClick={() => void onSignOut()}>
        Sign out
      </Button>
      {failed ? <ErrorText>We couldn’t sign you out. Try again.</ErrorText> : null}
    </div>
  );
}
