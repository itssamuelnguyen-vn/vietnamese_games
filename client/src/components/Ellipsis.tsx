// Text ending in "…" gets its dots drawn one after another (".", "..", "..."), the usual
// "still working" cue. Other text renders unchanged.
export function Ellipsis({ text }: { text: string }) {
  const match = /(…|\.\.\.)$/.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.index)}
      <span className="dots" aria-hidden="true">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </>
  );
}
