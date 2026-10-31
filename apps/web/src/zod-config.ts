import { z } from 'zod';

// The app's Content-Security-Policy has no 'unsafe-eval'. When a schema is created, Zod probes for
// eval support with `new Function('')`. The probe is caught, but the browser still reports it as
// a CSP violation (found by the e2e console check). Switching the optimisation off skips the
// probe. This module must be the first import of main.tsx, before any schema exists.
z.config({ jitless: true });
