import { APP_NAME } from '@skillstack/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import pkg from '../../../package.json' with { type: 'json' };
import type { Config } from '../../config';
import type { DatabaseProbe } from './probe';

const base = {
  app: z.string(),
  environment: z.enum(['operational', 'rnd']),
  version: z.string(),
  time: z.iso.datetime(),
  database: z.enum(['ok', 'unavailable', 'not_configured']),
};
const healthSchema = z.object({ status: z.literal('ok'), ...base });
const notReadySchema = z.object({ status: z.literal('unavailable'), ...base });

export interface HealthRoutesOptions {
  config: Config;
  probe: DatabaseProbe;
}

export const healthRoutes: FastifyPluginAsyncZod<HealthRoutesOptions> = async (
  app,
  { config, probe },
) => {
  const details = async () => ({
    app: APP_NAME,
    environment: config.appEnv,
    version: pkg.version,
    time: new Date().toISOString(),
    database: await probe.check(),
  });

  // Liveness, for Render's health check and the keep-warm ping. Always 200 while the process
  // runs: a database blip must not make Render restart a healthy service. The `database` field
  // reports it instead, and the ping itself keeps the free Supabase project from pausing.
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness check (also reports the database)',
        description:
          'Always 200 while the process runs. `database` is `ok`, `unavailable` (a `select 1` as the app login failed or took longer than 1.5 seconds) or `not_configured`. The result is cached for a few seconds. Use `/health/ready` to get a 503 when the database is down.',
        response: { 200: healthSchema },
      },
    },
    async () => ({ status: 'ok' as const, ...(await details()) }),
  );

  // Readiness: 503 when the database cannot be used. Not for Render's health check.
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness check: 503 when the database is down',
        response: { 200: healthSchema, 503: notReadySchema },
      },
    },
    async (_request, reply) => {
      const body = await details();
      if (body.database === 'ok') return reply.send({ status: 'ok' as const, ...body });
      return reply.status(503).send({ status: 'unavailable' as const, ...body });
    },
  );
};
