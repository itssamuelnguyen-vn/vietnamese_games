import { Chess } from 'chess.js';
import type { BotLevel } from '../types';
import { MATE, searchBestMove, type SearchAdapter, type SearchOptions, type SearchResult } from './search';

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
  flags?: number;
  captured?: PieceType;
  promotion?: PieceType;
}
interface ChessInternals {
  _moves(options: { legal: boolean }): InternalMove[];
  _makeMove(move: InternalMove): void;
  _undoMove(): unknown;
  _board: ({ type: PieceType; color: Color } | undefined)[];
  _turn: Color;
  _hash: bigint;
  _isKingAttacked(color: Color): boolean;
  _computeHash(): bigint;
}

// chess.js's flag for a null move (a pass).
const NULL_MOVE = 128;

export function hasFastPath(chess: Chess): boolean {
  const c = chess as unknown as Partial<ChessInternals>;
  return (
    typeof c._moves === 'function' &&
    typeof c._makeMove === 'function' &&
    typeof c._undoMove === 'function' &&
    typeof c._computeHash === 'function' &&
    typeof c._hash === 'bigint' &&
    Array.isArray(c._board)
  );
}

// 0x88 board index to algebraic square name.
const squareOf = (i: number) => 'abcdefgh'[i & 15] + (8 - (i >> 4));

// evaluateBoard straight off chess.js's 0x88 board, without building a piece list.
function evaluateInternal(board: ChessInternals['_board']): number {
  let heavy = 0;
  for (let i = 0; i < 128; i++) {
    if (i & 0x88) {
      i += 7;
      continue;
    }
    const p = board[i];
    if (p && p.type !== 'p' && p.type !== 'k') heavy += VALUE[p.type];
  }
  const endgame = heavy <= 2 * (VALUE.q + VALUE.n);
  let score = 0;
  for (let i = 0; i < 128; i++) {
    if (i & 0x88) {
      i += 7;
      continue;
    }
    const p = board[i];
    if (!p) continue;
    const row = i >> 4;
    const col = i & 15;
    const table = p.type === 'k' && endgame ? PST.kEnd : PST[p.type];
    if (p.color === 'w') score += VALUE[p.type] + table[row * 8 + col];
    else score -= VALUE[p.type] + table[(7 - row) * 8 + col];
  }
  return score;
}

function fastAdapter(chess: Chess): SearchAdapter<InternalMove> {
  const c = chess as unknown as ChessInternals;
  const hashes: bigint[] = [];
  return {
    moves: () => c._moves({ legal: true }),
    // Pseudo-legal moves are much cheaper; only the captures among them are checked for legality.
    captures: () => {
      const us = c._turn;
      return c._moves({ legal: false }).filter((m) => {
        if (!m.captured && !m.promotion) return false;
        c._makeMove(m);
        const legal = !c._isKingAttacked(us);
        c._undoMove();
        return legal;
      });
    },
    play: (m) => c._makeMove(m),
    undo: () => c._undoMove(),
    evaluate: () => {
      const score = evaluateInternal(c._board);
      return c._turn === 'w' ? score : -score;
    },
    noMoves: () => (c._isKingAttacked(c._turn) ? -MATE : 0),
    captured: (m) => (m.captured ? VALUE[m.captured] || 1 : 0) + (m.promotion ? VALUE[m.promotion] : 0),
    mover: (m) => VALUE[m.piece] || 1000,
    key: () => c._hash,
    // 0x88 squares are below 128.
    moveId: (m) => m.from * 128 + m.to,
    inCheck: () => c._isKingAttacked(c._turn),
    // chess.js plays null moves but doesn't update its hash for them, so the hash is recomputed
    // after the pass and put back after the undo.
    pass: () => {
      hashes.push(c._hash);
      c._makeMove({ color: c._turn, from: 0, to: 0, piece: 'k', flags: NULL_MOVE } as InternalMove);
      c._hash = c._computeHash();
    },
    unpass: () => {
      c._undoMove();
      c._hash = hashes.pop()!;
    },
    // Only with a piece besides pawns: king and pawn endings are full of zugzwang.
    canPass: () => {
      for (let i = 0; i < 128; i++) {
        if (i & 0x88) {
          i += 7;
          continue;
        }
        const p = c._board[i];
        if (p && p.color === c._turn && p.type !== 'p' && p.type !== 'k') return true;
      }
      return false;
    },
  };
}

