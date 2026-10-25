"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildSummary, itemLabel, summaryText } from "@/lib/format";
import type { ListData } from "@/lib/types";
import type { SaveState, Toast } from "./useList";

export function Thumb({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <span className="thumb thumb-letter" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    // Plain <img>: hotlinked product photos, no need for the image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="thumb"
      src={src}
      alt=""
      width={48}
      height={48}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function SaveStatus({ state }: { state: SaveState }) {
  return (
    <p className="save-status" role="status" aria-live="polite">
      {state === "saving" ? "Saving..." : state === "saved" ? "Saved" : ""}
    </p>
  );
}

export function ToastView({
  toast,
  onClose,
  low = false,
}: {
  toast: Toast;
  onClose: () => void;
  low?: boolean;
}) {
  return (
    <div className={`toast-region${low ? " low" : ""}`} aria-live="assertive">
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.text}</span>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export function LoadState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <div className="card state" role="alert">
        <p>{error}</p>
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="card state" role="status" aria-live="polite">
      <p>Loading the list...</p>
    </div>
  );
}

/**
 * Copies text. If the clipboard is blocked, returns the text so the caller can show it
 * selected for a manual copy.
 */
export function useCopy(onCopied: (label: string) => void) {
  const [fallback, setFallback] = useState<{ text: string; label: string } | null>(null);

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
        await navigator.clipboard.writeText(text);
        setFallback(null);
        onCopied(label);
      } catch {
        setFallback({ text, label });
      }
    },
    [onCopied],
  );

  return { copy, fallback, dismiss: () => setFallback(null) };
}

export function CopyFallback({
  fallback,
  onClose,
}: {
  fallback: { text: string; label: string } | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    el.setSelectionRange(0, el.value.length);
  }, [fallback]);

  if (!fallback) return null;
  return (
    <div className="copy-fallback" role="region" aria-label={`${fallback.label} text`}>
      <p className="muted">
        Couldn&apos;t copy automatically. The text below is selected: use your phone&apos;s Copy
        option (or press Ctrl+C / Cmd+C).
      </p>
      <textarea
        ref={ref}
        className="textarea"
        readOnly
        value={fallback.text}
        aria-label={fallback.label}
        rows={Math.min(14, fallback.text.split("\n").length + 1)}
      />
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Notes and adds grouped by store, with a Copy button. Shared by both pages. */
export function NotesSummary({
  data,
  onCopied,
  headingLevel = 2,
}: {
  data: ListData;
  onCopied: (label: string) => void;
  headingLevel?: 2 | 3;
}) {
  const summary = buildSummary(data);
  const { copy, fallback, dismiss } = useCopy(onCopied);
  const H = headingLevel === 2 ? "h2" : "h3";

  if (summary.length === 0) {
    return (
      <div className="card empty">
        <p>No notes or adds yet.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      {summary.map((s) => (
        <section className="card" key={s.store} aria-label={s.store}>
          <div className="card-head">
            <H>{s.store === "Either" ? "Either store" : s.store}</H>
            <span className="mono muted">{s.notes.length + s.adds.length}</span>
          </div>
          <ul className="rows">
            {s.notes.map(({ item, note }) => (
              <li className="row-text" key={`n-${item.id}`} style={{ display: "block" }}>
                <p className="row-name">{itemLabel(item)}</p>
                <div className="note-callout">
                  <p>{note.text}</p>
                </div>
              </li>
            ))}
            {s.adds.map((a) => (
              <li className="row-text" key={`a-${a.id}`} style={{ display: "block" }}>
                <p className="row-name">
                  {a.text}
                  <span className="tag">Added</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div>
        <button type="button" className="btn" onClick={() => copy(summaryText(summary), "Notes and adds")}>
          Copy notes and adds
        </button>
        <CopyFallback fallback={fallback} onClose={dismiss} />
      </div>
    </div>
  );
}
