import type { AppEnv } from '../env';
import { FlaskIcon } from './icons';

/** Only the R&D build shows a badge; the operational build stays clean. */
export function EnvironmentBadge({ appEnv }: { appEnv: AppEnv }) {
  if (appEnv !== 'rnd') return null;
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-sm bg-warn-soft px-3 text-sm font-bold text-warn">
      <FlaskIcon />
      R&amp;D environment
    </span>
  );
}

export function DemoBanner({ appEnv }: { appEnv: AppEnv }) {
  if (appEnv !== 'demo') return null;
  return (
    <div className="border-b border-border bg-accent-soft px-4 py-2 text-center text-sm font-bold text-accent-soft-text">
      Demo – sample data
    </div>
  );
}
