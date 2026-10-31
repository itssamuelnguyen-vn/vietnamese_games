import { Chess } from 'chess.js';
import type { GameDefinition } from '../types';

export type ChessColor = 'w' | 'b';

export type ChessEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'insufficient'
  | 'fifty-moves'
  | 'resign';

export interface ChessResult {
  winner: string | null; // null = draw
  reason: ChessEndReason;
}

export interface ChessState {
  white: string;
  black: string;
  pgn: string;
  result: ChessResult | null;
}

export type ChessMove =
  | { type: 'move'; from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }
  | { type: 'resign' };

export interface ChessView {
  white: string;
  black: string;
  fen: string;
  turn: ChessColor;
  history: string[];
  lastMove: { from: string; to: string } | null;
  inCheck: boolean;
  result: ChessResult | null;
}

function load(state: ChessState): Chess {
  const chess = new Chess();
  if (state.pgn) chess.loadPgn(state.pgn);
  return chess;
}

function colorOf(state: ChessState, playerId: string): ChessColor | null {
  if (playerId === state.white) return 'w';
  if (playerId === state.black) return 'b';
  return null;
}

function detectResult(chess: Chess, state: ChessState): ChessResult | null {
  if (chess.isCheckmate()) {
    // The side that just moved wins; chess.turn() is now the mated side.
    return { winner: chess.turn() === 'w' ? state.black : state.white, reason: 'checkmate' };
  }
  if (chess.isStalemate()) return { winner: null, reason: 'stalemate' };
  if (chess.isThreefoldRepetition()) return { winner: null, reason: 'threefold' };
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' };
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty-moves' };
  return null;
}

export const chessGame: GameDefinition<ChessState, ChessMove, ChessView> = {
  type: 'chess',

  setup([a, b]) {
    const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
    return { white, black, pgn: '', result: null };
  },

  applyMove(state, playerId, move) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    const color = colorOf(state, playerId);
    if (!color) return { ok: false, error: 'NOT_A_PLAYER' };

    if (move.type === 'resign') {
      const winner = color === 'w' ? state.black : state.white;
      return { ok: true, state: { ...state, result: { winner, reason: 'resign' } } };
    }

    const chess = load(state);
    if (chess.turn() !== color) return { ok: false, error: 'NOT_YOUR_TURN' };
    try {
      chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
    } catch {
      return { ok: false, error: 'INVALID_MOVE' };
    }
    const next = { ...state, pgn: chess.pgn() };
    return { ok: true, state: { ...next, result: detectResult(chess, next) } };
  },

  forfeit(state, playerId) {
    if (state.result) return state;
    const color = colorOf(state, playerId);
    if (!color) return state;
    const winner = color === 'w' ? state.black : state.white;
    return { ...state, result: { winner, reason: 'resign' } };
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state) {
    const chess = load(state);
    const verbose = chess.history({ verbose: true });
    const last = verbose.at(-1);
    return {
      white: state.white,
      black: state.black,
      fen: chess.fen(),
      turn: chess.turn(),
      history: verbose.map((m) => m.san),
      lastMove: last ? { from: last.from, to: last.to } : null,
      inCheck: chess.inCheck(),
      result: state.result,
    };
  },
};
