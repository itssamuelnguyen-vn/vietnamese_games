import { useEffect, useRef, useState } from 'react';

// The game view as the screen has finished showing it. The server's view arrives with outcomes
// already decided (dice rolled, cards dealt, money moved) while the screen is still playing them
// out: a bowl shaking, a die tumbling, a token walking. Parts of the screen without an animation of
// their own (the game log, chip counts, history) read this view instead, so they never give the
// outcome away early.
//
// `holdMs(previous, next)` says how long the screen needs to show a change; 0 for none. While a
// hold is running, later views wait behind it.
export function useSettledView<V>(view: V, holdMs: (previous: V, next: V) => number): V {
  const [settled, setSettled] = useState(view);
  const previous = useRef(view);
  const latest = useRef(view);
  latest.current = view;
  const releaseAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  useEffect(() => {
    const ms = holdMs(previous.current, view);
    previous.current = view;
    const now = performance.now();
    if (ms <= 0 && now >= releaseAt.current) {
      setSettled(view);
      return;
    }
    releaseAt.current = Math.max(releaseAt.current, now + ms);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setSettled(latest.current);
    }, releaseAt.current - now);
    // Only a new view needs deciding about; holdMs is read as of that view.
  }, [view]);

  return settled;
}
