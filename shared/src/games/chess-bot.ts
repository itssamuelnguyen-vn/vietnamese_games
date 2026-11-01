import { Chess } from 'chess.js';
import { MATE, searchBestMove, type SearchAdapter } from './search';

// The chess bot: the shared alpha-beta search over chess.js, scoring positions by material and
// where each piece stands (piece-square tables in the spirit of the well-known "simplified
// evaluation function").

type Color = 'w' | 'b';
type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface ChessBotMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

const VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// From white's side, a8 first (row 0 is rank 8).
// prettier-ignore
const PST: Record<PieceType | 'kEnd', number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  // The king hides behind its pawns in the middlegame, and walks to the centre in the endgame.
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

// Score of a position from white's side: material plus placement.
function evaluateBoard(pieces: { type: PieceType; color: Color; row: number; col: number }[]): number {
  // Endgame once the queens are gone, or nothing but a queen and a minor piece remain per side.
  const heavy = pieces.filter((p) => p.type !== 'p' && p.type !== 'k').reduce((sum, p) => sum + VALUE[p.type], 0);
  const endgame = heavy <= 2 * (VALUE.q + VALUE.n);
  let score = 0;
  for (const p of pieces) {
    const index = p.color === 'w' ? p.row * 8 + p.col : (7 - p.row) * 8 + p.col;
    const table = p.type === 'k' && endgame ? PST.kEnd : PST[p.type];
    const value = VALUE[p.type] + table[index];
    score += p.color === 'w' ? value : -value;
  }
  return score;
}

// chess.js's internal move generator is far faster than its public one (no SAN for every move).
// It isn't public API, so it's used only when it's there; otherwise the bot uses the slow path.
interface InternalMove {
  color: Color;
  from: number;
  to: number;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
}
interface ChessInternals {
  _moves(options: { legal: boolean }): InternalMove[];
  _makeMove(move: InternalMove): void;
  _undoMove(): unknown;
  _board: ({ type: PieceType; color: Color } | undefined)[];
  _turn: Color;
  _isKingAttacked(color: Color): boolean;
}

export function hasFastPath(chess: Chess): boolean {
  const c = chess as unknown as Partial<ChessInternals>;
  return typeof c._moves === 'function' && typeof c._makeMove === 'function' && typeof c._undoMove === 'function' && Array.isArray(c._board);
}

// 0x88 board index to algebraic square name.
const squareOf = (i: number) => 'abcdefgh'[i & 15] + (8 - (i >> 4));

function fastAdapter(chess: Chess): SearchAdapter<InternalMove> {
  const c = chess as unknown as ChessInternals;
  return {
    moves: () => c._moves({ legal: true }),
    play: (m) => c._makeMove(m),
    undo: () => c._undoMove(),
    evaluate: () => {
      const pieces: { type: PieceType; color: Color; row: number; col: number }[] = [];
      for (let i = 0; i < 128; i++) {
        if (i & 0x88) {
          i += 7;
          continue;
        }
        const p = c._board[i];
        if (p) pieces.push({ type: p.type, color: p.color, row: i >> 4, col: i & 15 });
      }
      const score = evaluateBoard(pieces);
      return c._turn === 'w' ? score : -score;
    },
    noMoves: () => (c._isKingAttacked(c._turn) ? -MATE : 0),
    captured: (m) => (m.captured ? VALUE[m.captured] || 1 : 0) + (m.promotion ? VALUE[m.promotion] : 0),
    mover: (m) => VALUE[m.piece] || 1000,
  };
}

interface PublicMove {
  from: string;
  to: string;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
}

function publicAdapter(chess: Chess): SearchAdapter<PublicMove> {
  return {
    moves: () => chess.moves({ verbose: true }) as PublicMove[],
    play: (m) => {
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    },
    undo: () => chess.undo(),
    evaluate: () => {
      const pieces = chess.board().flatMap((row, r) => row.flatMap((p, col) => (p ? [{ type: p.type as PieceType, color: p.color as Color, row: r, col }] : [])));
      const score = evaluateBoard(pieces);
      return chess.turn() === 'w' ? score : -score;
    },
    noMoves: () => (chess.inCheck() ? -MATE : 0),
    captured: (m) => (m.captured ? VALUE[m.captured] || 1 : 0) + (m.promotion ? VALUE[m.promotion] : 0),
    mover: (m) => VALUE[m.piece] || 1000,
  };
}

export interface BotOptions {
  timeMs: number;
  maxDepth?: number;
  random?: () => number;
  now?: () => number;
}

// The bot's move in this position, or null if there is none.
export function chessBotMove(fen: string, opts: BotOptions): ChessBotMove | null {
  const chess = new Chess(fen);
  // About 1.5 s of searching at the fast path's speed, should the clock stand still.
  const search = { maxDepth: opts.maxDepth ?? 6, timeMs: opts.timeMs, margin: 15, random: opts.random, now: opts.now, maxNodes: 50_000 };
  if (hasFastPath(chess)) {
    const { move } = searchBestMove(fastAdapter(chess), search);
    return move && { from: squareOf(move.from), to: squareOf(move.to), ...(move.promotion ? { promotion: move.promotion as ChessBotMove['promotion'] } : {}) };
  }
  const { move } = searchBestMove(publicAdapter(chess), search);
  return move && { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion as ChessBotMove['promotion'] } : {}) };
}

// How the position looks to the side to move, for deciding on draw offers.
export function chessScore(fen: string): number {
  const chess = new Chess(fen);
  const pieces = chess.board().flatMap((row, r) => row.flatMap((p, col) => (p ? [{ type: p.type as PieceType, color: p.color as Color, row: r, col }] : [])));
  const score = evaluateBoard(pieces);
  return chess.turn() === 'w' ? score : -score;
}
