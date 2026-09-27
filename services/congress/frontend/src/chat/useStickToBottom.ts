import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const NEAR_BOTTOM_PX = 96;
// Per-thread scroll offsets from the bottom, kept for the session.
const savedOffsets = new Map<string, number>();

// Chat scrolling: follow growth only while the reader is at the bottom.
// `version` changes when real new content arrives (a message, streamed text);
// only that - not e.g. expanding a tool list - lights the "New" pill.
export function useStickToBottom(key: string, version: string) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const offset = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = offset <= NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setHasNew(false);
    savedOffsets.set(key, near ? 0 : offset);
  }, [key]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottomRef.current = true;
    setAtBottom(true);
    setHasNew(false);
  }, []);

  // Restore on thread change: bottom by default, or where the reader was.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const offset = savedOffsets.get(key) ?? 0;
    el.scrollTop = el.scrollHeight - el.clientHeight - offset;
    atBottomRef.current = offset === 0;
    setAtBottom(offset === 0);
    setHasNew(false);
  }, [key]);

  const lastVersionRef = useRef<{ key: string; version: string } | null>(null);
  useEffect(() => {
    const prev = lastVersionRef.current;
    lastVersionRef.current = { key, version };
    if (!prev || prev.key !== key || prev.version === version) return;
    if (!atBottomRef.current) setHasNew(true);
  }, [key, version]);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    // The viewport itself shrinks when the keyboard opens.
    const viewportObserver = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    viewportObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
      viewportObserver.disconnect();
    };
  }, [measure]);

  // Prepending older messages must not move what the reader is looking at.
  const preserveScroll = useCallback((mutate: () => Promise<unknown>) => {
    const el = scrollRef.current;
    if (!el) return mutate();
    const fromBottom = el.scrollHeight - el.scrollTop;
    return mutate().then(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - fromBottom;
      });
    });
  }, []);

  return { scrollRef, contentRef, atBottom, hasNew, scrollToBottom, preserveScroll };
}
