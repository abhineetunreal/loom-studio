// TEMPORARY debug log — remove after diagnosing canvas preset bug
const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
const entries: string[] = [];
const listeners: Array<() => void> = [];

export function debugLog(msg: string) {
  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
  entries.push(`${ms}ms ${msg}`);
  // Keep bounded
  if (entries.length > 200) entries.shift();
  for (const fn of listeners) fn();
}

export function getDebugEntries(): string[] {
  return entries;
}

export function onDebugUpdate(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
