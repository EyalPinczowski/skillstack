import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { loadPodcasts, PODCASTS, pickPodcast, type PodcastEntry } from './podcasts';

const read = (rel: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as unknown;

const taxonomy = (
  read('../../../data/catalog/skills.json') as { skills: { id: string }[] }
).skills.map((s) => s.id);
const rawCatalog = read('../../../data/podcasts/podcasts.json') as {
  podcasts: Record<string, unknown>[];
};

const entry = (id: string, skills: string[]): PodcastEntry => ({
  id,
  title: `Show ${id}`,
  publisher: 'Pub',
  official_url: `https://example.test/${id}`,
  spotify_url: `https://open.spotify.com/show/${id}`,
  skills,
  skill_link: 'Ideas around the skill.',
  one_line: 'A line.',
  themes: ['ideas'],
  checked_on: '2026-11-01',
  free: 'unverified',
  notes: '',
});

const catalogWith = (podcasts: unknown[]) => ({ version: 1, updated: '2026-11-01', podcasts });

describe('loadPodcasts', () => {
  it('accepts the shipped catalog and checks every skill id against the taxonomy', () => {
    const list = loadPodcasts(rawCatalog, taxonomy);
    expect(list.length).toBe(rawCatalog.podcasts.length);
    expect(PODCASTS.length).toBe(list.length);
  });

  it('ships only https Spotify show links, unverified prices and unique ids', () => {
    for (const p of PODCASTS) {
      expect(p.spotify_url).toMatch(/^https:\/\/open\.spotify\.com\/show\//);
      expect(p.official_url.startsWith('https://')).toBe(true);
      expect(p.free).toBe('unverified');
    }
    expect(new Set(PODCASTS.map((p) => p.id)).size).toBe(PODCASTS.length);
  });

  it('rejects a spotify_url that is not https', () => {
    const bad = { ...entry('a', ['sql']), spotify_url: 'http://open.spotify.com/show/a' };
    expect(() => loadPodcasts(catalogWith([bad]))).toThrow();
  });

  it('rejects a spotify_url that is not a Spotify show link', () => {
    const bad = { ...entry('a', ['sql']), spotify_url: 'https://example.test/show/a' };
    expect(() => loadPodcasts(catalogWith([bad]))).toThrow();
  });

  it('rejects a skill id that is not in the taxonomy', () => {
    const bad = entry('a', ['not-a-skill']);
    expect(() => loadPodcasts(catalogWith([bad]), taxonomy)).toThrow(/not in the taxonomy/);
    expect(() => loadPodcasts(catalogWith([entry('a', ['python'])]), taxonomy)).not.toThrow();
  });

  it('rejects a duplicate id', () => {
    const list = [entry('a', ['python']), entry('a', ['git'])];
    expect(() => loadPodcasts(catalogWith(list))).toThrow(/Duplicate podcast id: a/);
  });

  it('rejects an entry with no skills', () => {
    expect(() => loadPodcasts(catalogWith([entry('a', [])]))).toThrow();
  });
});

describe('pickPodcast', () => {
  const list = [entry('c', ['git']), entry('a', ['git', 'python']), entry('b', ['python'])];
  const DAY = '2026-11-02';

  it('is deterministic: the same input gives the same show', () => {
    const args = { userSkillIds: ['python'], date: DAY, podcasts: list };
    expect(pickPodcast(args)).toEqual(pickPodcast({ ...args }));
  });

  it('returns null when no show matches a plan skill, and for an empty skill list', () => {
    expect(pickPodcast({ userSkillIds: ['sql'], date: DAY, podcasts: list })).toBeNull();
    expect(pickPodcast({ userSkillIds: [], date: DAY, podcasts: list })).toBeNull();
    expect(pickPodcast({ userSkillIds: ['python'], date: DAY, podcasts: [] })).toBeNull();
  });

  it('only picks shows that match the plan skills', () => {
    for (let i = 0; i < 10; i++) {
      const p = pickPodcast({ userSkillIds: ['git'], date: addDays(DAY, i), podcasts: list });
      expect(['a', 'c']).toContain(p?.id);
    }
  });

  it('rotates: a different show every day and never the same one on consecutive days', () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(
        pickPodcast({ userSkillIds: ['git', 'python'], date: addDays(DAY, i), podcasts: list })!.id,
      );
    }
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('rotates across a month and year boundary too', () => {
    const a = pickPodcast({ userSkillIds: ['git'], date: '2026-12-31', podcasts: list })!;
    const b = pickPodcast({ userSkillIds: ['git'], date: '2027-01-01', podcasts: list })!;
    expect(a.id).not.toBe(b.id);
  });

  it('shows the single matching show every day when only one fits', () => {
    const one = [entry('only', ['git'])];
    for (let i = 0; i < 3; i++) {
      expect(pickPodcast({ userSkillIds: ['git'], date: addDays(DAY, i), podcasts: one })?.id).toBe(
        'only',
      );
    }
  });

  it('does not repeat the last show in the history when another fits', () => {
    const plain = pickPodcast({ userSkillIds: ['git', 'python'], date: DAY, podcasts: list })!;
    const next = pickPodcast({
      userSkillIds: ['git', 'python'],
      date: DAY,
      history: ['x', plain.id],
      podcasts: list,
    })!;
    expect(next.id).not.toBe(plain.id);
  });

  it('works on the shipped catalog', () => {
    const p = pickPodcast({ userSkillIds: ['python'], date: DAY });
    expect(p?.skills).toContain('python');
  });
});
