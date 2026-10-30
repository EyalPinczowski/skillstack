import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core on the rendered page and fails with a readable list. Colour contrast is left to the
 * design tokens' own contrast table because jsdom has no layout or computed colours to measure.
 */
export async function expectNoAxeViolations(root: Element = document.body) {
  const results = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.html.slice(0, 80)).join(' | ')}`,
  );
  expect(summary).toEqual([]);
}
