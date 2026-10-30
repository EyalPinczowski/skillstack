import {
  addDays,
  compareDates,
  diffDays,
  formatTime,
  hoursToMinutes,
  parseTime,
  type LocalDate,
  type Minutes,
} from '../dates';
import type { Block, BlockKind, BusyInterval, DayOverride, Task, WeekPattern } from '../schemas';
import {
  busyIntervalsOn,
  dayCapacity,
  mergeIntervals,
  studyWindow,
  subtractIntervals,
  type Interval,
} from './capacity';

/**
 * The scheduling engine (spec section 2 and 3.6): a pure function that places an ordered task
 * list on days according to each day's capacity, the task order and dependencies.
 *
 * Rules, in short:
 * - Days before `today` never change: `frozenBlocks` are returned exactly as given.
 * - Anchor tasks (exams) sit at their fixed date and start time; pinned tasks and blocks the
 *   user locked (e.g. by moving them in their calendar) also keep their time. Everything else
 *   is scheduled around them.
 * - A day is never filled beyond its capacity. Blocks stay inside the daily window, outside
 *   lunch and busy events. A short break follows every `breakEveryHours` of continuous study.
 * - Splittable tasks may span days; non-splittable ones (exams, mock interviews) need one
 *   contiguous slot. No block is shorter than `minBlockMinutes`, except the last piece of a
 *   task that is itself shorter.
 * - Tasks are taken in `order`. When the next task doesn't fit in the time left, a later task
 *   that does fit (and whose dependencies are done) uses it, so time isn't wasted.
 * - CV-update tasks go first once their certificate is done, so they land on the same day
 *   whenever there is room.
 */
export interface ScheduleInput {
  tasks: Task[];
  pattern: WeekPattern;
  overrides?: DayOverride[];
  busy?: BusyInterval[];
  /** The first day that may change. */
  today: LocalDate;
  /** Schedule today only from this time on (for a reschedule in the middle of the day). */
  nowMinutes?: Minutes;
  /** Blocks on days before `today`, returned unchanged. */
  frozenBlocks?: Block[];
  /** Future blocks the user fixed in place. */
  lockedBlocks?: Block[];
  /** How far ahead to schedule before giving up. Default 365 days. */
  horizonDays?: number;
}

export interface DayPlan {
  date: LocalDate;
  isStudyDay: boolean;
  capacityMinutes: number;
  scheduledMinutes: number;
  blocks: Block[];
  breaks: { start: string; end: string }[];
}

export type AnchorOption =
  | { kind: 'add_hours'; minutes: number }
  | { kind: 'add_day' }
  | { kind: 'move_exam'; earliestDate: LocalDate | null };

export type ScheduleWarning =
  | {
      kind: 'anchor_at_risk';
      taskId: string;
      anchorDate: LocalDate;
      anchorStartTime: string;
      /** Study minutes of the tasks before the exam that don't fit before it. */
      shortfallMinutes: number;
      lateTaskIds: string[];
      options: AnchorOption[];
    }
  | { kind: 'anchor_in_past'; taskId: string; anchorDate: LocalDate }
  | {
      kind: 'unscheduled';
      taskId: string;
      remainingMinutes: number;
      /** The first task that can never finish (on a cycle, or an anchor in the past). */
      blockedBy?: string;
    }
  | { kind: 'dependency_cycle'; taskIds: string[] }
  /** A fixed block ran past 23:59; the part after it was dropped. */
  | { kind: 'fixed_block_truncated'; taskId: string; date: LocalDate; droppedMinutes: number }
  /** Fixed blocks (anchor, pinned, locked) alone take more than the day's capacity. */
  | { kind: 'over_capacity'; date: LocalDate; scheduledMinutes: number; capacityMinutes: number }
  | { kind: 'fixed_overlap'; date: LocalDate; taskIds: string[] };

export interface ScheduleResult {
  days: DayPlan[];
  blocks: Block[];
  /** Date of the last scheduled block, or null if nothing is scheduled. */
  finishDate: LocalDate | null;
  warnings: ScheduleWarning[];
}

const DONE = Number.NEGATIVE_INFINITY;
const MINUTES_PER_DAY = 1440;
/** The last minute a block may end on: 23:59. */
const LAST_MINUTE = MINUTES_PER_DAY - 1;

/** Remaining minutes of a task: estimate minus logged hours; 0 when done or skipped. */
export function remainingMinutes(task: Task): number {
  if (task.status === 'done' || task.status === 'skipped') return 0;
  return Math.max(0, hoursToMinutes(task.estHours) - hoursToMinutes(task.doneHours));
}

