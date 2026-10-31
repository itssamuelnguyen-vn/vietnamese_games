// Entries in `next` that weren't in `prev`. Game logs keep only their latest entries, so their
// length stops growing; new entries are found by matching the tail of the previous log instead.
export function freshEntries<T>(prev: T[], next: T[]): T[] {
  if (prev.length === 0) return next;
  const key = (e: T) => JSON.stringify(e);
  const tail = prev.slice(-3).map(key);
  for (let i = next.length - 1; i >= tail.length - 1; i--) {
    if (tail.every((k, j) => key(next[i - (tail.length - 1) + j]) === k)) return next.slice(i + 1);
  }
  // Nothing in common: a new game has started.
  return next;
}
