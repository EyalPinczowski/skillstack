import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { APP_NAME } from '@skillstack/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import pkg from '../package.json' with { type: 'json' };
import type { Config } from './config';
import { createDatabase, type Database } from './db/database';
import { installErrorHandling } from './errors';
import { accountRoutes } from './modules/accounts/routes';
import {
  createSupabaseVerifierFromUrl,
  rejectAllVerifier,
  type TokenVerifier,
} from './modules/accounts/token-verifier';
import { healthRoutes } from './modules/health/routes';
import { planRoutes } from './modules/plans/routes';
import { installIdempotency } from './plugins/idempotency';
import { generateRequestId, installRequestId } from './plugins/request-id';
import { installSecurityHeaders } from './plugins/security-headers';

const HEALTH_URL = '/api/v1/health';

/** A plugin that shares the root scope, so its hooks apply to every route (like fastify-plugin). */
const sharedScope = (fn: (instance: FastifyInstance) => void) =>
  Object.assign(async (instance: FastifyInstance) => fn(instance), {
    [Symbol.for('skip-override')]: true,
  });

/** Replaceable collaborators, so tests and local development can inject fakes. */
export interface AppDeps {
  /** Defaults to Supabase verification from config, or to rejecting every token when unconfigured. */
  verifier?: TokenVerifier;
  /** Defaults to a pool from config.databaseUrl, or to none (account routes answer 503). */
  db?: Database | null;
}

/** Builds the app without listening, so tests can use `app.inject`. */
export function buildApp(config: Config, deps: AppDeps = {}) {
  const verifier =
    deps.verifier ??
    (config.supabase ? createSupabaseVerifierFromUrl(config.supabase) : rejectAllVerifier);
  const db =
    deps.db !== undefined
      ? deps.db
      : config.databaseUrl
        ? createDatabase({ connectionString: config.databaseUrl, appEnv: config.appEnv })
        : null;

  const app = Fastify({
    // Default request logging has no headers or body; redact is a second line of defence.
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
    },
    genReqId: generateRequestId,
    requestIdHeader: false,
    // NEEDS CHECK (deployment branch): entries written as "[2001:db8::1]" or "1.2.3.4:80" are keyed
    // separately from the plain address, so verify the format Render writes with the hop count.
    // Trust exactly `trustProxy` hops, so request.ip is the address the nearest trusted proxy
    // saw. 0 trusts nothing, so X-Forwarded-For cannot be spoofed. A function, because this
    // Fastify version fails closed on a bare number and would ignore the hop count.
    trustProxy: (_address: string, hop: number) => hop < config.trustProxy,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Order matters because hooks run in registration order: the request id first so every
  // response carries it, then CORS and the rate limit so that errors thrown by any later hook
  // (and 404s) still get CORS headers and still count against the limit.
  installRequestId(app);
  installErrorHandling(app);

  app.register(cors, {
    // Exact-match allow list; an empty list denies every cross-origin request.
    origin: (origin, callback) =>
      callback(null, origin !== undefined && config.corsOrigins.includes(origin)),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'retry-after'],
  });
  // global: false, because the plugin's own per-route hook would run after the app-level hooks.
  app.register(rateLimit, {
    global: false,
    // Health is exempt so a client behind the same proxy IP cannot starve the keep-warm ping.
    allowList: (request) => request.method === 'GET' && request.routeOptions.url === HEALTH_URL,
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
  });
  app.register(
    sharedScope((instance) => {
      instance.addHook('onRequest', instance.rateLimit());
    }),
  );
  app.register(
    sharedScope((instance) => {
      installIdempotency(instance);
      installSecurityHeaders(instance);
    }),
  );

  app.register(swagger, {
    openapi: {
      info: { title: `${APP_NAME} API`, version: pkg.version },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, { routePrefix: '/api/v1/docs' });

  app.register(
    async (v1) => {
      v1.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
      v1.register(healthRoutes, { config });
      v1.register(accountRoutes, { verifier, db });
      v1.register(planRoutes, { verifier, db });
    },
    { prefix: '/api/v1' },
  );

  // An injected database belongs to whoever created it; only a pool built here is closed here.
  if (db && deps.db === undefined) {
    app.addHook('onClose', async () => {
      await db.close();
    });
  }

  return app;
}
