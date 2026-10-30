import type { DayOverride, PreviewRequest, WeekPattern } from '../../api/client';
import type { TimeSettingsChange } from '../../api/hooks';

/** The form's text values for the week pattern. Numbers stay text until the form is submitted. */
export interface PatternDraft {
  weekdays: number[];
  defaultHours: string;
  windowStart: string;
  windowEnd: string;
  lunchStart: string;
  lunchEnd: string;
  breakEveryHours: string;
  breakMinutes: string;
  minBlockMinutes: string;
  timezone: string;
}

export function draftFromPattern(p: WeekPattern): PatternDraft {
  return {
    weekdays: [...p.studyWeekdays].sort((a, b) => a - b),
    defaultHours: String(p.defaultHours),
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
    lunchStart: p.lunchStart ?? '',
    lunchEnd: p.lunchEnd ?? '',
    breakEveryHours: String(p.breakEveryHours),
    breakMinutes: String(p.breakMinutes),
    minBlockMinutes: String(p.minBlockMinutes),
    timezone: p.timezone,
  };
}

const NUMBER_FIELDS: [keyof PatternDraft, string][] = [
  ['defaultHours', 'Hours per study day'],
  ['breakEveryHours', 'Break every (hours)'],
  ['breakMinutes', 'Break length (minutes)'],
  ['minBlockMinutes', 'Shortest block (minutes)'],
];

/**
 * Turns the draft into the API's week pattern. This only converts text to numbers and leaves
 * out empty optional fields; every rule (window order, lunch pairs, limits) is the API's to check.
 */
export function patternFromDraft(
  draft: PatternDraft,
  base: WeekPattern,
): { pattern: WeekPattern } | { error: string } {
  const numbers: Record<string, number> = {};
  for (const [key, label] of NUMBER_FIELDS) {
    const text = String(draft[key]).trim();
    const value = Number(text);
    if (text === '' || !Number.isFinite(value)) return { error: `Enter a number for “${label}”.` };
    numbers[key] = value;
  }
  const pattern: WeekPattern = {
    studyWeekdays: [...draft.weekdays].sort((a, b) => a - b),
    defaultHours: numbers.defaultHours!,
    hoursByWeekday: base.hoursByWeekday,
    windowStart: draft.windowStart,
    windowEnd: draft.windowEnd,
    ...(draft.lunchStart ? { lunchStart: draft.lunchStart } : {}),
    ...(draft.lunchEnd ? { lunchEnd: draft.lunchEnd } : {}),
    breakEveryHours: numbers.breakEveryHours!,
    breakMinutes: numbers.breakMinutes!,
    minBlockMinutes: numbers.minBlockMinutes!,
    timezone: draft.timezone,
  };
  return { pattern };
}

const fingerprint = (p: WeekPattern) =>
  JSON.stringify([
    [...p.studyWeekdays].sort(),
    p.defaultHours,
    p.hoursByWeekday,
    p.windowStart,
    p.windowEnd,
    p.lunchStart ?? null,
    p.lunchEnd ?? null,
    p.breakEveryHours,
    p.breakMinutes,
    p.minBlockMinutes,
    p.timezone,
  ]);

/** What differs from the saved settings: the pattern if it changed, and the override edits. */
export function diffTimeSettings(
  saved: { pattern: WeekPattern; overrides: DayOverride[] },
  next: { pattern: WeekPattern; overrides: DayOverride[] },
): TimeSettingsChange {
  const upsertOverrides = next.overrides.filter((d) => {
    const old = saved.overrides.find((o) => o.date === d.date);
    return !old || old.isStudyDay !== d.isStudyDay || old.capacityHours !== d.capacityHours;
  });
  const removeOverrideDates = saved.overrides
    .filter((o) => !next.overrides.some((d) => d.date === o.date))
    .map((o) => o.date);
  return {
    ...(fingerprint(saved.pattern) === fingerprint(next.pattern) ? {} : { pattern: next.pattern }),
    upsertOverrides,
    removeOverrideDates,
  };
}

export const isEmptyChange = (change: TimeSettingsChange) =>
  !change.pattern && change.upsertOverrides.length === 0 && change.removeOverrideDates.length === 0;

/** The body of POST /schedule/preview for a change. */
export function previewRequest(change: TimeSettingsChange): PreviewRequest {
  return {
    ...(change.pattern ? { pattern: change.pattern } : {}),
    ...(change.upsertOverrides.length ? { overrides: change.upsertOverrides } : {}),
    ...(change.removeOverrideDates.length
      ? { removeOverrideDates: change.removeOverrideDates }
      : {}),
  };
}
