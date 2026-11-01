import type { AIConfig } from '../../config';
import type { AIProvider } from '../provider';
import { createFakeProvider } from './fake';

/**
 * The one place that maps a provider id from `AI_PROVIDERS` to its implementation. A provider is
 * one file plus one entry here (and its id in `PROVIDER_IDS` in config.ts). An id with no
 * entry yet is left out and reported as not configured.
 */
export function createConfiguredProviders(
  ai: Pick<AIConfig, 'providerOrder'>,
  appEnv: string,
): AIProvider[] {
  const factories: Record<string, (() => AIProvider) | undefined> = {
    fake: () => createFakeProvider({ appEnv }),
  };
  return ai.providerOrder.flatMap((id) => {
    const factory = factories[id];
    return factory ? [factory()] : [];
  });
}
