import './zod-config';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './styles/index.css';
import { mount } from './bootstrap';

const root = document.getElementById('root')!;

if (__E2E__) {
  // TEST-ONLY. `__E2E__` is a build-time constant that is `false` in every normal build, so this
  // branch and the module it imports are removed from the bundle (checked by
  // src/build/e2e-bundle.test.ts). The e2e build swaps the Supabase sign-in for a token read
  // from localStorage; the API still verifies that token.
  void import('./e2e/e2e-auth-service').then(({ createE2EAuthService }) =>
    mount(root, import.meta.env, createE2EAuthService()),
  );
} else {
  mount(root, import.meta.env);
}
