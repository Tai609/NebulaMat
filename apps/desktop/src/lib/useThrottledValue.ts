import { useEffect, useRef, useState } from "react";

/**
 * Rate-limit a rapidly-changing value to at most one update per `ms`, always
 * settling on the latest value (trailing edge).
 *
 * The streaming agent message carries the whole text-so-far and grows on every
 * token (dozens/sec); rendering it re-runs the full react-markdown + KaTeX
 * pipeline over the entire message each time — the main live-turn CPU cost for
 * long answers (#50). Throttling caps that to at most one parse per `ms` window
 * (~11/s at ms=90) while still converging on the final text. A value that stops
 * changing (a finished
 * message) settles after one trailing tick and then never re-renders, so this
 * is free for the rest of the transcript.
 */
export function useThrottledValue<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const lastRef = useRef(0); // timestamp of the last commit (0 → first change is immediate)

  useEffect(() => {
    if (value === shown) return; // already current — nothing to schedule
    const since = Date.now() - lastRef.current;
    if (since >= ms) {
      lastRef.current = Date.now();
      setShown(value);
      return;
    }
    // Too soon: schedule a trailing commit for the remaining window. A newer
    // value arriving first re-runs this effect and reschedules (latest wins).
    const id = window.setTimeout(() => {
      lastRef.current = Date.now();
      setShown(value);
    }, ms - since);
    return () => window.clearTimeout(id);
  }, [value, shown, ms]);

  return shown;
}
