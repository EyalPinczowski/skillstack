import { addDays, compareDates, type LocalDate } from '../dates';
import type { DayOverride, Task, WeekPattern } from '../schemas';
import { isStudyDay } from './capacity';
import type { ScheduleResult } from './engine';

/** What a reschedule changed, shown to the user before it is saved (spec 3.6). */
export interface ChangeSummary {
  movedTaskIds: string[];
  finishBefore: LocalDate | null;
  finishAfter: LocalDate | null;
  /** Study days the finish moved: positive = later, negative = earlier. */
  finishShiftStudyDays: number;
  newAnchorRisks: string[];
  text: string;
}

function studyDaysBetween(
  from: LocalDate,
  to: LocalDate,
  pattern: WeekPattern,
  overrides: DayOverride[],
): number {
  const sign = compareDates(to, from);
  if (sign === 0) return 0;
  const [a, b] = sign > 0 ? [from, to] : [to, from];
  let count = 0;
  for (let d = addDays(a, 1); compareDates(d, b) <= 0; d = addDays(d, 1)) {
    if (isStudyDay(d, pattern, overrides)) count++;
  }
  return sign * count;
}

function signatureByTask(result: ScheduleResult, from: LocalDate): Map<string, string> {
  const map = new Map<string, string[]>();
  for (const b of result.blocks) {
    if (compareDates(b.date, from) < 0) continue;
    const list = map.get(b.taskId) ?? [];
    list.push(`${b.date} ${b.start}-${b.end}`);
    map.set(b.taskId, list);
  }
  return new Map([...map].map(([id, list]) => [id, list.join('|')]));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function summarizeChanges(
  before: ScheduleResult,
  after: ScheduleResult,
  options: { today: LocalDate; pattern: WeekPattern; overrides?: DayOverride[]; tasks?: Task[] },
): ChangeSummary {
  const overrides = options.overrides ?? [];
  const a = signatureByTask(before, options.today);
  const b = signatureByTask(after, options.today);
  const ids = new Set([...a.keys(), ...b.keys()]);
  const movedTaskIds = [...ids].filter((id) => a.get(id) !== b.get(id)).sort();

  const shift =
    before.finishDate && after.finishDate
      ? studyDaysBetween(before.finishDate, after.finishDate, options.pattern, overrides)
      : 0;

  const atRisk = (r: ScheduleResult) =>
    r.warnings.flatMap((w) => (w.kind === 'anchor_at_risk' ? [w.taskId] : []));
  const risksBefore = new Set(atRisk(before));
  const newAnchorRisks = atRisk(after).filter((id) => !risksBefore.has(id));

  const parts: string[] = [];
  parts.push(
    movedTaskIds.length ? `${plural(movedTaskIds.length, 'task')} moved` : 'No tasks moved',
  );
  if (shift > 0) parts.push(`plan finish pushed back by ${plural(shift, 'study day')}`);
  else if (shift < 0) parts.push(`plan finish moved up by ${plural(-shift, 'study day')}`);
  else parts.push('plan finish unchanged');
  if (newAnchorRisks.length) {
    const names = newAnchorRisks.map((id) => options.tasks?.find((t) => t.id === id)?.title ?? id);
    parts.push(`at risk: ${names.join(', ')}`);
  }

  return {
    movedTaskIds,
    finishBefore: before.finishDate,
    finishAfter: after.finishDate,
    finishShiftStudyDays: shift,
    newAnchorRisks,
    text: parts.join(', ') + '.',
  };
}
