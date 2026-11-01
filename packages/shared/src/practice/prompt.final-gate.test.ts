/**
 * The whole-text gate in `buildPracticePrompt` covers what the per-field checks do not see,
 * such as the fixed wording. Here a persona is replaced by one that carries a contact detail.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./personas', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const leaky = { id: 'generic_coach', label: 'Practice', system: 'Reach us at help@example.com' };
  return { ...original, personaForKind: () => leaky };
});

import { buildPracticePrompt } from './prompt';
import { PiiLeakError } from './redact';

describe('final gate on the assembled prompt', () => {
  it('throws when the assembled text contains a contact detail', () => {
    expect(() =>
      buildPracticePrompt({ task: { title: 'x', plannedMinutes: 5, howToSteps: [] } }),
    ).toThrow(PiiLeakError);
  });
});
