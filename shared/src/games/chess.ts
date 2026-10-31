import { Chess } from 'chess.js';
import { TIME_CONTROLS, type GameDefinition } from '../types';
import {
  CLOCK_START_PLY,
  chooseSides,
  clockView,
  firstMoveDeadline,
  remainingAt,
  stopClock as stopMatchClock,
  type ClockView,
  type MatchClock,
} from './match';

export type ChessColor = 'w' | 'b';

export type ChessEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'insufficient'
  | 'fifty-moves'
  | 'resign'
  | 'agreement'
  | 'timeout'
  | 'aborted'
  | 'abandoned';

export interface ChessResult {
  winner: string | null; // null = draw
  reason: ChessEndReason;
}

export type ChessClock = MatchClock<ChessColor>;

export interface ChessState {
  white: string;
  black: string;
  pgn: string;
  result: ChessResult | null;
  // Player whose draw offer is waiting for an answer.
  drawOffer: string | null;
  // Ply at which each player last offered a draw, to stop offer spam.
  drawOfferedAt: Record<string, number>;
  // Player asking to take back their last move, and when each player last asked.
  takebackRequest: string | null;
  takebackRequestedAt: Record<string, number>;
  clock: ChessClock | null;
  // Timed games are aborted if the side to move hasn't made its first move by this time.
  firstMoveDeadline: number | null;
}

export type ChessMove =
  | { type: 'move'; from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'accept-draw' }
  | { type: 'decline-draw' }
  | { type: 'request-takeback' }
  | { type: 'accept-takeback' }
  | { type: 'decline-takeback' };

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
  takebackRequest: string | null;
  canRequestTakeback: boolean;
  // Time left (as of the view) to make the first move before the game is aborted.
  firstMoveMs: number | null;
  // Remaining times as of when the view was built; `running` is the side whose clock is ticking.
  clock: ClockView<ChessColor> | null;
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

// Same rule for takebacks: one request per player per ply, and only once they've moved.
function canRequestTakeback(state: ChessState, playerId: string, ply: number): boolean {
  const color = colorOf(state, playerId);
  if (!color || state.result || state.takebackRequest !== null || state.takebackRequestedAt[playerId] === ply) return false;
  return ply >= (color === 'w' ? 1 : 2);
}

function stopClock(state: ChessState, now: number): ChessClock | null {
  return state.clock && stopMatchClock(state.clock, load(state).turn(), now);
}

const squareShade = (square: string) => (square.charCodeAt(0) + Number(square[1])) % 2;

