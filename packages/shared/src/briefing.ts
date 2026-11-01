import { z } from 'zod';
import { addDays, compareDates, diffDays, parseTime, type LocalDate } from './dates';
import { isStudyDay } from './scheduling/capacity';
import type { ScheduleWarning } from './scheduling/engine';
import {
  BriefingPodcastSchema,
  pickPodcast,
  toBriefingPodcast,
  type PodcastEntry,
} from './podcasts';
import {
  LocalDateSchema,
  TaskTypeSchema,
  TimeSchema,
  type Block,
  type DayOverride,
  type Lesson,
  type Task,
  type WeekPattern,
} from './schemas';

/**
 * The day briefing (spec 3.2), template-only: deterministic and rule-based, with no model and
 * no network. The same input always gives the same output. Everything in the output comes from
 * the input: no link, provider, price, lesson title or task is ever made up, and a field that
 * has no data is left out (or is an empty list).
 */

const LessonOutSchema = z.object({
  title: z.string(),
  /** Present only when the lesson has a link. */
  url: z.string().optional(),
  estMinutes: z.number().int().optional(),
  summary: z.string().optional(),
  /** True while the link has not been confirmed on the provider's own site. */
  needsCheck: z.boolean(),
});

const BriefingBlockSchema = z.object({
  start: TimeSchema,
  end: TimeSchema,
  minutes: z.number().int(),
});

export const BriefingTaskSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  type: TaskTypeSchema,
  provider: z.string().optional(),
  /** The task's own link, only when the task has one. */
  url: z.string().optional(),
  plannedMinutes: z.number().int(),
  /** Start of the first and end of the last block of the task today. */
  start: TimeSchema,
  end: TimeSchema,
  blocks: z.array(BriefingBlockSchema),
  /** A short template sentence about the task. */
  what: z.string(),
  lessons: z.array(LessonOutSchema),
  howToSteps: z.array(z.string()),
  /** The task's own prompt template (practices); null when it has none. */
  promptTemplate: z.string().nullable(),
  /** What success looks like, for practices; null for every other type. */
  successCriteria: z.string().nullable(),
  /** Planned on an earlier day and not done yet. */
  carriedOver: z.boolean(),
});

export const BriefingSchema = z.object({
  date: LocalDateSchema,
  overview: z.string(),
  tasks: z.array(BriefingTaskSchema),
  suggestedOrder: z.array(z.object({ taskId: z.string(), start: TimeSchema, end: TimeSchema })),
  /** One "Idea of the day" podcast; absent when no show fits the plan's skills. */
  podcast: BriefingPodcastSchema.optional(),
  source: z.literal('template'),
});

export type Briefing = z.infer<typeof BriefingSchema>;
export type BriefingTask = z.infer<typeof BriefingTaskSchema>;

export interface BriefingInput {
  date: LocalDate;
  /** The blocks planned for `date`. Blocks of other dates and of unknown tasks are ignored. */
  blocks: Block[];
  /** The plan's tasks, with progress as it stood at the start of `date`. */
  tasks: Task[];
  /** Blocks of earlier days (frozen days). Used to find work carried over. */
  earlierBlocks?: Block[];
  pattern: WeekPattern;
  overrides?: DayOverride[];
  /** The engine's warnings for the schedule that produced `blocks`. */
  warnings?: ScheduleWarning[];
  /** Last scheduled date of the plan, when known. */
  finishDate?: LocalDate | null;
  /** Skill ids of the plan (taxonomy ids). Without them no podcast is suggested. */
  skillIds?: string[];
  /** Podcast ids shown on earlier days, oldest first (only used to avoid a repeat). */
  podcastHistory?: string[];
  /** Replaces the shipped podcast list (tests). */
  podcasts?: readonly PodcastEntry[];
}

const NOUNS: Record<Task['type'], [one: string, many: string]> = {
  course: ['course', 'courses'],
  cert_exam: ['exam', 'exams'],
  practice: ['practice', 'practices'],
  admin: ['admin task', 'admin tasks'],
  cv_update: ['CV update', 'CV updates'],
};

const MAX_SEARCH_DAYS = 3660;
const MAX_NAMED = 3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** 90 -> "1 hour 30 minutes", 45 -> "45 minutes", 120 -> "2 hours". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return plural(m, 'minute', 'minutes');
  return m === 0
    ? plural(h, 'hour', 'hours')
    : `${plural(h, 'hour', 'hours')} ${plural(m, 'minute', 'minutes')}`;
}

/** "A", "A and B", "A, B and C" (no Oxford comma). */
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Names up to MAX_NAMED items, then "and N more". */
function nameList(items: string[]): string {
  if (items.length <= MAX_NAMED) return joinList(items);
  const rest = items.length - MAX_NAMED;
  return `${items.slice(0, MAX_NAMED).join(', ')} and ${rest} more`;
}

