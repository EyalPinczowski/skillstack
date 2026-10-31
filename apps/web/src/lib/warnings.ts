import type { Schedule } from '../api/client';
import { formatDate, formatHours, minutesToHours } from './format';

export type ScheduleWarning = Schedule['warnings'][number];

export interface WarningText {
  label: string;
  text: string;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const dateText = (value: unknown) => {
  const date = asString(value);
  if (!date) return 'a fixed date';
  try {
    return formatDate(date, 'short');
  } catch {
    return date;
  }
};

function optionText(option: unknown): string | null {
  if (typeof option !== 'object' || option === null) return null;
  const { kind, minutes, earliestDate } = option as Record<string, unknown>;
  if (kind === 'add_hours') {
    const m = asNumber(minutes);
    return m === undefined
      ? 'add study time'
      : `add about ${formatHours(minutesToHours(m))} of study`;
  }
  if (kind === 'add_day') return 'add a study day';
  if (kind === 'move_exam') {
    return asString(earliestDate)
      ? `move it to ${dateText(earliestDate)} or later`
      : 'move it to a later date';
  }
  return null;
}

/** "SQL exam, Thu, Nov 19 at 10:00": which exam is at risk and when, without the advice. */
export function anchorRiskHeadline(
  warning: ScheduleWarning,
  titleOf: (taskId: string) => string,
): string {
  const id = asString(warning.taskId);
  const time = asString(warning.anchorStartTime);
  return `${id ? titleOf(id) : 'A task'}, ${dateText(warning.anchorDate)}${time ? ` at ${time}` : ''}`;
}

/**
 * Words for an engine warning. The engine decides what is wrong; this only turns its fields into
 * a sentence. Unknown kinds and missing fields still give a readable line.
 */
export function describeWarning(
  warning: ScheduleWarning,
  titleOf: (taskId: string) => string,
): WarningText {
  const title = (id: unknown) => (asString(id) ? titleOf(asString(id)!) : 'A task');
  switch (warning.kind) {
    case 'anchor_at_risk': {
      const shortfall = asNumber(warning.shortfallMinutes);
      const options = Array.isArray(warning.options)
        ? warning.options.map(optionText).filter((o): o is string => o !== null)
        : [];
      return {
        label: 'Exam at risk',
        text:
          `${anchorRiskHeadline(warning, titleOf)}.` +
          (shortfall !== undefined
            ? ` About ${formatHours(minutesToHours(shortfall))} of earlier study does not fit before it.`
            : '') +
          (options.length ? ` You could ${options.join(', or ')}.` : ''),
      };
    }
    case 'anchor_in_past':
      return {
        label: 'Fixed date has passed',
        text: `${title(warning.taskId)} was fixed for ${dateText(warning.anchorDate)}.`,
      };
    case 'unscheduled': {
      const left = asNumber(warning.remainingMinutes);
      return {
        label: 'Not scheduled',
        text: `${title(warning.taskId)} could not be scheduled${
          left === undefined ? '' : ` (${formatHours(minutesToHours(left))} left)`
        }.`,
      };
    }
    case 'dependency_cycle':
      return {
        label: 'Dependency loop',
        text: `These tasks wait for each other: ${asStrings(warning.taskIds).map(titleOf).join(', ')}.`,
      };
    case 'fixed_block_truncated':
      return {
        label: 'Block cut off',
        text: `${title(warning.taskId)} on ${dateText(warning.date)} runs past midnight; the rest was dropped.`,
      };
    case 'over_capacity':
      return {
        label: 'Over capacity',
        text: `${dateText(warning.date)} has more fixed work than study time.`,
      };
    case 'fixed_overlap':
      return {
        label: 'Fixed blocks overlap',
        text: `On ${dateText(warning.date)}: ${asStrings(warning.taskIds).map(titleOf).join(', ')}.`,
      };
    default:
      return { label: 'Schedule warning', text: warning.kind.replaceAll('_', ' ') };
  }
}
