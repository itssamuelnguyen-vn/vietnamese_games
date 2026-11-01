import { MATE, searchBestMove } from './search';
import { Xiangqi, type XMove, type XPiece, type XPieceType, type XSide } from './xiangqi-engine';

// The xiangqi bot: the shared alpha-beta search over the xiangqi engine's fast move generator,
// scoring positions by material and a few placement rules of thumb.

const VALUE: Record<XPieceType, number> = { k: 0, r: 600, n: 270, c: 285, a: 120, b: 120, p: 30 };

// Placement bonus for a piece, counting ranks from its own side (0 = its back rank).
function placement(piece: XPiece, file: number, ownRank: number): number {
  const central = 4 - Math.abs(file - 4);
  switch (piece.type) {
    case 'p':
      // A soldier across the river is worth far more, more so near the palace, less on the last rank.
      if (ownRank < 5) return 0;
      return ownRank === 9 ? 40 : 50 + (ownRank - 5) * 10 + (file >= 3 && file <= 5 ? 20 : 0);
    case 'n':
      // Horses want to get off the back rank, into the middle and the enemy half; on the edge
      // they're hemmed in.
      return central * 6 + (ownRank > 0 ? 15 : 0) + (ownRank >= 5 ? 20 : 0) - (file === 0 || file === 8 ? 20 : 0);
    case 'c':
      // The central cannon is the classic opening.
      return file === 4 ? 25 : central * 2;
    case 'r':
      // Chariots want open files: out of the corner, and into the enemy half.
      return central * 3 + (ownRank > 0 || (file !== 0 && file !== 8) ? 10 : 0) + (ownRank >= 5 ? 15 : 0);
    default:
      return 0;
  }
}

function evaluate(game: Xiangqi): number {
  let score = 0;
  game.forEachPiece((p, f, r) => {
    const value = VALUE[p.type] + placement(p, f, p.side === 'r' ? r : 9 - r);
    score += p.side === 'r' ? value : -value;
  });
  return game.turn() === 'r' ? score : -score;
}

export interface XiangqiBotOptions {
  timeMs: number;
  maxDepth?: number;
  random?: () => number;
  now?: () => number;
}

// The bot's move for the side to move in `game`, or null if there is none. Moves that bring back a
// position already seen twice are avoided when possible: perpetual checks and chases lose in xiangqi,
// and any other third repetition is only a draw.
export function xiangqiBotMove(game: Xiangqi, seen: Map<string, number>, opts: XiangqiBotOptions): { from: string; to: string } | null {
  const repeats = (m: XMove) => {
    game.playTrusted(m);
    const twice = (seen.get(game.positionKey()) ?? 0) >= 2;
    game.undo();
    return twice;
  };
  const { move } = searchBestMove<XMove>(
    {
      moves: () => game.movesFast(),
      captures: () => game.capturesFast(),
      play: (m) => game.playTrusted(m),
      undo: () => game.undo(),
      evaluate: () => evaluate(game),
      // No legal move loses in xiangqi, check or not.
      noMoves: () => -MATE,
      captured: (m) => (m.captured ? VALUE[m.captured] || 1000 : 0),
      mover: (m) => VALUE[m.piece] || 1000,
    },
    // maxNodes: about 1.5 s of searching, should the clock stand still.
    { maxDepth: opts.maxDepth ?? 6, timeMs: opts.timeMs, margin: 10, random: opts.random, now: opts.now, avoid: repeats, maxNodes: 25_000 },
  );
  return move && { from: move.from, to: move.to };
}

// How the position looks to `side`, for deciding on draw offers.
export function xiangqiScore(game: Xiangqi, side: XSide): number {
  const score = evaluate(game);
  return game.turn() === side ? score : -score;
}
