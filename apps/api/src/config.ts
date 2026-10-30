import { z } from 'zod';
import { featureEnvShape, toFeatures, type Features } from './features';

const isBareOrigin = (value: string) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

const originSchema = z
  .string()
  .refine(isBareOrigin, 'must be a bare origin such as https://app.example.com');

const MAX_TRUST_PROXY = 5;

const httpsUrl = z.url().refine((v) => v.startsWith('https://'), 'must be an https URL');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['operational', 'rnd']).default('operational'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Exact origins only. Empty means no cross-origin access; "*" fails the origin check.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(originSchema)),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  // Number of reverse proxies in front of the API. 0 trusts nothing, so X-Forwarded-For is ignored.
  // Capped: a value above the real hop count lets clients spoof their IP and defeats the rate limit.
  TRUST_PROXY: z
    .string()
    .regex(/^(0|[1-9]\d*)$/, 'must be a non-negative whole number of proxy hops, e.g. 0 or 1')
    .refine((v) => Number(v) <= MAX_TRUST_PROXY, `must be at most ${MAX_TRUST_PROXY}`)
    .default('0')
    .transform(Number),
  // Accounts (spec 3.A). All three are required when NODE_ENV=production (see loadConfig).
  // Supabase Auth's JWKS endpoint, e.g. https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
  SUPABASE_JWKS_URL: httpsUrl.optional(),
  // The `iss` of access tokens, e.g. https://<project-ref>.supabase.co/auth/v1
  SUPABASE_JWT_ISSUER: httpsUrl.optional(),
  // Connection string of the app_<schema> login (not the admin). Never logged.
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string')
    .optional(),
  ...featureEnvShape,
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  /** Null when not configured: sign-in then rejects every token (fail closed). */
  supabase: { jwksUrl: string; issuer: string } | null;
  /** Null when not configured: account routes answer 503. */
  databaseUrl: string | null;
  appEnv: 'operational' | 'rnd';
  port: number;
  host: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  corsOrigins: string[];
  rateLimitPerMinute: number;
  trustProxy: number;
  features: Features;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production') {
    const missing = (['SUPABASE_JWKS_URL', 'SUPABASE_JWT_ISSUER', 'DATABASE_URL'] as const).filter(
      (name) => !e[name],
    );
    if (missing.length > 0) {
      throw new ConfigError(missing.map((name) => `${name}: required when NODE_ENV=production`));
    }
  }
  if (Boolean(e.SUPABASE_JWKS_URL) !== Boolean(e.SUPABASE_JWT_ISSUER)) {
    throw new ConfigError(['SUPABASE_JWKS_URL and SUPABASE_JWT_ISSUER: set both or neither']);
  }
  return {
    nodeEnv: e.NODE_ENV,
    supabase:
      e.SUPABASE_JWKS_URL && e.SUPABASE_JWT_ISSUER
        ? { jwksUrl: e.SUPABASE_JWKS_URL, issuer: e.SUPABASE_JWT_ISSUER }
        : null,
    databaseUrl: e.DATABASE_URL ?? null,
    appEnv: e.APP_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    corsOrigins: e.CORS_ORIGINS,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    trustProxy: e.TRUST_PROXY,
    features: toFeatures(e),
  };
}
