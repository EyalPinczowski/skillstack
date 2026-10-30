import { describe, expect, it } from 'vitest';
import { schedule } from '../scheduling/engine';
import { basePattern, task } from '../scheduling/test-helpers';
import { TASK_TYPE_LABEL } from '../labels';
import { escapeIcsText, foldIcsLine, scheduleToIcs } from './ics';
import { logTemplateCsv, longDate, scheduleToHtml } from './printable';

const exam = task({
  id: 'exam',
  title: 'Exam, part 1; final',
  type: 'cert_exam',
  estHours: 1.5,
  splittable: false,
  isAnchor: true,
  anchorDate: '2026-11-02',
  anchorStartTime: '09:00',
});
const course = task({ id: 'course', title: 'SQL basics', estHours: 3 });
const tasks = [course, exam];
const result = schedule({ tasks, pattern: basePattern, today: '2026-11-01' });

describe('iCalendar export', () => {
  const ics = scheduleToIcs(result.blocks, tasks, {
    timeZone: 'Asia/Jerusalem',
    generatedAt: new Date('2026-10-30T08:00:00Z'),
  });

  it('writes one event per block, in UTC, with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(result.blocks.length);
    // 09:00 in Israel on 2 Nov 2026 (UTC+2) is 07:00 UTC.
    expect(ics).toContain('DTSTART:20261102T070000Z');
    expect(ics).toContain('DTEND:20261102T083000Z');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it('escapes text and tags each event with its task id', () => {
    expect(ics).toContain('SUMMARY:Exam\\, part 1\\; final');
    expect(ics).toContain('X-SKILLSTACK-TASK-ID:exam');
    expect(escapeIcsText('a\nb')).toBe('a\\nb');
  });

  it('folds long lines without breaking multi-byte characters', () => {
    const folded = foldIcsLine(`SUMMARY:${'é'.repeat(80)}`);
    for (const line of folded.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(80)}`);
  });
});

describe('printable schedule and log template', () => {
  it('renders each study day with its blocks and escapes HTML', () => {
    const html = scheduleToHtml(result, [...tasks, task({ id: 'x', title: '<b>', estHours: 1 })], {
      title: 'Test & plan',
    });
    expect(html).toContain('Test &amp; plan');
    expect(html).toContain(longDate('2026-11-02'));
    expect(html).toContain('Exam · fixed time');
  });

  it('formats dates in words', () => {
    expect(longDate('2026-11-01')).toBe('Sunday, 1 November 2026');
  });

  it('writes one CSV row per task per day, quoting commas', () => {
    const csv = logTemplateCsv(result, tasks);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('date,task_id,task,type,planned_hours,actual_hours,status,note');
    expect(csv).toContain('2026-11-01,course,SQL basics,course,3,,,');
    expect(csv).toContain('"Exam, part 1; final"');
  });

  it('quotes carriage returns and neutralises spreadsheet formulas', () => {
    const risky = [
      task({ id: 'f1', title: '=SUM(A1)', estHours: 1, order: 1 }),
      task({ id: 'f2', title: '@cmd', estHours: 1, order: 2 }),
      task({ id: 'f3', title: 'a\rb', estHours: 1, order: 3 }),
      task({ id: 'f4', title: '-5, then', estHours: 1, order: 4 }),
      task({ id: 'f5', title: '\tTabbed', estHours: 1, order: 5 }),
    ];
    const res = schedule({ tasks: risky, pattern: basePattern, today: '2026-11-01' });
    const csv = logTemplateCsv(res, risky);
    expect(csv).toContain(",'=SUM(A1),");
    expect(csv).toContain(",'@cmd,");
    expect(csv).toContain(',"a\rb",');
    expect(csv).toContain(',"\'-5, then",');
    expect(csv).toContain(",'\tTabbed,");
    // Planned hours stay plain numbers.
    expect(csv).toContain("f1,'=SUM(A1),course,1,,,");
  });
});

describe('task type labels', () => {
  it('are shared by both exports', () => {
    expect(TASK_TYPE_LABEL.cert_exam).toBe('Exam');
    expect(TASK_TYPE_LABEL.cv_update).toBe('CV update');
  });
});
