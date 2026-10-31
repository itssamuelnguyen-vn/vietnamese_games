import { Chess } from 'chess.js';
import type { GameDefinition } from '../types';

export type ChessColor = 'w' | 'b';

export type ChessEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'insufficient'
  | 'fifty-moves'
  | 'resign'
  | 'agreement';

export interface ChessResult {
  winner: string | null; // null = draw
  reason: ChessEndReason;
}

export interface ChessState {
  white: string;
  black: string;
  pgn: string;
  result: ChessResult | null;
  // Player whose draw offer is waiting for an answer.
  drawOffer: string | null;
  // Ply at which each player last offered a draw, to stop offer spam.
  drawOfferedAt: Record<string, number>;
}

export type ChessMove =
  | { type: 'move'; from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'accept-draw' }
  | { type: 'decline-draw' };

export interface ChessView {
  white: string;
  black: string;
  fen: string;
  turn: ChessColor;
  history: string[];
  lastMove: { from: string; to: string } | null;
  inCheck: boolean;
  result: ChessResult | null;
  drawOffer: string | null;
  canOfferDraw: boolean;
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

function opponentOf(state: ChessState, color: ChessColor): string {
  return color === 'w' ? state.black : state.white;
}

function plyCount(state: ChessState): number {
  return load(state).history().length;
}

// One offer per player per ply, and never while an offer is already pending.
function canOfferDraw(state: ChessState, playerId: string, ply: number): boolean {
  return !state.result && colorOf(state, playerId) !== null && state.drawOffer === null && state.drawOfferedAt[playerId] !== ply;
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
    return { white, black, pgn: '', result: null, drawOffer: null, drawOfferedAt: {} };
  },

  applyMove(state, playerId, move) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    const color = colorOf(state, playerId);
    if (!color) return { ok: false, error: 'NOT_A_PLAYER' };
    const opponent = opponentOf(state, color);

    switch (move.type) {
      case 'resign':
        return { ok: true, state: { ...state, drawOffer: null, result: { winner: opponent, reason: 'resign' } } };

      case 'offer-draw': {
        // Offering back while the opponent's offer is pending is simply accepting it.
        if (state.drawOffer === opponent) {
          return { ok: true, state: { ...state, drawOffer: null, result: { winner: null, reason: 'agreement' } } };
        }
        const ply = plyCount(state);
        if (!canOfferDraw(state, playerId, ply)) return { ok: false, error: 'INVALID_MOVE' };
        return {
          ok: true,
          state: { ...state, drawOffer: playerId, drawOfferedAt: { ...state.drawOfferedAt, [playerId]: ply } },
        };
      }

      case 'accept-draw':
        if (state.drawOffer !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, drawOffer: null, result: { winner: null, reason: 'agreement' } } };

      case 'decline-draw':
        if (state.drawOffer !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, drawOffer: null } };

      case 'move': {
        const chess = load(state);
        if (chess.turn() !== color) return { ok: false, error: 'NOT_YOUR_TURN' };
        try {
          chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
        } catch {
          return { ok: false, error: 'INVALID_MOVE' };
        }
        // Moving on is an implicit answer to any pending offer.
        const next = { ...state, pgn: chess.pgn(), drawOffer: null };
        return { ok: true, state: { ...next, result: detectResult(chess, next) } };
      }

      default:
        return { ok: false, error: 'INVALID_MOVE' };
    }
  },

  forfeit(state, playerId) {
    if (state.result) return state;
    const color = colorOf(state, playerId);
    if (!color) return state;
    return { ...state, drawOffer: null, result: { winner: opponentOf(state, color), reason: 'resign' } };
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId) {
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
      drawOffer: state.drawOffer,
      canOfferDraw: canOfferDraw(state, playerId, verbose.length),
    };
  },
};
