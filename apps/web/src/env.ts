import { z } from 'zod';

const isHttpUrl = (value: string) => {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
};

const envSchema = z.object({
  VITE_APP_ENV: z.enum(['operational', 'rnd', 'demo']).default('operational'),
  VITE_API_URL: z
    .string()
    .refine(isHttpUrl, 'must be an http: or https: URL, e.g. https://api.example.com')
    .default('http://localhost:3000')
    .transform((url) => url.replace(/\/+$/, '')),
  // The Supabase project URL and its anon (publishable) key. The key is public by design: it only
  // identifies the project, and row-level security plus the API do the protecting (spec 3.A).
  VITE_SUPABASE_URL: z
    .string()
    .refine(isHttpUrl, 'must be an http: or https: URL, e.g. https://<project-ref>.supabase.co'),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .trim()
    .min(1, 'is required (the project’s anon or publishable key)'),
});

export type AppEnv = z.infer<typeof envSchema>['VITE_APP_ENV'];

export interface Env {
  appEnv: AppEnv;
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Fails loudly at start-up when a build is misconfigured, instead of failing later in a fetch. */
export function parseEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment variables:\n${problems.join('\n')}`);
  }
  return {
    appEnv: parsed.data.VITE_APP_ENV,
    apiUrl: parsed.data.VITE_API_URL,
    supabaseUrl: parsed.data.VITE_SUPABASE_URL,
    supabaseAnonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
  };
}
