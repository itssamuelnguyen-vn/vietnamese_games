// Common xiangqi openings as ICCS move prefixes (red's right-hand version; the mirrored
// left-hand version is matched automatically). Display names live in the locale files.
export const XQ_OPENINGS = {
  'central-cannon': 'h2e2',
  'same-direction-cannons': 'h2e2 h7e7',
  'opposite-direction-cannons': 'h2e2 b7e7',
  'screen-horses': 'h2e2 h9g7 h0g2 b9c7',
  'palcorner-cannon': 'h2d2',
  'advisor-cannon': 'h2f2',
  'pawn-opening': 'g3g4',
  'pawn-vs-pawn': 'g3g4 g6g5',
  'elephant-opening': 'c0e2',
  'horse-opening': 'b0c2',
} as const;

export type XqOpeningId = keyof typeof XQ_OPENINGS;

const FILES = 'abcdefghi';
// Reflect a move across the central file (a <-> i, b <-> h, ...).
const mirror = (move: string) => move.replace(/[a-i]/g, (f) => FILES[8 - FILES.indexOf(f)]);

const LINES = (Object.entries(XQ_OPENINGS) as [XqOpeningId, string][])
  .flatMap(([id, line]) => {
    const moves = line.split(' ');
    return [
      { id, moves },
      { id, moves: moves.map(mirror) },
    ];
  })
  .sort((a, b) => b.moves.length - a.moves.length);

export function findXiangqiOpening(history: string[]): XqOpeningId | null {
  const match = LINES.find(({ moves }) => moves.length <= history.length && moves.every((m, i) => history[i] === m));
  return match?.id ?? null;
}
