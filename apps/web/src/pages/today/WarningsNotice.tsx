import { AlertIcon } from '../../components/icons';
import { describeWarning, type ScheduleWarning } from '../../lib/warnings';

/** Warnings from the schedule, pinned above the day. Words plus an icon, never colour alone. */
export function WarningsNotice({
  warnings,
  titleOf,
}: {
  warnings: ScheduleWarning[];
  titleOf: (taskId: string) => string;
}) {
  if (warnings.length === 0) return null;
  return (
    <section aria-label="Schedule warnings" className="space-y-2">
      {warnings.map((warning, index) => {
        const { label, text } = describeWarning(warning, titleOf);
        return (
          <div
            key={`${warning.kind}-${index}`}
            className="flex items-start gap-3 rounded-md border border-warn bg-warn-soft p-3"
          >
            <span className="text-warn">
              <AlertIcon />
            </span>
            <p>
              <strong className="text-warn">{label}:</strong> {text}
            </p>
          </div>
        );
      })}
    </section>
  );
}
