import { useEffect, useState, type CSSProperties } from 'react';

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

interface DieProps {
  value: number | null;
  // While true the die tumbles, its faces flicking by quickly at first and slowing down as it comes
  // to rest over `durationMs`; then it shows `value`.
  rolling: boolean;
  durationMs: number;
  // Ring colour, e.g. the colour of whoever rolled.
  color?: string;
  // Makes the die a button that rolls.
  onRoll?: () => void;
  label?: string;
  className?: string;
}

export function Die({ value, rolling, durationMs, color, onRoll, label, className = '' }: DieProps) {
  const [face, setFace] = useState(value);
  useEffect(() => {
    if (!rolling) return;
    const start = performance.now();
    let id: ReturnType<typeof setTimeout>;
    const flick = () => {
      // Always a different face from the last one.
      setFace((f) => 1 + (((f ?? 0) + Math.floor(Math.random() * 5)) % 6));
      const elapsed = (performance.now() - start) / durationMs;
      id = setTimeout(flick, 60 + 260 * elapsed * elapsed);
    };
    flick();
    return () => clearTimeout(id);
  }, [rolling, durationMs]);
  const shown = rolling ? face : value;
  const pips = Array.from({ length: 9 }, (_, i) => <span key={i} className={shown && PIPS[shown].includes(i) ? 'pip' : ''} />);
  const style = { '--die-c': color, '--roll-ms': `${durationMs}ms` } as CSSProperties;
  const classes = `die ${rolling ? 'rolling' : ''} ${className}`;
  return onRoll ? (
    <button type="button" className={`${classes} can-roll`} style={style} onClick={onRoll} aria-label={label} title={label}>
      {pips}
    </button>
  ) : (
    <span className={classes} style={style} aria-label={value ? String(value) : ''}>
      {pips}
    </span>
  );
}
