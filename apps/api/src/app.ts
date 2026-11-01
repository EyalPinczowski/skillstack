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
import { createAIUsageStore, type AIUsageStore } from './ai/budget';
import { createAICache, type AICache } from './ai/cache';
import { createAIGateway, type AIGateway } from './ai/gateway';
import type { AIProvider } from './ai/provider';
import { createConfiguredProviders } from './ai/providers';
import { createAIRegistry } from './ai/registry';
import type { Config } from './config';
import { createDatabase, type Database } from './db/database';
import { installErrorHandling } from './errors';
import {
  createSupabaseAuthAdmin,
  noopAuthAdminForRnd,
  unconfiguredAuthAdmin,
  type AuthAdmin,
} from './modules/accounts/auth-admin';
import { aiRoutes } from './modules/ai/routes';
import { accountRoutes } from './modules/accounts/routes';
import {
  createSupabaseVerifierFromUrl,
  rejectAllVerifier,
  type TokenVerifier,
} from './modules/accounts/token-verifier';
import { createDatabaseProbe } from './modules/health/probe';
import { healthRoutes } from './modules/health/routes';
import { planRoutes } from './modules/plans/routes';
import { taskRoutes } from './modules/tasks/routes';
import { installIdempotency } from './plugins/idempotency';
import { generateRequestId, installRequestId } from './plugins/request-id';
import { installSecurityHeaders, transformSwaggerCsp } from './plugins/security-headers';

declare module 'fastify' {
  interface FastifyInstance {
    /** The AI gateway: the only way to call a model (plan 3.2). */
    aiGateway: AIGateway;
  }
}

/** Used when there is no database: the routes answer 503 before it is ever reached. */
const unavailableAIUsage: AIUsageStore = {
  async reserveUser() {
    throw new Error('no database');
  },
  async noteAvoided() {},
  async reserveProvider() {
    throw new Error('no database');
  },
  async snapshot() {
    throw new Error('no database');
  },
};

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
  /** The clock for plan-local dates (day start/end, rollover). Defaults to the system time. */
  now?: () => Date;
  /** Defaults to Supabase from config on operational (fails closed without a key), and to a no-op on R&D. */
  authAdmin?: AuthAdmin;
  /** Tests and local development: replace the AI pieces. Defaults come from `config.ai`. */
  ai?: {
    /** Instead of the providers named in AI_PROVIDERS. Each still passes the paid guard. */
    providers?: AIProvider[];
    usage?: AIUsageStore;
    cache?: AICache | null;
  };
  /** Tests only: where log lines go, so they can be inspected. Defaults to stdout. */
  logStream?: { write(line: string): void };
}

/** Builds the app without listening, so tests can use `app.inject`. */
export function buildApp(config: Config, deps: AppDeps = {}) {
  const verifier =
    deps.verifier ??
    (config.supabase ? createSupabaseVerifierFromUrl(config.supabase) : rejectAllVerifier);
  const authAdmin =
    deps.authAdmin ??
    (config.appEnv === 'rnd'
      ? // Shared Auth: R&D never calls the admin API, even if a key were passed in by mistake.
        noopAuthAdminForRnd
      : config.supabaseAdmin
        ? createSupabaseAuthAdmin({
            baseUrl: config.supabaseAdmin.url,
            serviceRoleKey: config.supabaseAdmin.serviceRoleKey,
          })
        : unconfiguredAuthAdmin);
  const db =
    deps.db !== undefined
      ? deps.db
      : config.databaseUrl
        ? createDatabase({ connectionString: config.databaseUrl, appEnv: config.appEnv })
        : null;

  // AI: no provider is configured by default, and then everything reports `configured: false`.
  const aiRegistry = createAIRegistry(config.ai);
  for (const provider of deps.ai?.providers ??
    createConfiguredProviders(config.ai, config.appEnv)) {
    aiRegistry.register(provider);
  }
  const aiUsage = deps.ai?.usage ?? (db ? createAIUsageStore(db, deps.now) : unavailableAIUsage);
  const aiCache =
    deps.ai?.cache !== undefined ? deps.ai.cache : db ? createAICache(db, deps.now) : null;

  const app = Fastify({
    // Default request logging has no headers or body; redact is a second line of defence.
    logger: {
      level: config.logLevel,
      ...(deps.logStream ? { stream: deps.logStream } : {}),
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        // Provider keys must never be logged, wherever a future log call puts them.
        'apiKey',
        '*.apiKey',
        '*.api_key',
        'headers.authorization',
        '*.headers.authorization',
      ],
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

  const aiGateway = createAIGateway({
    registry: aiRegistry,
    config: config.ai,
    usage: aiUsage,
    cache: aiCache,
    now: deps.now,
    log: app.log,
  });
  app.decorate('aiGateway', aiGateway);

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
  app.register(swaggerUi, {
    routePrefix: '/api/v1/docs',
    staticCSP: true,
    transformStaticCSP: transformSwaggerCsp,
  });

  app.register(
    async (v1) => {
      v1.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
      v1.register(healthRoutes, { config, probe: createDatabaseProbe(db) });
      v1.register(accountRoutes, { verifier, db, authAdmin });
      v1.register(planRoutes, { verifier, db, now: deps.now });
      v1.register(taskRoutes, { verifier, db, now: deps.now });
      v1.register(aiRoutes, {
        verifier,
        db,
        gateway: aiGateway,
        usage: aiUsage,
        userCaps: config.ai.userCaps,
      });
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
