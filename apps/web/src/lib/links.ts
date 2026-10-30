/**
 * Returns the URL only when it is a plain web link. A task or lesson link comes from an imported
 * file, so `javascript:` and other schemes are never rendered as links.
 */
export function safeWebUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
