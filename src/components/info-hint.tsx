"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import styles from "./info-hint.module.css";

/** Optional context only; keep important status, errors and coverage in the main view. */
export default function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const suppressed = useRef(false);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") { suppressed.current = true; setOpen(false); setPinned(false); }
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setOpen(false); setPinned(false); }
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", dismiss); document.removeEventListener("pointerdown", outside); };
  }, [open]);

  return <span ref={root} className={styles.root}
    onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); suppressed.current = true; setOpen(false); setPinned(false); } }}
    onMouseEnter={() => { if (!suppressed.current) setOpen(true); }}
    onMouseLeave={() => { suppressed.current = false; if (!pinned && !root.current?.contains(document.activeElement)) setOpen(false); }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { suppressed.current = false; if (!pinned) setOpen(false); } }}>
    <button type="button" data-info-hint className={styles.trigger} aria-label={label} aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible") && !suppressed.current) setOpen(true); }}
      onClick={() => { suppressed.current = false; setPinned(!pinned); setOpen(!pinned); }}><Info size={15} aria-hidden="true" /></button>
    <span id={id} role="tooltip" className={styles.content} hidden={!open}>{children}</span>
  </span>;
}
