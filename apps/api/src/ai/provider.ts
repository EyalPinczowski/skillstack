/**
 * The AIProvider seam (spec 12.3, ADR 004 and 012). This is only the contract and the guard:
 * v0.2 ships no implementation, makes no network call and holds no key. Provider
 * implementations (GitHub Models, Groq, Gemini) arrive in v0.3 as one new file each.
 *
 * Privacy rule for every caller: a request carries task metadata only, never a name, email,
 * phone number or link of the user.
 */

/** `paid` providers are refused unless the owner enables them explicitly (spec 12.2). */
export type CostTier = 'free' | 'paid';

export interface AIRequest {
  /** What the text is for, e.g. `day-overview`. Used for caching and the usage meter later. */
  purpose: string;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
}

export interface AIResponse {
  text: string;
  /** The model that answered, as the provider reports it. */
  model?: string;
}

export interface AIProvider {
  /** A stable lower-case id such as `github-models`. */
  readonly id: string;
  readonly costTier: CostTier;
  generate(request: AIRequest): Promise<AIResponse>;
}

/** The settings the guard reads. Everything is off unless switched on. */
export interface AISettings {
  /** Lets `paid` providers register and run. Default false. */
  allowPaid: boolean;
}

export const DEFAULT_AI_SETTINGS: AISettings = { allowPaid: false };

export class PaidProviderRefusedError extends Error {
  constructor(public readonly providerId: string) {
    super(
      `AI provider "${providerId}" is not free (or does not declare a cost tier) and paid providers are disabled.`,
    );
    this.name = 'PaidProviderRefusedError';
  }
}

/**
 * Throws unless the provider may be used under `settings`. Fails closed: anything that is not
 * exactly `free` counts as paid, so a provider that forgets to declare its tier is refused.
 */
export function assertProviderAllowed(provider: AIProvider, settings: AISettings): void {
  if (provider.costTier === 'free') return;
  if (provider.costTier === 'paid' && settings.allowPaid === true) return;
  throw new PaidProviderRefusedError(provider.id);
}