const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'skipped';
const remainingMinutes = (t: Task) =>
  isOpen(t) ? Math.max(0, Math.round((t.estHours - t.doneHours) * 60)) : 0;

/** The task's own prerequisites, direct and indirect, followed with a visited set (cycle safe). */
function ancestors(task: Task, byId: Map<string, Task>): Set<string> {
  const seen = new Set<string>();
  const pending = [...task.dependsOn];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const next = byId.get(id);
    if (next) pending.push(...next.dependsOn);
  }
  return seen;
}

/** Study days after `from` up to and including `to`; null when it is too far to count. */
function studyDaysBetween(
  from: LocalDate,
  to: LocalDate,
  pattern: WeekPattern,
  overrides: DayOverride[],
): number | null {
  const span = diffDays(from, to);
  if (span < 0 || span > MAX_SEARCH_DAYS) return null;
  let count = 0;
  for (let i = 1; i <= span; i++) {
    if (isStudyDay(addDays(from, i), pattern, overrides)) count++;
  }
  return count;
}

const whenText = (studyDays: number | null, anchorDate: LocalDate, date: LocalDate): string => {
  if (anchorDate === date) return 'today';
  if (studyDays === null) return `on ${anchorDate}`;
  return `on ${anchorDate}, in ${plural(studyDays, 'study day', 'study days')}`;
};

const anchorName = (t: Task) => t.certificateName ?? t.title;

function lessonOut(l: Lesson): z.infer<typeof LessonOutSchema> {
  return {
    title: l.title,
    ...(l.url ? { url: l.url } : {}),
    ...(l.estMinutes !== undefined ? { estMinutes: l.estMinutes } : {}),
    ...(l.summary ? { summary: l.summary } : {}),
    needsCheck: l.needsCheck,
  };
}

function whatText(task: Task, plannedMinutes: number, start: string): string {
  const left = remainingMinutes(task);
  const by = task.provider ? ` on ${task.provider}` : '';
  const lessons = task.lessons.length
    ? ` It has ${plural(task.lessons.length, 'lesson', 'lessons')}.`
    : '';
  const remaining = left > 0 ? ` ${formatDuration(left)} remain in total.` : '';
  switch (task.type) {
    case 'course':
      return `Study "${task.title}"${by}: ${formatDuration(plannedMinutes)} today.${lessons}${remaining}`;
    case 'cert_exam':
      return task.isAnchor
        ? `Sit "${task.title}" at ${start}; the date is fixed.`
        : `Sit "${task.title}" at ${start} (${formatDuration(plannedMinutes)}).`;
    case 'practice':
      return `Practice "${task.title}": ${formatDuration(plannedMinutes)} today.${remaining}`;
    case 'cv_update':
      return `Update your CV and LinkedIn: "${task.title}" (${formatDuration(plannedMinutes)}).`;
    case 'admin':
      return `Admin task "${task.title}": ${formatDuration(plannedMinutes)}.`;
  }
}

function successText(task: Task): string | null {
  if (task.type !== 'practice') return null;
  const notes = task.notes?.trim();
  if (notes) return notes;
  if (task.howToSteps.length > 0) {
    return `You are done when you have completed all ${task.howToSteps.length} steps and written down one thing to improve next time.`;
  }
  return 'You are done when you have finished the session and written down one thing that went well and one thing to improve.';
}

function riskSentence(
  warnings: ScheduleWarning[],
  byId: Map<string, Task>,
  date: LocalDate,
): string | null {
  const risks = warnings.flatMap((w) =>
    w.kind === 'anchor_at_risk' && compareDates(w.anchorDate, date) >= 0 ? [w] : [],
  );
  if (risks.length === 0) return null;
  const first = [...risks].sort((a, b) => compareDates(a.anchorDate, b.anchorDate))[0]!;
  const task = byId.get(first.taskId);
  const name = task ? anchorName(task) : 'an exam';
  const more =
    risks.length > 1
      ? ` (${plural(risks.length - 1, 'other date is', 'other dates are')} also at risk)`
      : '';
  return `Warning: ${name} on ${first.anchorDate} is at risk: ${formatDuration(first.shortfallMinutes)} of the study before it does not fit${more}. Review the options in the schedule.`;
}

