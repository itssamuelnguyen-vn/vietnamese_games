import type { BotLevel } from '../types';
import { MATE, searchBestMove, type SearchOptions, type SearchResult } from './search';
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
  level?: BotLevel;
}

// How each level searches; see CHESS_LEVELS. maxNodes caps the search at a few seconds, should the
// clock stand still.
export const XIANGQI_LEVELS: Record<BotLevel, Omit<SearchOptions, 'timeMs'>> = {
  easy: { maxDepth: 2, captureDepth: 2, margin: 20, maxNodes: 6_000, slips: [{ chance: 0.1, margin: 250 }, { chance: 0.3, margin: 60 }] },
  medium: { maxDepth: 6, margin: 10, maxNodes: 25_000 },
  hard: { maxDepth: 30, margin: 4, maxNodes: 300_000, enhanced: true },
};

// Zobrist keys for the hard bot's transposition table, from a fixed-seed generator: two halves of
// 21 and 32 bits per piece and square, so a key fits a double exactly.
const PIECES: XPieceType[] = ['k', 'a', 'b', 'n', 'r', 'c', 'p'];
const ZOBRIST = (() => {
  let seed = 0x9e3779b9;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  // Index: (side * 7 + piece) * 90 + square; the last pair is for the side to move.
  const hi = new Uint32Array(2 * 7 * 90 + 1);
  const lo = new Uint32Array(2 * 7 * 90 + 1);
  for (let i = 0; i < hi.length; i++) [hi[i], lo[i]] = [next() & 0x1fffff, next()];
  return { hi, lo };
})();
const SIDE_KEY = 2 * 7 * 90;
const squareIndex = (square: string) => (square.charCodeAt(0) - 97) * 10 + (square.charCodeAt(1) - 48);
const pieceKey = (side: XSide, type: XPieceType, square: number) => ((side === 'r' ? 0 : 7) + PIECES.indexOf(type)) * 90 + square;

// The bot's move for the side to move in `game`, or null if there is none. Moves that bring back a
// position already seen twice are avoided when possible: perpetual checks and chases lose in xiangqi,
// and any other third repetition is only a draw.
export function xiangqiBotMove(game: Xiangqi, seen: Map<string, number>, opts: XiangqiBotOptions): { from: string; to: string } | null {
  const { move } = xiangqiBotSearch(game, seen, opts);
  return move && { from: move.from, to: move.to };
}

// The same, with how deep the search got and how many positions it looked at.
export function xiangqiBotSearch(game: Xiangqi, seen: Map<string, number>, opts: XiangqiBotOptions): SearchResult<XMove> {
  const level = XIANGQI_LEVELS[opts.level ?? 'medium'];
  const repeats = (m: XMove) => {
    game.playTrusted(m);
    const twice = (seen.get(game.positionKey()) ?? 0) >= 2;
    game.undo();
    return twice;
  };
  // The position's key, kept up to date move by move.
  let hi = 0;
  let lo = 0;
  game.forEachPiece((p, f, r) => {
    const k = pieceKey(p.side, p.type, f * 10 + r);
    hi ^= ZOBRIST.hi[k];
    lo ^= ZOBRIST.lo[k];
  });
  if (game.turn() === 'b') [hi, lo] = [hi ^ ZOBRIST.hi[SIDE_KEY], lo ^ ZOBRIST.lo[SIDE_KEY]];
  const toggle = (m: XMove) => {
    const from = squareIndex(m.from);
    const to = squareIndex(m.to);
    const a = pieceKey(m.side, m.piece, from);
    const b = pieceKey(m.side, m.piece, to);
    hi ^= ZOBRIST.hi[a] ^ ZOBRIST.hi[b] ^ ZOBRIST.hi[SIDE_KEY];
    lo ^= ZOBRIST.lo[a] ^ ZOBRIST.lo[b] ^ ZOBRIST.lo[SIDE_KEY];
    if (m.captured) {
      const c = pieceKey(m.side === 'r' ? 'b' : 'r', m.captured, to);
      hi ^= ZOBRIST.hi[c];
      lo ^= ZOBRIST.lo[c];
    }
  };
  const played: XMove[] = [];
  return searchBestMove<XMove>(
    {
      moves: () => game.movesFast(),
      captures: () => game.capturesFast(),
      play: (m) => {
        game.playTrusted(m);
        toggle(m);
        played.push(m);
      },
      undo: () => {
        game.undo();
        toggle(played.pop()!);
      },
      evaluate: () => evaluate(game),
      // No legal move loses in xiangqi, check or not.
      noMoves: () => -MATE,
      captured: (m) => (m.captured ? VALUE[m.captured] || 1000 : 0),
      mover: (m) => VALUE[m.piece] || 1000,
      key: () => hi * 4294967296 + (lo >>> 0),
      moveId: (m) => squareIndex(m.from) * 90 + squareIndex(m.to),
      inCheck: () => game.inCheck(),
    },
    { ...level, maxDepth: opts.maxDepth ?? level.maxDepth, timeMs: opts.timeMs, random: opts.random, now: opts.now, avoid: repeats },
  );
}

// How the position looks to `side`, for deciding on draw offers.
export function xiangqiScore(game: Xiangqi, side: XSide): number {
  const score = evaluate(game);
  return game.turn() === side ? score : -score;
}
