import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { APP_NAME } from '@skillstack/shared';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import pkg from '../package.json' with { type: 'json' };
import type { Config } from './config';
import { installErrorHandling } from './errors';
import { healthRoutes } from './modules/health/routes';
import { installIdempotency } from './plugins/idempotency';
import { generateRequestId, installRequestId } from './plugins/request-id';

/** Builds the app without listening, so tests can use `app.inject`. */
export function buildApp(config: Config) {
  const app = Fastify({
    // Default request logging has no headers or body; redact is a second line of defence.
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
    },
    genReqId: generateRequestId,
    requestIdHeader: false,
    trustProxy: config.trustProxy,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  installRequestId(app);
  installIdempotency(app);
  installErrorHandling(app);

  app.register(cors, {
    // Exact-match allow list; an empty list denies every cross-origin request.
    origin: (origin, callback) =>
      callback(null, origin !== undefined && config.corsOrigins.includes(origin)),
  });
  app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
  });
  app.register(swagger, {
    openapi: { info: { title: `${APP_NAME} API`, version: pkg.version } },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, { routePrefix: '/api/v1/docs' });

  app.register(
    async (v1) => {
      v1.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
      v1.register(healthRoutes, { config });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
