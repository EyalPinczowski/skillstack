import { APP_NAME } from '@skillstack/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import pkg from '../../../package.json' with { type: 'json' };
import type { Config } from '../../config';

const healthSchema = z.object({
  status: z.literal('ok'),
  app: z.string(),
  environment: z.enum(['operational', 'rnd']),
  version: z.string(),
  time: z.iso.datetime(),
});

export const healthRoutes: FastifyPluginAsyncZod<{ config: Config }> = async (app, { config }) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness check',
        response: { 200: healthSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      app: APP_NAME,
      environment: config.appEnv,
      version: pkg.version,
      time: new Date().toISOString(),
    }),
  );
};
