import { useEffect, useState } from "react";

// Ticks every `periodMs` so a directive's progress ring keeps filling
// between refetches.
export function useNowTick(periodMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return now;
}
