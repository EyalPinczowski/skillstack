import { addDays, compareDates, diffDays, hoursToMinutes, weekday, type LocalDate } from '../dates';
import type {
  AdjustmentRule,
  DayOverride,
  DayReview,
  DecidedSuggestion,
  ProposedChange,
  Suggestion,
  Task,
  TaskType,
  WeekPattern,
} from '../schemas';
import { findOverride, isStudyDay, studyWindow, totalMinutes } from './capacity';

/**
 * The adjustment-rules engine (spec 3.4): pure and deterministic. It turns day reviews and
 * logs into transparent suggestions; nothing is changed until the user accepts one, and
 * `applySuggestion` only edits the inputs, it never schedules (the API calls `schedule()` and
 * `summarizeChanges()` on the result to show the change summary, spec 3.6).
 */

// ---- Thresholds (all named; each references the spec rule it implements) ---------------------

/** Spec 3.4: density is rated 1-5; 1 = too light, 3 = just right, 5 = too much. */
export const DENSITY_TOO_MUCH_MIN = 4;
export const DENSITY_TOO_LIGHT_MAX = 2;
/** Spec 3.4: "Too much" density two days in a row -> suggest reducing capacity. */
export const CONSECUTIVE_STUDY_DAYS_FOR_REDUCTION = 2;
/** Spec 3.4: reduce daily capacity "by one hour". */
export const CAPACITY_REDUCTION_HOURS = 1;
/** Spec 3.4: "Too light" -> add "an hour" or pull tasks forward by that hour. */
export const CAPACITY_ADDITION_HOURS = 1;
/** Capacity is never suggested below this many hours a day. */
export const MIN_DAILY_HOURS = 1;
/** Spec 3.4: "more than 25%" off the estimate, in whole percent (strictly greater fires). */
export const ESTIMATE_DEVIATION_PERCENT = 25;
/** Spec 3.4 needs a pattern, not a one-off: at least this many completed tasks of a type. */
export const MIN_COMPLETED_TASKS_FOR_ESTIMATES = 3;
/** Estimate factors are rounded to this step, in percent (1.27 -> 1.25). */
export const FACTOR_STEP_PERCENT = 5;
/** Estimate factors are kept within these bounds, in percent. */
export const MIN_FACTOR_PERCENT = 50;
export const MAX_FACTOR_PERCENT = 300;
/** Spec 3.4: high difficulty means 4 or 5 on the 1-5 scale. */
export const DIFFICULTY_HIGH_MIN = 4;
/** Spec 3.4: "adding practice time" after a hard topic, in hours. */
export const EXTRA_PRACTICE_HOURS = 1;
/** Only evidence from the last this-many days is offered (older evidence is stale). */
export const LOOKBACK_DAYS = 7;
/** How far back to look for the previous study day before giving up. */
const MAX_STUDY_DAY_GAP = 14;
/** How far ahead to look for the next study day to pull work into. */
const MAX_NEXT_STUDY_DAY_GAP = 14;
const MAX_DATE_RANGE_DAYS = 366;
/** Task types whose length is fixed by someone else; estimates are not tuned from the logs. */
const FIXED_LENGTH_TYPES: readonly TaskType[] = ['cert_exam', 'cv_update'];
/** Rules in the order their suggestions are listed. */
export const RULE_ORDER: readonly AdjustmentRule[] = [
  'density_too_high',
  'density_too_low',
  'estimate_drift',
  'difficulty_practice',
];

// ---- Types ----------------------------------------------------------------------------------

/** Hours logged on a task on a date (the `Log` record, spec 4). */
export interface LogEntry {
  taskId: string;
  date: LocalDate;
  hours: number;
}

export interface AdjustmentInput {
  reviews: DayReview[];
  logs: LogEntry[];
  tasks: Task[];
  pattern: WeekPattern;
  overrides?: DayOverride[];
  today: LocalDate;
  /** Suggestions the user already accepted or rejected. */
  decided?: DecidedSuggestion[];
  /**
   * Optional area (topic/skill) per task id, e.g. from catalog skills. Without it a task's
   * area is its `practiceKind`, else its `provider`, else its `type`.
   */
  taskAreas?: Record<string, string>;
}

