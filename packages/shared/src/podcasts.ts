import { z } from 'zod';
import { diffDays, type LocalDate } from './dates';
import podcastData from '../../../data/podcasts/podcasts.json';

/**
 * The "Idea of the day" podcast (briefing line only). The shows are about the ideas around a
 * skill, they do not teach it. The list is curated in `data/podcasts/podcasts.json` (rules in
 * its README): every link was checked on `checked_on`, and price is `unverified` unless marked.
 * Nothing about the user leaves the app: the pick is a pure function of skill ids and a date.
 */

const HttpsUrl = z
  .url()
  .refine((u) => u.startsWith('https://'), { message: 'Expected an https URL' });

export const PodcastEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Expected a lowercase slug'),
  title: z.string().min(1),
  publisher: z.string().min(1),
  official_url: HttpsUrl,
  spotify_url: HttpsUrl.refine((u) => u.startsWith('https://open.spotify.com/show/'), {
    message: 'Expected an https://open.spotify.com/show/ link',
  }),
  skills: z.array(z.string().min(1)).min(1),
  skill_link: z.string().min(1),
  /** Null when the show's official page has no description sentence (nothing is made up). */
  one_line: z.string().min(1).nullable(),
  themes: z.array(z.string().min(1)),
  checked_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** `unverified` unless the price was checked; the app never claims a show is free. */
  free: z.enum(['unverified', 'free', 'not_free']),
  notes: z.string(),
});

export const PodcastCatalogSchema = z.object({
  version: z.number().int().min(1),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  podcasts: z.array(PodcastEntrySchema),
});

export type PodcastEntry = z.infer<typeof PodcastEntrySchema>;

/** The part of a podcast the briefing carries. */
export const BriefingPodcastSchema = z.object({
  title: z.string(),
  publisher: z.string(),
  skillLink: z.string(),
  oneLine: z.string().nullable(),
  spotifyUrl: z.string(),
});
export type BriefingPodcast = z.infer<typeof BriefingPodcastSchema>;

/**
 * Validates a catalog. `taxonomyIds` is the set of skill ids from `data/catalog/skills.json`;
 * pass it to reject skill ids the taxonomy does not have. Throws on a duplicate id too.
 */
export function loadPodcasts(raw: unknown, taxonomyIds?: Iterable<string>): PodcastEntry[] {
  const { podcasts } = PodcastCatalogSchema.parse(raw);
  const known = taxonomyIds ? new Set(taxonomyIds) : null;
  const seen = new Set<string>();
  for (const p of podcasts) {
    if (seen.has(p.id)) throw new Error(`Duplicate podcast id: ${p.id}`);
    seen.add(p.id);
    const missing = known ? p.skills.filter((s) => !known.has(s)) : [];
    if (missing.length > 0) {
      throw new Error(`Podcast ${p.id} has skill ids not in the taxonomy: ${missing.join(', ')}`);
    }
  }
  return podcasts;
}

/** The shipped catalog (structure checked on load; the taxonomy check runs in the tests). */
export const PODCASTS: PodcastEntry[] = loadPodcasts(podcastData);

export interface PickPodcastInput {
  /** The skill ids of the user's plan. */
  userSkillIds: readonly string[];
  /** The plan-local date. No clock is read here. */
  date: LocalDate;
  /** Ids shown on earlier days, oldest first. The last one is not repeated if another fits. */
  history?: readonly string[];
  /** Defaults to the shipped catalog. */
  podcasts?: readonly PodcastEntry[];
}

const EPOCH: LocalDate = '2000-01-01';

/**
 * One podcast for the day, or null when none matches a plan skill (no filler). Deterministic:
 * the matching shows, sorted by id, are rotated by the day number, so the pick changes every
 * day and never repeats the previous day's show while more than one fits.
 */
export function pickPodcast(input: PickPodcastInput): PodcastEntry | null {
  const skills = new Set(input.userSkillIds);
  const fits = (input.podcasts ?? PODCASTS)
    .filter((p) => p.skills.some((s) => skills.has(s)))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (fits.length === 0) return null;
  const n = fits.length;
  const day = ((diffDays(EPOCH, input.date) % n) + n) % n;
  let pick = fits[day]!;
  const last = input.history?.[input.history.length - 1];
  if (n > 1 && pick.id === last) pick = fits[(day + 1) % n]!;
  return pick;
}

export function toBriefingPodcast(p: PodcastEntry): BriefingPodcast {
  return {
    title: p.title,
    publisher: p.publisher,
    skillLink: p.skill_link,
    oneLine: p.one_line,
    spotifyUrl: p.spotify_url,
  };
}
