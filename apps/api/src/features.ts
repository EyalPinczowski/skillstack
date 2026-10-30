/** Feature flags (spec 12.3). Everything ships off; an env var can only turn a flag on. */
export const featureNames = ['notifications', 'sharing', 'offline', 'pushNotifications'] as const;

export type FeatureName = (typeof featureNames)[number];
export type Features = Record<FeatureName, boolean>;

const envName = (name: FeatureName) =>
  `FEATURE_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;

export function loadFeatures(env: NodeJS.ProcessEnv = process.env): Features {
  const features = {} as Features;
  for (const name of featureNames) {
    const value = env[envName(name)];
    features[name] = value === 'true' || value === '1';
  }
  return features;
}
