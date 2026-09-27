import { useEffect, useState } from "react";

// The current time, refreshed once a minute - enough for a "now" line to
// visibly move over a session.
export function useNow(periodMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return now;
}
