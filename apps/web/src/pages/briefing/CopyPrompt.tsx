import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui';

type CopyState = 'idle' | 'copied' | 'failed';

/** Selects the text so it can be copied by hand, and tries the old copy command as a fallback. */
function copyWithSelection(node: HTMLElement | null): boolean {
  if (!node) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.addRange(range);
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  }
}

/**
 * A ready-made prompt with a Copy button. Uses the clipboard API; when it is missing or refused the
 * text is selected for a manual copy and the message says so. "Copied" is announced politely.
 */
export function CopyPrompt({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const preRef = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = copyWithSelection(preRef.current);
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setState('idle'), 4000);
  }

  return (
    <div className="space-y-2">
      <pre
        ref={preRef}
        tabIndex={0}
        aria-label={label}
        className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface-2 p-3 font-mono text-sm"
      >
        {text}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void copy()}>
          Copy prompt<span className="sr-only">: {label}</span>
        </Button>
        <span role="status" aria-live="polite" className="font-bold text-ok">
          {state === 'copied' ? 'Copied' : ''}
        </span>
        {state === 'failed' ? (
          <span role="alert" className="font-bold text-warn">
            Couldn’t copy automatically. The text is selected: copy it by hand.
          </span>
        ) : null}
      </div>
    </div>
  );
}
