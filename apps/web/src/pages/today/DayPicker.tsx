import { addDays, compareDates } from '@skillstack/shared';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons';
import { Button } from '../../components/ui';

/**
 * Previous and next day plus a date field. A day after today cannot be reached: the next button
 * is disabled on today and the field stops at today. The earliest day is the plan's start.
 */
export function DayPicker({
  date,
  today,
  firstDate,
  onChange,
}: {
  date: string;
  today: string;
  firstDate: string;
  onChange: (date: string) => void;
}) {
  const atFirst = compareDates(date, firstDate) <= 0;
  const atToday = compareDates(date, today) >= 0;
  return (
    <nav aria-label="Choose a day" className="flex flex-wrap items-end gap-3">
      <Button disabled={atFirst} onClick={() => onChange(addDays(date, -1))}>
        <ChevronLeftIcon />
        <span>Previous day</span>
      </Button>
      <Button disabled={atToday} onClick={() => onChange(addDays(date, 1))}>
        <span>Next day</span>
        <ChevronRightIcon />
      </Button>
      <div className="space-y-1">
        <label htmlFor="day-picker" className="block font-bold">
          Go to day
        </label>
        <input
          id="day-picker"
          type="date"
          value={date}
          min={firstDate}
          max={today}
          onChange={(event) => {
            const next = event.target.value;
            // Cleared or typed past the limits: ignore, the field keeps the current day.
            if (next && compareDates(next, firstDate) >= 0 && compareDates(next, today) <= 0) {
              onChange(next);
            }
          }}
          className="min-h-11 rounded-sm border border-border bg-surface px-3 py-2 text-text"
        />
      </div>
      {date !== today ? <Button onClick={() => onChange(today)}>Back to today</Button> : null}
    </nav>
  );
}