// Could `color` still checkmate by any legal sequence (FIDE flag rule)? Same reasoning as
// Lichess: a lone knight needs a non-queen blocker, same-shade bishops need the opponent to
// have a pawn, knight or opposite-shade bishop.
export function canMate(chess: Chess, color: ChessColor): boolean {
  const mine: { type: string; square: string }[] = [];
  const theirs: { type: string; square: string }[] = [];
  for (const row of chess.board()) {
    for (const sq of row) if (sq && sq.type !== 'k') (sq.color === color ? mine : theirs).push(sq);
  }
  if (mine.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return true;
  const knights = mine.filter((p) => p.type === 'n').length;
  const bishops = mine.filter((p) => p.type === 'b');
  if (knights + bishops.length === 0) return false;
  if (knights > 0 && bishops.length > 0) return true;
  if (knights >= 2) return true;
  if (knights === 1) return theirs.some((p) => p.type !== 'q');
  const shades = new Set(bishops.map((b) => squareShade(b.square)));
  if (shades.size > 1) return true;
  const shade = squareShade(bishops[0].square);
  return theirs.some((p) => p.type === 'p' || p.type === 'n' || (p.type === 'b' && squareShade(p.square) !== shade));
}

function flag(state: ChessState): ChessState {
  const chess = load(state);
  const loser = chess.turn();
  const winnerColor: ChessColor = loser === 'w' ? 'b' : 'w';
  const clock = state.clock && { ...state.clock, remaining: { ...state.clock.remaining, [loser]: 0 }, turnStartedAt: null };
  const winner = canMate(chess, winnerColor) ? opponentOf(state, loser) : null;
  return { ...state, clock, drawOffer: null, takebackRequest: null, result: { winner, reason: 'timeout' } };
}

// Ends the game with `result`, freezing the clock at the current moment.
function finish(state: ChessState, result: ChessResult, now: number): ChessState {
  return { ...state, clock: stopClock(state, now), drawOffer: null, takebackRequest: null, firstMoveDeadline: null, result };
}

// Undo the requester's last move (and the opponent's reply, if they already made one).
function takeBack(state: ChessState, requesterColor: ChessColor, now: number): ChessState {
  const chess = load(state);
  const undo = chess.turn() === requesterColor ? 2 : 1;
  for (let i = 0; i < undo; i++) chess.undo();
  const ply = chess.history().length;
  let clock = state.clock;
  if (clock) {
    // Charge the side that was thinking up to now, then restart for the new side to move.
    const remaining = remainingAt(clock, load(state).turn(), now);
    clock = { ...clock, remaining, turnStartedAt: ply >= CLOCK_START_PLY ? now : null };
  }
  return {
    ...state,
    pgn: chess.pgn(),
    clock,
    drawOffer: null,
    takebackRequest: null,
    firstMoveDeadline: firstMoveDeadline(clock, ply, now),
  };
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

  setup(playerIds, options, { now }, previous) {
    const [white, black] = chooseSides(playerIds, options.hostColor, previous && [previous.white, previous.black]);
    const tc = TIME_CONTROLS[options.timeControl];
    const clock = tc && { incrementMs: tc.incrementMs, remaining: { w: tc.initialMs, b: tc.initialMs }, turnStartedAt: null };
    return {
      white,
      black,
      pgn: '',
      result: null,
      drawOffer: null,
      drawOfferedAt: {},
      takebackRequest: null,
      takebackRequestedAt: {},
      clock,
      firstMoveDeadline: firstMoveDeadline(clock, 0, now),
    };
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

      case 'request-takeback': {
        const ply = plyCount(state);
        if (!canRequestTakeback(state, playerId, ply)) return { ok: false, error: 'INVALID_MOVE' };
        return {
          ok: true,
          state: { ...state, takebackRequest: playerId, takebackRequestedAt: { ...state.takebackRequestedAt, [playerId]: ply } },
        };
      }

      case 'accept-takeback':
        if (state.takebackRequest !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: takeBack(state, color === 'w' ? 'b' : 'w', now) };

      case 'decline-takeback':
        if (state.takebackRequest !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, takebackRequest: null } };

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

        // Moving on is an implicit answer to any pending offer or request.
        const next = {
          ...state,
          pgn: chess.pgn(),
          drawOffer: null,
          takebackRequest: null,
          clock,
          firstMoveDeadline: firstMoveDeadline(clock, chess.history().length, now),
        };
        const result = detectResult(chess, next);
        return { ok: true, state: result ? finish(next, result, now) : next };
      }

      default:
        return { ok: false, error: 'INVALID_MOVE' };
    }
  },

  forfeit(state, playerId, { now }, reason) {
    if (state.result) return state;
    const color = colorOf(state, playerId);
    if (!color) return state;
    return finish(state, { winner: opponentOf(state, color), reason: reason === 'abandoned' ? 'abandoned' : 'resign' }, now);
  },

  deadline(state) {
    const clock = state.clock;
    if (state.result) return null;
    if (state.firstMoveDeadline !== null) return state.firstMoveDeadline;
    if (!clock || clock.turnStartedAt === null) return null;
    return clock.turnStartedAt + clock.remaining[load(state).turn()];
  },

  timeout(state, { now }) {
    if (state.result) return state;
    if (state.firstMoveDeadline !== null) {
      return now >= state.firstMoveDeadline ? finish(state, { winner: null, reason: 'aborted' }, now) : state;
    }
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
      takebackRequest: state.takebackRequest,
      canRequestTakeback: canRequestTakeback(state, playerId, verbose.length),
      firstMoveMs: state.firstMoveDeadline === null || state.result ? null : Math.max(0, state.firstMoveDeadline - now),
      clock: clockView(clock, chess.turn(), now),
    };
  },
};
