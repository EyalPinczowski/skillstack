import { z } from 'zod';
import { loadFeatures, type Features } from './features';

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

const envSchema = z.object({
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
  // Set behind a reverse proxy (Render) so rate limits see the client IP, not the proxy's.
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});

export interface Config {
  appEnv: 'operational' | 'rnd';
  port: number;
  host: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  corsOrigins: string[];
  rateLimitPerMinute: number;
  trustProxy: boolean;
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
  return {
    appEnv: e.APP_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    corsOrigins: e.CORS_ORIGINS,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    trustProxy: e.TRUST_PROXY === 'true',
    features: loadFeatures(env),
  };
}
