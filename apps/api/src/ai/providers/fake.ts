import type { AIProvider, AIResponse } from '../provider';
import type { SafeAIRequest } from '../safe-request';

export class FakeProviderRefusedError extends Error {
  constructor() {
    super('The fake AI provider can only run when APP_ENV=rnd.');
    this.name = 'FakeProviderRefusedError';
  }
}

export interface FakeProviderOptions {
  /** The environment it runs in. Anything but `rnd` is refused (fail closed). */
  appEnv: string;
  id?: string;
  /** Receives every request the provider is asked to answer (tests inspect what would be sent). */
  captured?: SafeAIRequest[];
  /** Overrides the canned answer. */
  respond?: (request: SafeAIRequest) => string | Promise<string>;
}

const FEEDBACK_JSON = JSON.stringify({
  score: 7,
  strengths: 'Clear structure and a concrete example.',
  improve: 'Quantify the result.',
  next_focus: 'Open with the outcome.',
});

/**
 * A deterministic, offline provider for R&D and tests. It never makes a network call and never
 * repeats what it was sent. Refused on the operational environment, where it would pass canned
 * text off as a model.
 */
export function createFakeProvider(options: FakeProviderOptions): AIProvider {
  if (options.appEnv !== 'rnd') throw new FakeProviderRefusedError();
  return {
    id: options.id ?? 'fake',
    label: 'Fake provider (R&D)',
    costTier: 'free',
    maxContextChars: 12_000,
    async generate(request): Promise<AIResponse> {
      options.captured?.push(request);
      const text = options.respond
        ? await options.respond(request)
        : request.json
          ? FEEDBACK_JSON
          : 'This is a canned reply from the fake provider.';
      return { text, model: 'fake-1' };
    },
  };
}
