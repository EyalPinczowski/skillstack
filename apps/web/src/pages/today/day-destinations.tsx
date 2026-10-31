import { Link } from 'react-router';
import { linkClass } from '../../components/ui';

/** Where the day flow leads next: the day briefing (spec 3.2) and the end-of-day review (spec 3.4). */
export function BriefingLink({ date }: { date: string }) {
  return (
    <Link to={`/briefing/${date}`} className={`${linkClass} inline-flex min-h-11 items-center`}>
      Open the day briefing
    </Link>
  );
}

export function ReviewLink({ date }: { date: string }) {
  return (
    <Link to={`/review/${date}`} className={`${linkClass} inline-flex min-h-11 items-center`}>
      Review the day
    </Link>
  );
}
