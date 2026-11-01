// A bet chip's label: 25000 shows as 25k so it fits on the chip.
export function shortAmount(v: number): string {
  return v >= 1000 && v % 1000 === 0 ? `${v / 1000}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}
