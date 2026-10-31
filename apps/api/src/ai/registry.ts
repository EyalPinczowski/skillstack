import {
  assertProviderAllowed,
  DEFAULT_AI_SETTINGS,
  type AIProvider,
  type AISettings,
} from './provider';

/**
 * The providers the app knows about, in priority order (the first is tried first; automatic
 * fallback arrives with the first implementation in v0.3). The guard runs at registration and
 * again whenever providers are read, so a provider whose tier changed later is still refused.
 */
export function createAIRegistry(settings: AISettings = DEFAULT_AI_SETTINGS) {
  const providers: AIProvider[] = [];

  const list = (): AIProvider[] =>
    providers.filter((p) => {
      try {
        assertProviderAllowed(p, settings);
        return true;
      } catch {
        return false;
      }
    });

  return {
    /** Throws `PaidProviderRefusedError` for a paid provider while paid providers are off. */
    register(provider: AIProvider): void {
      assertProviderAllowed(provider, settings);
      if (providers.some((p) => p.id === provider.id)) {
        throw new Error(`AI provider "${provider.id}" is already registered.`);
      }
      providers.push(provider);
    },

    /** The registered providers that pass the guard now, in priority order. */
    list,

    get: (id: string): AIProvider | undefined => list().find((p) => p.id === id),
  };
}

export type AIRegistry = ReturnType<typeof createAIRegistry>;
