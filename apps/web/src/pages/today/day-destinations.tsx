/**
 * Where the day flow leads next. Both screens arrive in later pull requests (the day briefing,
 * spec 3.2, and the end-of-day review, spec 3.4). Until then these two components say so in words.
 * When a screen lands, replace the matching component with a link to its route; nothing else in
 * the dashboard needs to change.
 */

/** Shown after "Start study day". PLACEHOLDER: the briefing screen is built in the next PR. */
export function BriefingDestinationPlaceholder() {
  return <p className="text-muted">The day briefing opens here in the next update.</p>;
}

/** Shown after "End day". PLACEHOLDER: the review screen is built in the next PR. */
export function ReviewDestinationPlaceholder() {
  return <p className="text-muted">The end-of-day review opens here in the next update.</p>;
}
