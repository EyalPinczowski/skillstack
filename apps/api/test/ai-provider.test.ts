import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import {
  assertProviderAllowed,
  PaidProviderRefusedError,
  type AIProvider,
  type CostTier,
} from '../src/ai/provider';
import { createAIRegistry } from '../src/ai/registry';

const fake = (id: string, costTier: CostTier): AIProvider => ({
  id,
  label: id,
  maxContextChars: 1000,
  costTier,
  generate: vi.fn(async () => ({ text: 'x' })),
});

describe('AIProvider guard (spec 9: a paid provider registered in tests is refused)', () => {
  it('refuses a paid provider while the setting is off (the default)', () => {
    const registry = createAIRegistry();
    expect(() => registry.register(fake('paid-one', 'paid'))).toThrow(PaidProviderRefusedError);
    expect(registry.list()).toEqual([]);
    expect(registry.get('paid-one')).toBeUndefined();
  });

  it('refuses a paid provider when the setting is explicitly false', () => {
    const registry = createAIRegistry({ allowPaid: false });
    expect(() => registry.register(fake('paid-one', 'paid'))).toThrow(
      /paid providers are disabled/,
    );
  });

  it('accepts a free provider with the default settings', () => {
    const registry = createAIRegistry();
    const free = fake('free-one', 'free');
    registry.register(free);
    expect(registry.list()).toEqual([free]);
    expect(registry.get('free-one')).toBe(free);
  });

  it('accepts a paid provider only when the setting is on', () => {
    const registry = createAIRegistry({ allowPaid: true });
    const paid = fake('paid-one', 'paid');
    registry.register(paid);
    expect(registry.list()).toEqual([paid]);
  });

  it('fails closed on a provider with a missing or unknown cost tier', () => {
    const registry = createAIRegistry({ allowPaid: false });
    const unknown = { id: 'odd', generate: vi.fn() } as unknown as AIProvider;
    expect(() => registry.register(unknown)).toThrow(PaidProviderRefusedError);
    const wrong = { ...fake('odd2', 'free'), costTier: 'FREE' } as unknown as AIProvider;
    expect(() => assertProviderAllowed(wrong, { allowPaid: false })).toThrow(
      PaidProviderRefusedError,
    );
    expect(() => assertProviderAllowed(wrong, { allowPaid: true })).toThrow(
      PaidProviderRefusedError,
    );
  });

  it('keeps refusing a provider that turns paid after it registered', () => {
    const registry = createAIRegistry();
    const mutable = {
      id: 'sneaky',
      label: 'sneaky',
      maxContextChars: 1000,
      costTier: 'free' as CostTier,
      generate: vi.fn(),
    };
    registry.register(mutable);
    mutable.costTier = 'paid';
    expect(registry.list()).toEqual([]);
    expect(registry.get('sneaky')).toBeUndefined();
  });

  it('keeps priority order and rejects a duplicate id', () => {
    const registry = createAIRegistry();
    registry.register(fake('a', 'free'));
    registry.register(fake('b', 'free'));
    expect(registry.list().map((p) => p.id)).toEqual(['a', 'b']);
    expect(() => registry.register(fake('a', 'free'))).toThrow(/already registered/);
  });

  it('never calls generate while registering or listing', () => {
    const registry = createAIRegistry();
    const free = fake('free-one', 'free');
    registry.register(free);
    registry.list();
    registry.get('free-one');
    expect(free.generate).not.toHaveBeenCalled();
  });
});

describe('AI settings in the config', () => {
  it('are off by default', () => {
    const config = loadConfig({});
    expect(config.ai.allowPaid).toBe(false);
    expect(config.ai.providerOrder).toEqual([]);
    expect(config.features.aiOverview).toBe(false);
  });

  it('turn on only with the literal "true"', () => {
    const config = loadConfig({
      AI_ALLOW_PAID: 'true',
      AI_PAID_MONTHLY_CAP_USD: '5',
      FEATURE_AI_OVERVIEW: 'true',
    });
    expect(config.ai.allowPaid).toBe(true);
    expect(config.features.aiOverview).toBe(true);
    expect(() => loadConfig({ AI_ALLOW_PAID: 'yes' })).toThrow(/AI_ALLOW_PAID: must be exactly/);
  });
});
