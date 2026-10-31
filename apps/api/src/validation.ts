import type { z } from 'zod';

/**
 * PostgreSQL cannot store U+0000 in text or jsonb, and the driver answers with an error that
 * would surface as a 500 (v0.1 review finding 11). The API refuses it up front with a 422.
 * The error handler recognises this exact message and answers 422 instead of 400.
 */
export const NO_NUL_MESSAGE = 'Text cannot contain a NUL character (U+0000).';

/** True when a string, an object key or any value nested in `value` contains U+0000. */
export function containsNul(value: unknown): boolean {
  // An explicit stack: no recursion depth limit to hit, and no regular expression.
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      if (current.includes('\u0000')) return true;
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (typeof current === 'object' && current !== null) {
      for (const [key, nested] of Object.entries(current)) {
        if (key.includes('\u0000')) return true;
        pending.push(nested);
      }
    }
  }
  return false;
}

/**
 * The one shared refinement: put it on every body, params or query schema that takes free text.
 * It checks the whole parsed value, nested fields included, so adding a text field to a schema
 * that already has it needs no further change.
 */
export function noNulCharacters<T extends z.ZodType>(schema: T): T {
  return schema.refine((value) => !containsNul(value), { message: NO_NUL_MESSAGE });
}