/** Builds the day briefing from the day's blocks and the plan's data. Pure and deterministic. */
export function buildBriefing(input: BriefingInput): Briefing {
  const { date, pattern } = input;
  const overrides = input.overrides ?? [];
  const byId = new Map(input.tasks.map((t) => [t.id, t]));

  // Today's blocks of tasks we know, in time order (ties by task id, for a stable result).
  const blocks = input.blocks
    .filter((b) => b.date === date && byId.has(b.taskId))
    .sort((a, b) => parseTime(a.start) - parseTime(b.start) || a.taskId.localeCompare(b.taskId));

  const groups = new Map<string, Block[]>();
  for (const b of blocks) groups.set(b.taskId, [...(groups.get(b.taskId) ?? []), b]);

  // Carried over: planned on earlier days for more time than has been done so far.
  const plannedBefore = new Map<string, number>();
  for (const b of input.earlierBlocks ?? []) {
    if (compareDates(b.date, date) >= 0) continue;
    plannedBefore.set(b.taskId, (plannedBefore.get(b.taskId) ?? 0) + b.minutes);
  }
  const isCarried = (t: Task) =>
    isOpen(t) && (plannedBefore.get(t.id) ?? 0) > Math.round(t.doneHours * 60);

  const tasks: BriefingTask[] = [...groups.entries()].map(([taskId, list]) => {
    const task = byId.get(taskId)!;
    const plannedMinutes = list.reduce((s, b) => s + b.minutes, 0);
    const start = list[0]!.start;
    return {
      taskId,
      title: task.title,
      type: task.type,
      ...(task.provider ? { provider: task.provider } : {}),
      ...(task.url ? { url: task.url } : {}),
      plannedMinutes,
      start,
      end: list[list.length - 1]!.end,
      blocks: list.map((b) => ({ start: b.start, end: b.end, minutes: b.minutes })),
      what: whatText(task, plannedMinutes, start),
      lessons: task.lessons.map(lessonOut),
      howToSteps: [...task.howToSteps],
      promptTemplate: task.promptTemplate?.trim() ? task.promptTemplate : null,
      successCriteria: successText(task),
      carriedOver: isCarried(task),
    };
  });

  const warningSentence = riskSentence(input.warnings ?? [], byId, date);
  const sentences: string[] = [];

  // Upcoming anchors: not done, on or after today, soonest first.
  const anchors = input.tasks
    .filter((t) => t.isAnchor && t.anchorDate && isOpen(t) && compareDates(t.anchorDate, date) >= 0)
    .sort((a, b) => compareDates(a.anchorDate!, b.anchorDate!) || a.order - b.order);

  const todayIds = new Set(tasks.map((t) => t.taskId));
  const leadsTo = anchors.find(
    (a) => todayIds.has(a.id) || [...ancestors(a, byId)].some((id) => todayIds.has(id)),
  );
  const when = (a: Task) =>
    whenText(studyDaysBetween(date, a.anchorDate!, pattern, overrides), a.anchorDate!, date);

  if (tasks.length === 0) {
    sentences.push(
      isStudyDay(date, pattern, overrides)
        ? 'Nothing is scheduled for today, so take it as a rest day.'
        : 'Today is a rest day with nothing scheduled.',
    );
    const next = anchors[0];
    if (next) sentences.push(`Your next fixed date is ${anchorName(next)}, ${when(next)}.`);
    else if (input.finishDate)
      sentences.push(`The plan currently finishes on ${input.finishDate}.`);
    else sentences.push('There is nothing to prepare.');
  } else {
    const total = tasks.reduce((s, t) => s + t.plannedMinutes, 0);
    const counts = new Map<Task['type'], number>();
    for (const t of tasks) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
    const kinds = [...counts.entries()].map(([type, n]) => plural(n, ...NOUNS[type]));
    sentences.push(`Today is ${formatDuration(total)} of study: ${joinList(kinds)}.`);

    const certificate = tasks
      .map((t) => byId.get(t.taskId)!)
      .find((t) => t.isCertificate && t.certificateName);
    if (leadsTo) {
      sentences.push(`This work leads toward ${anchorName(leadsTo)}, ${when(leadsTo)}.`);
    } else if (certificate) {
      sentences.push(`Finishing "${certificate.title}" earns ${certificate.certificateName}.`);
    } else if (anchors[0]) {
      sentences.push(`Your next fixed date is ${anchorName(anchors[0])}, ${when(anchors[0])}.`);
    } else if (input.finishDate) {
      sentences.push(`The plan currently finishes on ${input.finishDate}.`);
    } else {
      sentences.push(
        'Work through the blocks in the suggested order and log your hours at the end.',
      );
    }

    const carried = tasks.filter((t) => t.carriedOver).map((t) => `"${t.title}"`);
    if (carried.length > 0) {
      sentences.push(`Carried over from an earlier day: ${nameList(carried)}.`);
    }
  }
  if (warningSentence) sentences.push(warningSentence);

  const podcast = pickPodcast({
    userSkillIds: input.skillIds ?? [],
    date,
    history: input.podcastHistory,
    podcasts: input.podcasts,
  });

  return {
    date,
    overview: sentences.join(' '),
    tasks,
    suggestedOrder: blocks.map((b) => ({ taskId: b.taskId, start: b.start, end: b.end })),
    ...(podcast ? { podcast: toBriefingPodcast(podcast) } : {}),
    source: 'template',
  };
}
