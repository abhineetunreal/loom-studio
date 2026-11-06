import { useEffect, useRef, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `value` has
 * stopped changing for `delayMs`.  Use it to keep expensive work (like a full
 * canvas re-render) from firing on every intermediate value while a slider is
 * being dragged — the heavy consumer reads the debounced value, the slider
 * thumb and number readout read the live value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delayMs]);

  return debounced;
}
