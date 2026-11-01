/**
 * The final gates must hold even when redaction itself has a bug. Here `redactPii` is replaced
 * by a pass-through, so only `assertNoPii` stands between the input and the model.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./redact', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, redactPii: (text: string) => ({ text, count: 0 }) };
});

import { buildPracticePrompt, sanitizeUserText } from './prompt';
import { PiiLeakError } from './redact';

const task = { title: 'Practice', plannedMinutes: 20, howToSteps: [] };

describe('fail-closed gates when redaction misses something', () => {
  it('sanitizeUserText throws instead of returning a leaking turn', () => {
    expect(() => sanitizeUserText('mail me at jane@example.com')).toThrow(PiiLeakError);
    expect(() => sanitizeUserText('I am Jane', { knownIdentifiers: ['Jane'] })).toThrow(
      PiiLeakError,
    );
    expect(sanitizeUserText('all good').text).toBe('all good');
  });

  it('buildPracticePrompt throws for a leak in any field', () => {
    expect(() => buildPracticePrompt({ task, jobDescription: 'Recruiter: hr@acme.io' })).toThrow(
      PiiLeakError,
    );
    expect(() => buildPracticePrompt({ task, nextFocus: 'call 050-123-4567' })).toThrow(
      PiiLeakError,
    );
    expect(() =>
      buildPracticePrompt({ task: { ...task, title: 'Ask Jane' } }, { knownIdentifiers: ['Jane'] }),
    ).toThrow(PiiLeakError);
  });
});
