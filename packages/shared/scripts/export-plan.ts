/**
 * Exports a plan file as a schedule: calendar (.ics), printable HTML, CSV log template and a
 * JSON summary. Personal plans are kept outside this repository; pass their path.
 *
 *   pnpm --filter @skillstack/shared export-plan --plan <plan.json> --out <dir> [--today YYYY-MM-DD]
 *        [--no-cv-tasks]   don't add the projected "Update CV and LinkedIn" tasks
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  logTemplateCsv,
  longDate,
  parsePlanFile,
  schedule,
  scheduleToHtml,
  scheduleToIcs,
  withProjectedCvTasks,
  type ScheduleWarning,
  type Task,
} from '../src/index';

const { values } = parseArgs({
  options: {
    plan: { type: 'string' },
    out: { type: 'string' },
    today: { type: 'string' },
    'no-cv-tasks': { type: 'boolean', default: false },
  },
});

if (!values.plan || !values.out) {
  console.error(
    'Usage: export-plan --plan <plan.json> --out <dir> [--today YYYY-MM-DD] [--no-cv-tasks]',
  );
  process.exit(2);
}

const plan = parsePlanFile(JSON.parse(readFileSync(resolve(values.plan), 'utf8')));
const tasks: Task[] = values['no-cv-tasks'] ? plan.tasks : withProjectedCvTasks(plan.tasks);
const today = values.today ?? plan.startDate;
const result = schedule({
  tasks,
  pattern: plan.weekPattern,
  overrides: plan.overrides,
  today,
});

const title = (id: string) => tasks.find((t) => t.id === id)?.title ?? id;
const describeWarning = (w: ScheduleWarning): string => {
  switch (w.kind) {
    case 'anchor_at_risk':
      return `${title(w.taskId)} on ${longDate(w.anchorDate)} at ${w.anchorStartTime} is at risk: ${Math.round(w.shortfallMinutes / 6) / 10} h of the tasks before it don't fit. Options: add hours, add a study day, or move the exam.`;
    case 'anchor_in_past':
      return `${title(w.taskId)} was set for ${longDate(w.anchorDate)}, which has passed.`;
    case 'unscheduled':
      return `${title(w.taskId)} doesn't fit (${Math.round(w.remainingMinutes / 6) / 10} h left over).`;
    case 'dependency_cycle':
      return `These tasks depend on each other in a loop: ${w.taskIds.map(title).join(', ')}.`;
  }
};
const warnings = result.warnings.map(describeWarning);

const out = resolve(values.out);
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'schedule.ics'),
  scheduleToIcs(result.blocks, tasks, {
    timeZone: plan.weekPattern.timezone,
    calendarName: 'Skillstack',
    generatedAt: new Date(),
  }),
);
writeFileSync(
  join(out, 'schedule.html'),
  scheduleToHtml(result, tasks, {
    title: plan.name,
    subtitle: `From ${longDate(today)}.`,
    warnings,
  }),
);
writeFileSync(join(out, 'log-template.csv'), logTemplateCsv(result, tasks));
writeFileSync(
  join(out, 'summary.json'),
  JSON.stringify(
    {
      plan: plan.name,
      today,
      finishDate: result.finishDate,
      totalHours: result.blocks.reduce((s, b) => s + b.minutes, 0) / 60,
      days: result.days
        .filter((d) => d.isStudyDay)
        .map((d) => ({
          date: d.date,
          scheduledHours: d.scheduledMinutes / 60,
          capacityHours: d.capacityMinutes / 60,
        })),
      warnings,
    },
    null,
    2,
  ),
);

console.log(`${plan.name}: ${result.blocks.length} blocks, finish ${result.finishDate ?? '–'}`);
for (const w of warnings) console.log(`WARNING: ${w}`);
console.log(`Written to ${out}`);
