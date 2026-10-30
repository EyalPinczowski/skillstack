import { parseTime } from '../dates';
import type { Block, Task } from '../schemas';
import { TASK_TYPE_LABEL } from '../labels';
import { zonedTimeToUtc } from '../zone';

/**
 * iCalendar (.ics, RFC 5545) export of a schedule – the free alternative to calendar sync
 * (spec 3.A). Times are written in UTC so every calendar app places them correctly, and each
 * event carries the task id like the app's own calendar events (spec 3.8).
 */
export interface IcsOptions {
  timeZone: string;
  calendarName?: string;
  /** Fixed timestamp for DTSTAMP, so the same schedule always gives the same file. */
  generatedAt: Date;
}

function utcStamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line to at most 75 octets per line, never splitting a UTF-8 character. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

function describe(task: Task | undefined, block: Block): string {
  if (!task) return '';
  const lines = [`${TASK_TYPE_LABEL[task.type]} · ${block.minutes} min`];
  if (task.provider) lines.push(`Provider: ${task.provider}`);
  if (task.url) lines.push(task.url);
  for (const step of task.howToSteps) lines.push(`- ${step}`);
  if (task.notes) lines.push(task.notes);
  return lines.join('\n');
}

export function scheduleToIcs(blocks: Block[], tasks: Task[], options: IcsOptions): string {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const stamp = utcStamp(options.generatedAt);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Skillstack//Schedule export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(options.calendarName ?? 'Skillstack')}`,
  ];
  for (const b of blocks) {
    const task = byId.get(b.taskId);
    const start = zonedTimeToUtc(b.date, parseTime(b.start), options.timeZone);
    const end = zonedTimeToUtc(b.date, parseTime(b.end), options.timeZone);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.taskId}-${b.date}-${b.start.replace(':', '')}@skillstack`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcStamp(start)}`,
      `DTEND:${utcStamp(end)}`,
      `SUMMARY:${escapeIcsText(task?.title ?? b.taskId)}`,
      `DESCRIPTION:${escapeIcsText(describe(task, b))}`,
      `CATEGORIES:${escapeIcsText(task ? TASK_TYPE_LABEL[task.type] : 'Study')}`,
      `X-SKILLSTACK-TASK-ID:${escapeIcsText(b.taskId)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