const squareIndex = (square: string) => (square.charCodeAt(0) - 97) * 8 + (square.charCodeAt(1) - 49);

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
    key: () => chess.hash(),
    moveId: (m) => squareIndex(m.from) * 64 + squareIndex(m.to),
    inCheck: () => chess.inCheck(),
  };
}

export interface BotOptions {
  timeMs: number;
  maxDepth?: number;
  random?: () => number;
  now?: () => number;
  level?: BotLevel;
  // How often each position of the game so far came up, by chess.js hash, so the bot can tell which
  // moves would make a threefold repetition.
  seen?: Map<string, number>;
}

// How each level searches. Easy looks two plies ahead, counts exchanges only a little way, and now and
// then settles for a worse move, as a casual player would; it still sees a mate in one, its own or
// the opponent's. Medium is the original bot. Hard searches with the full set of engine tricks.
// maxNodes caps the search at a few seconds of the fast path, should the clock stand still.
export const CHESS_LEVELS: Record<BotLevel, Omit<SearchOptions, 'timeMs'>> = {
  easy: { maxDepth: 2, captureDepth: 2, margin: 25, maxNodes: 10_000, slips: [{ chance: 0.1, margin: 350 }, { chance: 0.3, margin: 120 }] },
  medium: { maxDepth: 6, margin: 15, maxNodes: 50_000 },
  hard: { maxDepth: 30, margin: 5, maxNodes: 300_000, enhanced: true },
};

// Positions a game has been through, counted by chess.js hash, starting position included.
export function seenPositions(chess: Chess): Map<string, number> {
  const replay = new Chess();
  const seen = new Map([[replay.hash(), 1]]);
  for (const san of chess.history()) {
    replay.move(san);
    seen.set(replay.hash(), (seen.get(replay.hash()) ?? 0) + 1);
  }
  return seen;
}

// The bot's move in this position, or null if there is none. With `seen`, a move that repeats a
// position for the third time counts as a draw: taken only when everything else is clearly worse.
export function chessBotMove(fen: string, opts: BotOptions): ChessBotMove | null {
  return chessBotSearch(fen, opts).move;
}

// The same, with how deep the search got and how many positions it looked at.
export function chessBotSearch(fen: string, opts: BotOptions): SearchResult<ChessBotMove> {
  const chess = new Chess(fen);
  const level = CHESS_LEVELS[opts.level ?? 'medium'];
  const seen = opts.seen;
  const search = { ...level, maxDepth: opts.maxDepth ?? level.maxDepth, timeMs: opts.timeMs, random: opts.random, now: opts.now };
  // Root moves that would bring a position back for the third time.
  const drawsIn = <M>(a: SearchAdapter<M>) =>
    seen &&
    ((m: M) => {
      a.play(m);
      const count = seen.get(chess.hash()) ?? 0;
      a.undo();
      return count >= 2;
    });
  if (hasFastPath(chess)) {
    const adapter = fastAdapter(chess);
    const { move, ...rest } = searchBestMove(adapter, { ...search, draws: drawsIn(adapter) });
    return { ...rest, move: move && { from: squareOf(move.from), to: squareOf(move.to), ...(move.promotion ? { promotion: move.promotion as ChessBotMove['promotion'] } : {}) } };
  }
  const adapter = publicAdapter(chess);
  const { move, ...rest } = searchBestMove(adapter, { ...search, draws: drawsIn(adapter) });
  return { ...rest, move: move && { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion as ChessBotMove['promotion'] } : {}) } };
}

// How the position looks to the side to move, for deciding on draw offers.
export function chessScore(fen: string): number {
  const chess = new Chess(fen);
  const pieces = chess.board().flatMap((row, r) => row.flatMap((p, col) => (p ? [{ type: p.type as PieceType, color: p.color as Color, row: r, col }] : [])));
  const score = evaluateBoard(pieces);
  return chess.turn() === 'w' ? score : -score;
}
