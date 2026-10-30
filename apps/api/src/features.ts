import { z } from 'zod';

/** Feature flags (spec 12.3). Everything ships off; an env var can only turn a flag on. */
export const featureNames = ['notifications', 'sharing', 'offline', 'pushNotifications'] as const;

export type FeatureName = (typeof featureNames)[number];
export type Features = Record<FeatureName, boolean>;

/** The one rule for boolean env vars: the literal strings "true" or "false", nothing else. */
export const booleanString = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'], { error: 'must be exactly "true" or "false"' })
    .default(fallback)
    .transform((v) => v === 'true');

export const featureEnvShape = {
  FEATURE_NOTIFICATIONS: booleanString('false'),
  FEATURE_SHARING: booleanString('false'),
  FEATURE_OFFLINE: booleanString('false'),
  FEATURE_PUSH_NOTIFICATIONS: booleanString('false'),
};

export function toFeatures(e: z.infer<z.ZodObject<typeof featureEnvShape>>): Features {
  return {
    notifications: e.FEATURE_NOTIFICATIONS,
    sharing: e.FEATURE_SHARING,
    offline: e.FEATURE_OFFLINE,
    pushNotifications: e.FEATURE_PUSH_NOTIFICATIONS,
  };
}
