import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface CatalogItem {
  id: string;
  type: string;
  url: string | null;
  price: number | null;
  url_verified: boolean;
  price_verified: boolean;
}

const items = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../data/catalog/catalog.json', import.meta.url)),
      'utf8',
    ),
  ) as { items: CatalogItem[] }
).items;

describe('catalog verification flags', () => {
  it('only marks a url verified when it is an https url', () => {
    const bad = items.filter((i) => i.url_verified && !i.url?.startsWith('https://'));
    expect(bad.map((i) => i.id)).toEqual([]);
  });

  it('never marks a missing price (check price) as verified', () => {
    const bad = items.filter((i) => i.price === null && i.price_verified);
    expect(bad.map((i) => i.id)).toEqual([]);
  });
});