/** The inputs a suggestion can change; hand them to `schedule()` afterwards. */
export interface AdjustableInputs {
  tasks: Task[];
  pattern: WeekPattern;
  overrides: DayOverride[];
}

// ---- Helpers --------------------------------------------------------------------------------

/** Deterministic 53-bit string hash (cyrb53), as 14 hex digits. No dependencies, any runtime. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

/** The suggestion id: a stable hash of the rule and the evidence key. */
export function suggestionId(rule: AdjustmentRule, key: string): string {
  return `sg_${hash53(`${rule}|${key}`)}`;
}

/** All options of a suggestion: the recommended change first, then the alternatives. */
export function suggestionOptions(suggestion: Suggestion): ProposedChange[] {
  return [suggestion.proposedChange, ...suggestion.alternatives];
}

const uniqueSorted = (values: string[]): string[] => [...new Set(values)].sort();

const fmtHours = (hours: number): string => `${Math.round(hours * 100) / 100}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function weekdayHours(pattern: WeekPattern, day: number): number {
  return pattern.hoursByWeekday[String(day)] ?? pattern.defaultHours;
}

const clampHours = (hours: number): number => Math.min(24, Math.max(0, hours));

/** Reviews up to `today`, one per date (the last given wins), oldest first. */
function usableReviews(reviews: DayReview[], today: LocalDate): DayReview[] {
  const byDate = new Map<LocalDate, DayReview>();
  for (const r of reviews) if (compareDates(r.date, today) <= 0) byDate.set(r.date, r);
  return [...byDate.values()].sort((a, b) => compareDates(a.date, b.date));
}

function inLookback(date: LocalDate, today: LocalDate): boolean {
  const age = diffDays(date, today);
  return age >= 0 && age <= LOOKBACK_DAYS;
}

/** The study day before `date` (per the week pattern and overrides), or null if none is near. */
function previousStudyDay(
  date: LocalDate,
  pattern: WeekPattern,
  overrides: DayOverride[],
): LocalDate | null {
  for (let i = 1; i <= MAX_STUDY_DAY_GAP; i++) {
    const d = addDays(date, -i);
    if (isStudyDay(d, pattern, overrides)) return d;
  }
  return null;
}

function nextStudyDay(
  date: LocalDate,
  pattern: WeekPattern,
  overrides: DayOverride[],
): LocalDate | null {
  for (let i = 1; i <= MAX_NEXT_STUDY_DAY_GAP; i++) {
    const d = addDays(date, i);
    if (isStudyDay(d, pattern, overrides)) return d;
  }
  return null;
}

interface Context {
  input: AdjustmentInput;
  overrides: DayOverride[];
  /** Review dates already used by an accepted suggestion of the same rule. */
  consumedDates: (rule: AdjustmentRule) => Set<LocalDate>;
  consumedTasks: (rule: AdjustmentRule) => Set<string>;
  isDecided: (rule: AdjustmentRule, key: string) => boolean;
}

function buildContext(input: AdjustmentInput): Context {
  const decided = input.decided ?? [];
  const decidedIds = new Set(decided.map((d) => suggestionId(d.rule, d.key)));
  const accepted = (rule: AdjustmentRule) =>
    decided.filter((d) => d.rule === rule && d.decision === 'accepted');
  return {
    input,
    overrides: input.overrides ?? [],
    consumedDates: (rule) => new Set(accepted(rule).flatMap((d) => d.evidence?.reviewDates ?? [])),
    consumedTasks: (rule) => new Set(accepted(rule).flatMap((d) => d.evidence?.taskIds ?? [])),
    isDecided: (rule, key) => decidedIds.has(suggestionId(rule, key)),
  };
}

function make(
  rule: AdjustmentRule,
  key: string,
  parts: Pick<Suggestion, 'title' | 'explanation' | 'proposedChange' | 'evidence'> & {
    alternatives?: ProposedChange[];
  },
): Suggestion {
  return {
    id: suggestionId(rule, key),
    rule,
    key,
    title: parts.title,
    explanation: parts.explanation,
    proposedChange: parts.proposedChange,
    alternatives: parts.alternatives ?? [],
    evidence: parts.evidence,
  };
}

// ---- Rule 1: density "too much" two study days in a row (spec 3.4) --------------------------

function ruleDensityTooHigh(ctx: Context): Suggestion[] {
  const { pattern, today } = ctx.input;
  const used = ctx.consumedDates('density_too_high');
  const heavy = new Map<LocalDate, DayReview>();
  for (const r of usableReviews(ctx.input.reviews, today)) {
    if (r.density >= DENSITY_TOO_MUCH_MIN && !used.has(r.date)) heavy.set(r.date, r);
  }
  // Latest pair of heavy reviews on consecutive study days (the pattern decides, not the calendar).
  const dates = [...heavy.keys()].sort(compareDates).reverse();
  for (const second of dates) {
    if (!inLookback(second, today) || !isStudyDay(second, pattern, ctx.overrides)) continue;
    const first = previousStudyDay(second, pattern, ctx.overrides);
    if (first === null || !heavy.has(first)) continue;
    const key = `${first}|${second}`;
    if (ctx.isDecided('density_too_high', key)) return [];
    const weekdays = pattern.studyWeekdays
      .filter((w) => weekdayHours(pattern, w) - CAPACITY_REDUCTION_HOURS >= MIN_DAILY_HOURS)
      .sort((a, b) => a - b);
    if (weekdays.length === 0) return [];
    const before = new Set(weekdays.map((w) => weekdayHours(pattern, w)));
    const hoursText =
      before.size === 1
        ? ` (from ${fmtHours([...before][0]!)} h to ${fmtHours([...before][0]! - CAPACITY_REDUCTION_HOURS)} h a day)`
        : '';
    return [
      make('density_too_high', key, {
        title: `Reduce daily study time by ${plural(CAPACITY_REDUCTION_HOURS, 'hour')}`,
        explanation:
          `You rated the day "too much" on two study days in a row: ${first} (${heavy.get(first)!.density}/5) ` +
          `and ${second} (${heavy.get(second)!.density}/5). ` +
          `Reduce your daily study capacity by ${plural(CAPACITY_REDUCTION_HOURS, 'hour')}${hoursText}?`,
        proposedChange: {
          kind: 'capacityDelta',
          scope: { type: 'weekdays', weekdays },
          hours: -CAPACITY_REDUCTION_HOURS,
        },
        evidence: { reviewDates: [first, second], taskIds: [] },
      }),
    ];
  }
  return [];
}

// ---- Rule 2: density "too light" (spec 3.4) --------------------------------------------------

function ruleDensityTooLow(ctx: Context): Suggestion[] {
  const { pattern, today } = ctx.input;
  const used = ctx.consumedDates('density_too_low');
  const light = usableReviews(ctx.input.reviews, today)
    .filter((r) => r.density <= DENSITY_TOO_LIGHT_MAX && !used.has(r.date))
    .filter((r) => inLookback(r.date, today))
    .pop();
  if (!light) return [];
  const key = light.date;
  if (ctx.isDecided('density_too_low', key)) return [];

  const windowMinutes = totalMinutes(studyWindow(pattern));
  const weekdays = pattern.studyWeekdays
    .filter(
      (w) => hoursToMinutes(weekdayHours(pattern, w) + CAPACITY_ADDITION_HOURS) <= windowMinutes,
    )
    .sort((a, b) => a - b);
  const options: ProposedChange[] = [];
  if (weekdays.length > 0) {
    options.push({
      kind: 'capacityDelta',
      scope: { type: 'weekdays', weekdays },
      hours: CAPACITY_ADDITION_HOURS,
    });
  }
  const next = nextStudyDay(today, pattern, ctx.overrides);
  if (
    next !== null &&
    hoursToMinutes(dayHours(next, pattern, ctx.overrides) + CAPACITY_ADDITION_HOURS) <=
      windowMinutes
  ) {
    options.push({ kind: 'pullForward', date: next, hours: CAPACITY_ADDITION_HOURS });
  }
  const [proposedChange, ...alternatives] = options;
  if (!proposedChange) return [];
  const h = plural(CAPACITY_ADDITION_HOURS, 'hour');
  return [
    make('density_too_low', key, {
      title: `Add ${h} of study time or pull tasks forward`,
      explanation:
        `You rated ${light.date} as too light (${light.density}/5). ` +
        (alternatives.length > 0
          ? `Add ${h} to each study day, or pull ${h} of upcoming tasks forward to ${next}?`
          : proposedChange.kind === 'pullForward'
            ? `Pull ${h} of upcoming tasks forward to ${next}?`
            : `Add ${h} to each study day?`),
      proposedChange,
      alternatives,
      evidence: { reviewDates: [light.date], taskIds: [] },
    }),
  ];
}

function dayHours(date: LocalDate, pattern: WeekPattern, overrides: DayOverride[]): number {
  return findOverride(date, overrides)?.capacityHours ?? weekdayHours(pattern, weekday(date));
}

// ---- Rule 3: actual vs estimated hours per task type (spec 3.4) -----------------------------

const TYPE_LABELS: Record<TaskType, string> = {
  course: 'Courses',
  cert_exam: 'Exams',
  practice: 'Practice tasks',
  admin: 'Admin tasks',
  cv_update: 'CV updates',
};

function ruleEstimateDrift(ctx: Context): Suggestion[] {
  const { tasks, logs, today } = ctx.input;
  const used = ctx.consumedTasks('estimate_drift');
  const loggedMinutes = new Map<string, number>();
  for (const l of logs) {
    if (compareDates(l.date, today) > 0 || !(l.hours > 0)) continue;
    loggedMinutes.set(l.taskId, (loggedMinutes.get(l.taskId) ?? 0) + hoursToMinutes(l.hours));
  }
  // `doneHours` is the stored total (hours imported with the plan plus every logged entry), so
  // a task's actual time is the larger of it and the logs counted here; a task whose hours
  // all came with the plan file has no logs but still counts.
  const doneMinutes = (t: Task): number =>
    Math.max(hoursToMinutes(t.doneHours), loggedMinutes.get(t.id) ?? 0);
  const out: Suggestion[] = [];
  const types = uniqueSorted(tasks.map((t) => t.type)) as TaskType[];
  for (const type of types) {
    if (FIXED_LENGTH_TYPES.includes(type)) continue;
    const completed = tasks
      .filter(
        (t) => t.type === type && t.status === 'done' && !used.has(t.id) && doneMinutes(t) > 0,
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (completed.length < MIN_COMPLETED_TASKS_FOR_ESTIMATES) continue;
    const estimated = completed.reduce((s, t) => s + hoursToMinutes(t.estHours), 0);
    const actual = completed.reduce((s, t) => s + doneMinutes(t), 0);
    if (estimated <= 0) continue;
    // Integer math: |actual - estimated| / estimated > 25% without float rounding at the edge.
    if (Math.abs(actual - estimated) * 100 <= estimated * ESTIMATE_DEVIATION_PERCENT) continue;
    const rawPercent = (actual * 100) / estimated;
    const stepped = Math.round(rawPercent / FACTOR_STEP_PERCENT) * FACTOR_STEP_PERCENT;
    const factorPercent = Math.min(MAX_FACTOR_PERCENT, Math.max(MIN_FACTOR_PERCENT, stepped));
    if (factorPercent === 100) continue;
    const remaining = tasks
      .filter((t) => t.type === type && (t.status === 'pending' || t.status === 'in_progress'))
      .map((t) => t.id)
      .sort();
    if (remaining.length === 0) continue;
    const evidenceIds = completed.map((t) => t.id);
    const key = `${type}:${evidenceIds.join(',')}`;
    if (ctx.isDecided('estimate_drift', key)) continue;
    const label = TYPE_LABELS[type];
    const delta = Math.abs(factorPercent - 100);
    const direction = factorPercent > 100 ? 'longer' : 'shorter';
    out.push(
      make('estimate_drift', key, {
        title: `Update estimates for ${label.toLowerCase()}`,
        explanation:
          `${label} are taking you ${delta}% ${direction} than estimated ` +
          `(${fmtHours(actual / 60)} h actual vs ${fmtHours(estimated / 60)} h estimated over ` +
          `${plural(completed.length, 'completed task')}). ` +
          `Multiply the estimates of the ${plural(remaining.length, 'remaining task')} by ${factorPercent / 100} - update?`,
        proposedChange: {
          kind: 'estimateUpdate',
          taskType: type,
          factor: factorPercent / 100,
          taskIds: remaining,
        },
        evidence: { reviewDates: [], taskIds: evidenceIds },
      }),
    );
  }
  return out;
}

// ---- Rule 4: high difficulty on an area (spec 3.4) -------------------------------------------

function areaOf(task: Task, taskAreas: Record<string, string> | undefined): string {
  return taskAreas?.[task.id] ?? task.practiceKind ?? task.provider ?? task.type;
}

function ruleDifficultyPractice(ctx: Context): Suggestion[] {
  const { tasks, logs, today, taskAreas } = ctx.input;
  const used = ctx.consumedDates('difficulty_practice');
  const hard = usableReviews(ctx.input.reviews, today)
    .filter((r) => r.difficulty >= DIFFICULTY_HIGH_MIN && !used.has(r.date))
    .filter((r) => inLookback(r.date, today))
    .pop();
  if (!hard) return [];

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const workedIds = new Set<string>();
  for (const o of hard.outcomes) if (o.outcome !== 'not_done') workedIds.add(o.taskId);
  for (const l of logs) if (l.date === hard.date && l.hours > 0) workedIds.add(l.taskId);
  const worked = [...workedIds].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));

  const areas = uniqueSorted(worked.map((t) => areaOf(t, taskAreas)));
  const ordered = [...tasks].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  const out: Suggestion[] = [];
  for (const area of areas) {
    const next = ordered.find(
      (t) =>
        !workedIds.has(t.id) &&
        (t.status === 'pending' || t.status === 'in_progress') &&
        t.type !== 'cert_exam' &&
        !t.isAnchor &&
        areaOf(t, taskAreas) === area,
    );
    if (!next) continue;
    const key = `${hard.date}|${area}`;
    if (ctx.isDecided('difficulty_practice', key)) continue;
    const h = plural(EXTRA_PRACTICE_HOURS, 'hour');
    out.push(
      make('difficulty_practice', key, {
        title: `Add ${h} of practice after "${next.title}"`,
        explanation:
          `You rated ${hard.date} as hard (difficulty ${hard.difficulty}/5) while working on ${area}. ` +
          `Add ${h} of extra practice right after the next ${area} task, "${next.title}"?`,
        proposedChange: {
          kind: 'extraPractice',
          afterTaskId: next.id,
          hours: EXTRA_PRACTICE_HOURS,
        },
        evidence: { reviewDates: [hard.date], taskIds: uniqueSorted([...worked.map((t) => t.id)]) },
      }),
    );
  }
  return out;
}

// ---- Public API ------------------------------------------------------------------------------

/**
 * The suggestions to show for a plan right now. Pure: the same input always gives the same
 * list in the same order (rule order, then key). A suggestion the user already decided on is
 * not offered again for the same evidence; new evidence gives a new key and a new id.
 */
export function suggestAdjustments(input: AdjustmentInput): Suggestion[] {
  const ctx = buildContext(input);
  const all = [
    ...ruleDensityTooHigh(ctx),
    ...ruleDensityTooLow(ctx),
    ...ruleEstimateDrift(ctx),
    ...ruleDifficultyPractice(ctx),
  ];
  return all.sort((a, b) => {
    const byRule = RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule);
    return byRule !== 0 ? byRule : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

const roundToQuarterHour = (hours: number): number => Math.max(0.25, Math.round(hours * 4) / 4);

/**
 * The estimate after scaling by `factor`: a quarter-hour step, within the schema's 500 h cap,
 * and never below the hours already done (a lower estimate would leave nothing to do).
 */
export function scaledEstimate(task: Task, factor: number): number {
  const doneFloor = Math.ceil(task.doneHours * 4) / 4;
  return Math.max(Math.min(500, roundToQuarterHour(task.estHours * factor)), doneFloor);
}

function applyCapacityDelta(
  pattern: WeekPattern,
  overrides: DayOverride[],
  change: Extract<ProposedChange, { kind: 'capacityDelta' }>,
): { pattern: WeekPattern; overrides: DayOverride[] } {
  if (change.scope.type === 'weekdays') {
    const hoursByWeekday = { ...pattern.hoursByWeekday };
    for (const w of change.scope.weekdays) {
      hoursByWeekday[String(w)] = clampHours(weekdayHours(pattern, w) + change.hours);
    }
    return { pattern: { ...pattern, hoursByWeekday }, overrides };
  }
  const next = new Map(overrides.map((o) => [o.date, o]));
  const { from, to } = change.scope;
  for (let i = 0; i <= MAX_DATE_RANGE_DAYS; i++) {
    const date = addDays(from, i);
    if (compareDates(date, to) > 0) break;
    if (!isStudyDay(date, pattern, overrides)) continue;
    next.set(date, {
      ...next.get(date),
      date,
      isStudyDay: true,
      capacityHours: clampHours(dayHours(date, pattern, overrides) + change.hours),
    });
  }
  return {
    pattern,
    overrides: [...next.values()].sort((a, b) => compareDates(a.date, b.date)),
  };
}

/**
 * Applies one option of a suggestion to the plan inputs and returns new inputs; nothing is
 * scheduled and nothing passed in is modified. `optionIndex` picks an alternative (0 = the
 * recommended `proposedChange`). The API then runs `schedule()` on both versions and
 * `summarizeChanges()` to show the change summary before saving.
 */
export function applySuggestion(
  tasks: Task[],
  pattern: WeekPattern,
  overrides: DayOverride[],
  suggestion: Suggestion,
  optionIndex = 0,
): AdjustableInputs {
  const options = suggestionOptions(suggestion);
  const change = options[optionIndex];
  if (!change) throw new RangeError(`Suggestion ${suggestion.id} has no option ${optionIndex}`);

  switch (change.kind) {
    case 'capacityDelta':
      return { tasks, ...applyCapacityDelta(pattern, overrides, change) };
    case 'pullForward':
      return {
        tasks,
        ...applyCapacityDelta(pattern, overrides, {
          kind: 'capacityDelta',
          scope: { type: 'dateRange', from: change.date, to: change.date },
          hours: change.hours,
        }),
      };
    case 'estimateUpdate': {
      const ids = new Set(change.taskIds);
      return {
        pattern,
        overrides,
        tasks: tasks.map((t) =>
          ids.has(t.id) && t.type === change.taskType
            ? { ...t, estHours: scaledEstimate(t, change.factor) }
            : t,
        ),
      };
    }
    case 'extraPractice': {
      const after = tasks.find((t) => t.id === change.afterTaskId);
      const newId = `practice-${suggestion.id}`;
      if (!after || tasks.some((t) => t.id === newId)) return { tasks, pattern, overrides };
      const extra: Task = {
        id: newId,
        title: `Extra practice: ${after.title}`,
        type: 'practice',
        estHours: change.hours,
        doneHours: 0,
        status: 'pending',
        order: after.order + 1,
        dependsOn: [after.id],
        isAnchor: false,
        splittable: true,
        isCertificate: false,
        lessons: [],
        howToSteps: [],
        source: 'auto',
      };
      return {
        pattern,
        overrides,
        tasks: [
          ...tasks.map((t) => (t.order > after.order ? { ...t, order: t.order + 1 } : t)),
          extra,
        ],
      };
    }
  }
}
