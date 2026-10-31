import { Xiangqi, parseSquare, type XMove, type XPieceType, type XSide } from '@vg/shared';

// Move notation in the traditional "piece, file, direction, number" form.
// Files are numbered 1–9 from each player's own right; for straight-moving pieces the number
// is the distance, for diagonal movers (horse, elephant, advisor) it's the destination file.

export interface NotationStyle {
  pieces: Record<XPieceType, string>;
  advance: string;
  retreat: string;
  traverse: string;
  // Marks for two identical pieces on the same file.
  front: string;
  rear: string;
  // Whether the front/rear mark goes before the piece letter (WXF) or after it (Vietnamese).
  markFirst: boolean;
}

const fileNumber = (side: XSide, file: number) => (side === 'r' ? 9 - file : file + 1);
const DIAGONAL: XPieceType[] = ['n', 'b', 'a'];

// `before` must be the position the move was played from.
export function notate(before: Xiangqi, move: XMove, style: NotationStyle): string {
  const [ff, fr] = parseSquare(move.from)!;
  const [tf, tr] = parseSquare(move.to)!;
  const ahead = move.side === 'r' ? tr - fr : fr - tr;

  // Another identical piece on the same file needs a front/rear mark instead of the file number.
  const twins: number[] = [];
  const board = before.board();
  board.forEach((row, i) => {
    const p = row[ff];
    if (p && p.side === move.side && p.type === move.piece) twins.push(9 - i);
  });
  let label = `${style.pieces[move.piece]}${fileNumber(move.side, ff)}`;
  if (twins.length === 2) {
    const frontRank = move.side === 'r' ? Math.max(...twins) : Math.min(...twins);
    const mark = fr === frontRank ? style.front : style.rear;
    label = style.markFirst ? `${mark}${style.pieces[move.piece]}` : `${style.pieces[move.piece]}${mark}`;
  }

  if (ahead === 0) return `${label}${style.traverse}${fileNumber(move.side, tf)}`;
  const op = ahead > 0 ? style.advance : style.retreat;
  const amount = DIAGONAL.includes(move.piece) ? fileNumber(move.side, tf) : Math.abs(ahead);
  return `${label}${op}${amount}`;
}

// Replays a game, returning the notation of each move and every position along the way.
export function replayXiangqi(moves: string[], style: NotationStyle, startFen?: string) {
  const game = new Xiangqi(startFen);
  const fens = [game.fen()];
  const labels: string[] = [];
  const details: XMove[] = [];
  for (const m of moves) {
    const before = new Xiangqi(game.fen());
    const move = game.move(m);
    labels.push(notate(before, move, style));
    details.push(move);
    fens.push(game.fen());
  }
  return { fens, labels, moves: details };
}