/** Sorted ids of every task on a dependency cycle (empty when the graph is acyclic). */
export function findDependencyCycle(tasks: Task[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const nodes = new Map<string, { index: number; low: number }>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const onCycle: string[] = [];
  const connect = (id: string) => {
    const node = { index: nodes.size, low: nodes.size };
    nodes.set(id, node);
    stack.push(id);
    onStack.add(id);
    const deps = byId.get(id)?.dependsOn ?? [];
    for (const dep of deps) {
      if (!byId.has(dep)) continue;
      const other = nodes.get(dep);
      if (!other) {
        connect(dep);
        node.low = Math.min(node.low, nodes.get(dep)?.low ?? node.low);
      } else if (onStack.has(dep)) {
        node.low = Math.min(node.low, other.index);
      }
    }
    if (node.low !== node.index) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    if (component.length > 1 || deps.includes(id)) onCycle.push(...component);
  };
  for (const t of tasks) if (!nodes.has(t.id)) connect(t.id);
  return onCycle.sort();
}

function pushByDate(map: Map<LocalDate, Block[]>, b: Block): void {
  const list = map.get(b.date);
  if (list) list.push(b);
  else map.set(b.date, [b]);
}

function block(
  taskId: string,
  date: LocalDate,
  start: Minutes,
  end: Minutes,
  kind: BlockKind,
): Block {
  return {
    taskId,
    date,
    start: formatTime(start),
    end: formatTime(end),
    minutes: end - start,
    kind,
  };
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const { tasks, pattern, today } = input;
  const overrides = input.overrides ?? [];
  const busy = input.busy ?? [];
  const frozen = (input.frozenBlocks ?? []).filter((b) => compareDates(b.date, today) < 0);
  const horizon = input.horizonDays ?? 365;
  const minBlock = pattern.minBlockMinutes;
  const breakEvery = pattern.breakMinutes > 0 ? hoursToMinutes(pattern.breakEveryHours) : Infinity;
  const window = studyWindow(pattern);
  const warnings: ScheduleWarning[] = [];

  // Absolute time on a single axis, so "ends before starts" works across days.
  const abs = (date: LocalDate, minutes: Minutes): number =>
    diffDays(today, date) * MINUTES_PER_DAY + minutes;

  const cycle = findDependencyCycle(tasks);
  if (cycle.length) warnings.push({ kind: 'dependency_cycle', taskIds: cycle });

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const remaining = new Map<string, number>();
  const endAt = new Map<string, number>(); // set when a task's work is fully placed
  const lastFixedEnd = new Map<string, number>();
  const noGreedy = new Set<string>(cycle);

  for (const t of tasks) {
    const r = remainingMinutes(t);
    remaining.set(t.id, r);
    if (r === 0) endAt.set(t.id, DONE);
  }

  // 1. Fixed blocks: anchors (exams), pinned tasks and blocks the user locked.
  const fixed: Block[] = [];
  const fixedByDate = new Map<LocalDate, Block[]>();
  const earliest = new Map<string, number>(); // a task may not start before this absolute time
  const takeFixed = (
    task: Task,
    date: LocalDate,
    start: Minutes,
    minutes: number,
    kind: BlockKind,
  ) => {
    const left = remaining.get(task.id) ?? 0;
    const len = Math.min(minutes, left);
    if (len <= 0) return;
    const end = Math.min(start + len, LAST_MINUTE);
    const placed = Math.max(0, end - start);
    // An exam or a task that can't be split loses what runs past midnight; a splittable task
    // only had this block cut short, so the rest is scheduled like any other remaining time.
    const whole = kind === 'anchor' || !task.splittable;
    const dropped = whole ? len - placed : 0;
    if (placed > 0) {
      const b = block(task.id, date, start, end, kind);
      fixed.push(b);
      pushByDate(fixedByDate, b);
      lastFixedEnd.set(task.id, Math.max(lastFixedEnd.get(task.id) ?? DONE, abs(date, end)));
    }
    remaining.set(task.id, dropped > 0 ? 0 : left - placed);
    if (dropped > 0) {
      warnings.push({
        kind: 'fixed_block_truncated',
        taskId: task.id,
        date,
        droppedMinutes: dropped,
      });
    }
  };

  const isFixedAnchor = (task: Task) =>
    task.isAnchor && task.anchorDate !== undefined && task.anchorStartTime !== undefined;
  const pinnedFrom = (task: Task) =>
    !isFixedAnchor(task) && task.pinnedStart && compareDates(task.pinnedStart.date, today) >= 0
      ? task.pinnedStart
      : undefined;

  for (const lb of input.lockedBlocks ?? []) {
    const task = byId.get(lb.taskId);
    if (!task || compareDates(lb.date, today) < 0) continue;
    takeFixed(task, lb.date, parseTime(lb.start), lb.minutes, 'locked');
  }
  for (const task of tasks) {
    if (task.isAnchor && task.anchorDate && task.anchorStartTime) {
      if ((remaining.get(task.id) ?? 0) === 0) continue;
      if (compareDates(task.anchorDate, today) < 0) {
        warnings.push({ kind: 'anchor_in_past', taskId: task.id, anchorDate: task.anchorDate });
        noGreedy.add(task.id);
        continue;
      }
      takeFixed(task, task.anchorDate, parseTime(task.anchorStartTime), Infinity, 'anchor');
      noGreedy.add(task.id);
    } else {
      // A task that can't be split is placed whole at the pinned time, like an anchor.
      const pin = pinnedFrom(task);
      if (pin && !task.splittable) {
        takeFixed(task, pin.date, parseTime(pin.start), Infinity, 'pinned');
      }
    }
  }
  // A splittable pinned task starts at the pinned time and uses the free time from there.
  for (const task of tasks) {
    const pin = pinnedFrom(task);
    const need = remaining.get(task.id) ?? 0;
    if (!pin || !task.splittable || need <= 0) continue;
    const start = parseTime(pin.start);
    earliest.set(task.id, abs(pin.date, start));
    const cap = dayCapacity(pin.date, pattern, overrides, busy);
    if (!cap.isStudyDay) continue;
    const dayFixed = fixedByDate.get(pin.date) ?? [];
    const capLeft = cap.capacityMinutes - dayFixed.reduce((s, b) => s + b.minutes, 0);
    const slot = subtractIntervals(window, [
      ...busyIntervalsOn(pin.date, busy),
      ...dayFixed.map((b) => ({ start: parseTime(b.start), end: parseTime(b.end) })),
    ]).find((i) => i.start <= start && start < i.end);
    if (!slot) continue;
    const len = Math.min(need, slot.end - start, capLeft);
    if (len <= 0) continue;
    takeFixed(task, pin.date, start, len, 'pinned');
    if ((remaining.get(task.id) ?? 0) > 0) earliest.set(task.id, abs(pin.date, start + len));
  }
  for (const t of tasks) {
    if ((remaining.get(t.id) ?? 0) === 0 && !endAt.has(t.id)) {
      endAt.set(t.id, lastFixedEnd.get(t.id) ?? DONE);
    }
  }

  for (const [date, list] of [...fixedByDate].sort((a, b) => compareDates(a[0], b[0]))) {
    const capacityMinutes = dayCapacity(date, pattern, overrides, busy).capacityMinutes;
    const scheduledMinutes = list.reduce((s, b) => s + b.minutes, 0);
    if (scheduledMinutes > capacityMinutes) {
      warnings.push({ kind: 'over_capacity', date, scheduledMinutes, capacityMinutes });
    }
    const sorted = [...list].sort((a, b) => parseTime(a.start) - parseTime(b.start));
    const overlapping = new Set<string>();
    let reach = -1;
    let reachTask = '';
    for (const b of sorted) {
      if (parseTime(b.start) < reach) {
        overlapping.add(b.taskId);
        overlapping.add(reachTask);
      }
      if (parseTime(b.end) > reach) {
        reach = parseTime(b.end);
        reachTask = b.taskId;
      }
    }
    if (overlapping.size) {
      warnings.push({ kind: 'fixed_overlap', date, taskIds: [...overlapping].sort() });
    }
  }

  // Tasks that wait on a task that can never finish would only make the day loop run to the
  // end of the horizon, so they are left out of the greedy pass.
  const blockerMemo = new Map<string, string | undefined>();
  const blockerOf = (id: string): string | undefined => {
    if (blockerMemo.has(id)) return blockerMemo.get(id);
    let found: string | undefined;
    if (!byId.has(id) || endAt.has(id)) found = undefined;
    else if (noGreedy.has(id)) found = id;
    else {
      for (const dep of byId.get(id)?.dependsOn ?? []) {
        found = blockerOf(dep);
        if (found) break;
      }
    }
    blockerMemo.set(id, found);
    return found;
  };
  const blockedBy = new Map<string, string>();
  for (const t of tasks) {
    if (noGreedy.has(t.id) || (remaining.get(t.id) ?? 0) <= 0) continue;
    const blocker = blockerOf(t.id);
    if (blocker) blockedBy.set(t.id, blocker);
  }
  for (const id of blockedBy.keys()) noGreedy.add(id);

  // Priority: CV updates first, then the plan order.
  const queue = [...tasks].sort(
    (a, b) =>
      Number(b.type === 'cv_update') - Number(a.type === 'cv_update') ||
      a.order - b.order ||
      a.id.localeCompare(b.id),
  );

  const depsDoneBy = (task: Task, at: number): boolean =>
    task.dependsOn.every((dep) => {
      if (!byId.has(dep)) return true; // unknown ids are rejected when a plan is parsed
      const end = endAt.get(dep);
      return end !== undefined && end <= at;
    });

  const greedy: Block[] = [];
  const greedyByDate = new Map<LocalDate, Block[]>();
  const breaksByDate = new Map<LocalDate, Interval[]>();

  // 2. Fill the days, one at a time.
  for (let offset = 0; offset <= horizon; offset++) {
    const date = addDays(today, offset);
    const workLeft = queue.some((t) => !noGreedy.has(t.id) && (remaining.get(t.id) ?? 0) > 0);
    if (!workLeft) break;

    const cap = dayCapacity(date, pattern, overrides, busy);
    if (!cap.isStudyDay) continue;

    const fixedToday = fixedByDate.get(date) ?? [];
    let capLeft = Math.max(0, cap.capacityMinutes - fixedToday.reduce((s, b) => s + b.minutes, 0));
    let free = subtractIntervals(window, [
      ...busyIntervalsOn(date, busy),
      ...fixedToday.map((b) => ({ start: parseTime(b.start), end: parseTime(b.end) })),
    ]);
    if (offset === 0 && input.nowMinutes !== undefined) {
      free = subtractIntervals(free, [{ start: 0, end: input.nowMinutes }]);
    }

    const breaks: Interval[] = [];
    let continuous = 0;
    let prevEnd = -1;

    for (const slot of mergeIntervals(free)) {
      let t = slot.start;
      while (t < slot.end && capLeft > 0) {
        if (prevEnd !== t) continuous = 0;
        if (prevEnd === t && continuous >= breakEvery) {
          breaks.push({ start: t, end: t + pattern.breakMinutes });
          t += pattern.breakMinutes;
          continuous = 0;
          prevEnd = -1;
          continue;
        }

        let placed = false;
        let wake = Infinity; // when a task held back by `earliest` may start
        for (const task of queue) {
          const need = remaining.get(task.id) ?? 0;
          if (need <= 0 || noGreedy.has(task.id)) continue;
          if (task.notBefore && compareDates(date, task.notBefore) < 0) continue;
          const from = earliest.get(task.id);
          if (from !== undefined && abs(date, t) < from) {
            wake = Math.min(wake, from - abs(date, 0));
            continue;
          }
          if (!depsDoneBy(task, abs(date, t))) continue;

          const room = Math.min(slot.end - t, capLeft);
          let len: number;
          if (task.splittable) {
            len = Math.min(need, room, breakEvery - continuous);
            if (len < Math.min(minBlock, need)) continue;
            // Don't leave a remainder shorter than the minimum block if it can be avoided.
            const rest = need - len;
            if (rest > 0 && rest < minBlock && len - (minBlock - rest) >= minBlock) {
              len -= minBlock - rest;
            }
          } else {
            if (need > room) continue;
            // Can't be cut by a break, so start it fresh after one if it would run past the limit.
            if (continuous > 0 && continuous + need > breakEvery) continue;
            len = need;
          }

          const placedBlock = block(task.id, date, t, t + len, 'study');
          greedy.push(placedBlock);
          pushByDate(greedyByDate, placedBlock);
          remaining.set(task.id, need - len);
          capLeft -= len;
          continuous += len;
          t += len;
          prevEnd = t;
          if (need - len === 0) {
            endAt.set(task.id, Math.max(abs(date, t), lastFixedEnd.get(task.id) ?? DONE));
          }
          placed = true;
          break;
        }
        if (placed) continue;
        // Nothing fits before the next break is due: take the break and try again after it.
        if (prevEnd === t && continuous > 0 && breakEvery !== Infinity) {
          breaks.push({ start: t, end: t + pattern.breakMinutes });
          t += pattern.breakMinutes;
          continuous = 0;
          prevEnd = -1;
          continue;
        }
        if (wake < slot.end) {
          t = wake;
          continue;
        }
        break;
      }
    }

    // Keep only breaks that are followed by study.
    const starts = new Set((greedyByDate.get(date) ?? []).map((b) => parseTime(b.start)));
    breaksByDate.set(
      date,
      breaks.filter((b) => starts.has(b.end)),
    );
  }

  // 3. Warnings.
  for (const t of tasks) {
    const left = remaining.get(t.id) ?? 0;
    if (left > 0 && !(t.isAnchor && noGreedy.has(t.id))) {
      const blocker = blockedBy.get(t.id);
      warnings.push({
        kind: 'unscheduled',
        taskId: t.id,
        remainingMinutes: left,
        ...(blocker ? { blockedBy: blocker } : {}),
      });
    }
  }

  const all = [...frozen, ...fixed, ...greedy].sort(
    (a, b) => compareDates(a.date, b.date) || parseTime(a.start) - parseTime(b.start),
  );

  for (const task of tasks) {
    if (!task.isAnchor || !task.anchorDate || !task.anchorStartTime) continue;
    if (!fixed.some((b) => b.taskId === task.id && b.kind === 'anchor')) continue;
    const anchorStart = abs(task.anchorDate, parseTime(task.anchorStartTime));
    const late = transitiveDeps(task, byId).filter((id) => {
      const end = endAt.get(id);
      return end === undefined || end > anchorStart;
    });
    if (late.length === 0) continue;
    let shortfall = 0;
    let latestEnd: number | undefined;
    for (const id of late) {
      shortfall += remaining.get(id) ?? 0;
      for (const b of all) {
        if (b.taskId !== id) continue;
        const s = abs(b.date, parseTime(b.start));
        const e = abs(b.date, parseTime(b.end));
        if (e > anchorStart) shortfall += e - Math.max(s, anchorStart);
      }
      const end = endAt.get(id);
      if (end !== undefined && end !== DONE) latestEnd = Math.max(latestEnd ?? end, end);
    }
    const unplaced = late.some((id) => (remaining.get(id) ?? 0) > 0);
    warnings.push({
      kind: 'anchor_at_risk',
      taskId: task.id,
      anchorDate: task.anchorDate,
      anchorStartTime: task.anchorStartTime,
      shortfallMinutes: shortfall,
      lateTaskIds: late,
      options: [
        { kind: 'add_hours', minutes: shortfall },
        { kind: 'add_day' },
        {
          kind: 'move_exam',
          earliestDate:
            unplaced || latestEnd === undefined
              ? null
              : addDays(today, Math.floor(latestEnd / MINUTES_PER_DAY) + 1),
        },
      ],
    });
  }

  const finishDate = all.length ? (all[all.length - 1]?.date ?? null) : null;
  return {
    days: buildDays(all, breaksByDate, pattern, overrides, busy, today, finishDate),
    blocks: all,
    finishDate,
    warnings,
  };
}

function transitiveDeps(task: Task, byId: Map<string, Task>): string[] {
  const seen = new Set<string>();
  const walk = (t: Task) => {
    for (const dep of t.dependsOn) {
      const d = byId.get(dep);
      if (!d || seen.has(dep)) continue;
      seen.add(dep);
      walk(d);
    }
  };
  walk(task);
  return [...seen];
}

function buildDays(
  blocks: Block[],
  breaksByDate: Map<LocalDate, Interval[]>,
  pattern: WeekPattern,
  overrides: DayOverride[],
  busy: BusyInterval[],
  today: LocalDate,
  finishDate: LocalDate | null,
): DayPlan[] {
  const first = blocks[0]?.date ?? today;
  const start = compareDates(first, today) < 0 ? first : today;
  const end = finishDate && compareDates(finishDate, today) > 0 ? finishDate : today;
  const days: DayPlan[] = [];
  const byDate = new Map<LocalDate, Block[]>();
  for (const b of blocks) pushByDate(byDate, b);
  for (let d = start; compareDates(d, end) <= 0; d = addDays(d, 1)) {
    const cap = dayCapacity(d, pattern, overrides, busy);
    const dayBlocks = byDate.get(d) ?? [];
    days.push({
      date: d,
      isStudyDay: cap.isStudyDay,
      capacityMinutes: cap.capacityMinutes,
      scheduledMinutes: dayBlocks.reduce((s, b) => s + b.minutes, 0),
      blocks: dayBlocks,
      breaks: (breaksByDate.get(d) ?? []).map((b) => ({
        start: formatTime(b.start),
        end: formatTime(b.end),
      })),
    });
  }
  return days;
}
