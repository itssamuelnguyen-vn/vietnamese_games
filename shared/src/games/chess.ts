import { Chess } from 'chess.js';
import { TIME_CONTROLS, type GameDefinition } from '../types';

export type ChessColor = 'w' | 'b';

export type ChessEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'insufficient'
  | 'fifty-moves'
  | 'resign'
  | 'agreement'
  | 'timeout';

export interface ChessResult {
  winner: string | null; // null = draw
  reason: ChessEndReason;
}

export interface ChessClock {
  incrementMs: number;
  remaining: Record<ChessColor, number>;
  // When the side to move started thinking; null while the clock is stopped.
  turnStartedAt: number | null;
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
  clock: ChessClock | null;
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
  // Remaining times as of when the view was built; `running` is the side whose clock is ticking.
  clock: { remaining: Record<ChessColor, number>; running: ChessColor | null; incrementMs: number } | null;
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

// Clocks only start once both sides have made their first move.
const CLOCK_START_PLY = 2;

// Time left for each side at `now`, charging the side to move for its current think.
function remainingAt(clock: ChessClock, turn: ChessColor, now: number): Record<ChessColor, number> {
  if (clock.turnStartedAt === null) return clock.remaining;
  const left = Math.max(0, clock.remaining[turn] - (now - clock.turnStartedAt));
  return { ...clock.remaining, [turn]: left };
}

function stopClock(state: ChessState, now: number): ChessClock | null {
  if (!state.clock) return null;
  return { ...state.clock, remaining: remainingAt(state.clock, load(state).turn(), now), turnStartedAt: null };
}

// A player who runs out of time only loses if the opponent could still deliver mate.
function canMate(chess: Chess, color: ChessColor): boolean {
  let minors = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== color || sq.type === 'k') continue;
      if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true;
      minors++;
    }
  }
  return minors >= 2;
}

function flag(state: ChessState): ChessState {
  const chess = load(state);
  const loser = chess.turn();
  const winnerColor: ChessColor = loser === 'w' ? 'b' : 'w';
  const clock = state.clock && { ...state.clock, remaining: { ...state.clock.remaining, [loser]: 0 }, turnStartedAt: null };
  const winner = canMate(chess, winnerColor) ? opponentOf(state, loser) : null;
  return { ...state, clock, drawOffer: null, result: { winner, reason: 'timeout' } };
}

// Ends the game with `result`, freezing the clock at the current moment.
function finish(state: ChessState, result: ChessResult, now: number): ChessState {
  return { ...state, clock: stopClock(state, now), drawOffer: null, result };
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

  setup([a, b], options) {
    const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
    const tc = TIME_CONTROLS[options.timeControl];
    const clock = tc && { incrementMs: tc.incrementMs, remaining: { w: tc.initialMs, b: tc.initialMs }, turnStartedAt: null };
    return { white, black, pgn: '', result: null, drawOffer: null, drawOfferedAt: {}, clock };
  },

  applyMove(state, playerId, move, { now }) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    const color = colorOf(state, playerId);
    if (!color) return { ok: false, error: 'NOT_A_PLAYER' };
    const opponent = opponentOf(state, color);

    switch (move.type) {
      case 'resign':
        return { ok: true, state: finish(state, { winner: opponent, reason: 'resign' }, now) };

      case 'offer-draw': {
        // Offering back while the opponent's offer is pending is simply accepting it.
        if (state.drawOffer === opponent) {
          return { ok: true, state: finish(state, { winner: null, reason: 'agreement' }, now) };
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
        return { ok: true, state: finish(state, { winner: null, reason: 'agreement' }, now) };

      case 'decline-draw':
        if (state.drawOffer !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, drawOffer: null } };

      case 'move': {
        const chess = load(state);
        if (chess.turn() !== color) return { ok: false, error: 'NOT_YOUR_TURN' };

        // A move that arrives after the flag fell loses on time instead of being played.
        let clock = state.clock;
        if (clock && clock.turnStartedAt !== null) {
          const left = remainingAt(clock, color, now)[color];
          if (left <= 0) return { ok: true, state: flag(state) };
          clock = { ...clock, remaining: { ...clock.remaining, [color]: left + clock.incrementMs } };
        }

        try {
          chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
        } catch {
          return { ok: false, error: 'INVALID_MOVE' };
        }
        if (clock) clock = { ...clock, turnStartedAt: chess.history().length >= CLOCK_START_PLY ? now : null };

        // Moving on is an implicit answer to any pending offer.
        const next = { ...state, pgn: chess.pgn(), drawOffer: null, clock };
        const result = detectResult(chess, next);
        return { ok: true, state: result ? finish(next, result, now) : next };
      }

      default:
        return { ok: false, error: 'INVALID_MOVE' };
    }
  },

  forfeit(state, playerId, { now }) {
    if (state.result) return state;
    const color = colorOf(state, playerId);
    if (!color) return state;
    return finish(state, { winner: opponentOf(state, color), reason: 'resign' }, now);
  },

  deadline(state) {
    const clock = state.clock;
    if (state.result || !clock || clock.turnStartedAt === null) return null;
    return clock.turnStartedAt + clock.remaining[load(state).turn()];
  },

  timeout(state, { now }) {
    const deadline = chessGame.deadline!(state);
    return deadline !== null && now >= deadline ? flag(state) : state;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    const chess = load(state);
    const clock = state.clock;
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
      clock: clock && {
        remaining: remainingAt(clock, chess.turn(), now),
        running: clock.turnStartedAt === null ? null : chess.turn(),
        incrementMs: clock.incrementMs,
      },
    };
  },
};
