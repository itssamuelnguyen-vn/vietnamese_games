import { TIME_CONTROLS, type GameDefinition } from '../types';
import {
  CLOCK_START_PLY,
  chooseSides,
  clockView,
  firstMoveDeadline,
  remainingAt,
  stopClock,
  type ClockView,
  type MatchClock,
} from './match';
import { Xiangqi, type XSide } from './xiangqi-engine';

export type XiangqiEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'perpetual-check'
  | 'repetition'
  | 'no-capture'
  | 'insufficient'
  | 'resign'
  | 'agreement'
  | 'timeout'
  | 'aborted'
  | 'abandoned';

export interface XiangqiResult {
  winner: string | null; // null = draw
  reason: XiangqiEndReason;
}

export interface XiangqiState {
  red: string;
  black: string;
  // Moves in ICCS form, e.g. "h2e2".
  moves: string[];
  // Custom starting position (tests, puzzles); the standard opening when absent.
  startFen?: string;
  result: XiangqiResult | null;
  drawOffer: string | null;
  drawOfferedAt: Record<string, number>;
  takebackRequest: string | null;
  takebackRequestedAt: Record<string, number>;
  clock: MatchClock<XSide> | null;
  firstMoveDeadline: number | null;
}

export type XiangqiMove =
  | { type: 'move'; from: string; to: string }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'accept-draw' }
  | { type: 'decline-draw' }
  | { type: 'request-takeback' }
  | { type: 'accept-takeback' }
  | { type: 'decline-takeback' };

export interface XiangqiView {
  red: string;
  black: string;
  fen: string;
  turn: XSide;
  moves: string[];
  lastMove: { from: string; to: string } | null;
  inCheck: boolean;
  result: XiangqiResult | null;
  drawOffer: string | null;
  canOfferDraw: boolean;
  takebackRequest: string | null;
  canRequestTakeback: boolean;
  clock: ClockView<XSide> | null;
  firstMoveMs: number | null;
}

// Asian rules: 60 moves each without a capture is a draw.
export const NO_CAPTURE_PLIES = 120;
const REPETITIONS = 3;

function load(state: Pick<XiangqiState, 'moves' | 'startFen'>): Xiangqi {
  const game = new Xiangqi(state.startFen);
  for (const m of state.moves) game.move(m);
  return game;
}

function sideOf(state: XiangqiState, playerId: string): XSide | null {
  if (playerId === state.red) return 'r';
  if (playerId === state.black) return 'b';
  return null;
}

const opponentOf = (state: XiangqiState, side: XSide) => (side === 'r' ? state.black : state.red);
const playerOf = (state: XiangqiState, side: XSide) => (side === 'r' ? state.red : state.black);

function canOfferDraw(state: XiangqiState, playerId: string, ply: number): boolean {
  return !state.result && sideOf(state, playerId) !== null && state.drawOffer === null && state.drawOfferedAt[playerId] !== ply;
}

function canRequestTakeback(state: XiangqiState, playerId: string, ply: number): boolean {
  const side = sideOf(state, playerId);
  if (!side || state.result || state.takebackRequest !== null || state.takebackRequestedAt[playerId] === ply) return false;
  return ply >= (side === 'r' ? 1 : 2);
}

function finish(state: XiangqiState, result: XiangqiResult, now: number): XiangqiState {
  const clock = stopClock(state.clock, load(state).turn(), now);
  return { ...state, clock, drawOffer: null, takebackRequest: null, firstMoveDeadline: null, result };
}

// Result after the latest move, if the game is over.
export function detectResult(state: XiangqiState): XiangqiResult | null {
  const game = new Xiangqi(state.startFen);
  const keys = [game.positionKey()];
  const checks: boolean[] = [];
  let sinceCapture = 0;
  for (const m of state.moves) {
    const move = game.move(m);
    keys.push(game.positionKey());
    checks.push(move.check);
    sinceCapture = move.captured ? 0 : sinceCapture + 1;
  }
  const mover: XSide = game.turn() === 'r' ? 'b' : 'r';

  // No legal reply loses in xiangqi, check or not.
  if (state.moves.length > 0 && !game.hasLegalMoves()) {
    return { winner: playerOf(state, mover), reason: game.inCheck() ? 'checkmate' : 'stalemate' };
  }

  // Third occurrence of a position: a side that checked on every move of the cycle loses
  // (perpetual check); otherwise it's a draw.
  const current = keys.at(-1)!;
  const seen = keys.flatMap((k, i) => (k === current ? [i] : []));
  if (seen.length >= REPETITIONS) {
    const start = seen.at(-2)!;
    const cycle = checks.slice(start);
    // Move k (0-based) was made by red when k is even, since red moves first.
    const bySide = (side: XSide) => cycle.filter((_, i) => ((start + i) % 2 === 0 ? 'r' : 'b') === side);
    const perpetual = (side: XSide) => {
      const own = bySide(side);
      return own.length > 0 && own.every(Boolean);
    };
    const red = perpetual('r');
    const black = perpetual('b');
    if (red !== black) return { winner: playerOf(state, red ? 'b' : 'r'), reason: 'perpetual-check' };
    return { winner: null, reason: 'repetition' };
  }

  if (sinceCapture >= NO_CAPTURE_PLIES) return { winner: null, reason: 'no-capture' };
  if (!game.hasAttackers('r') && !game.hasAttackers('b')) return { winner: null, reason: 'insufficient' };
  return null;
}

function flag(state: XiangqiState): XiangqiState {
  const game = load(state);
  const loser = game.turn();
  const winnerSide: XSide = loser === 'r' ? 'b' : 'r';
  const clock = state.clock && { ...state.clock, remaining: { ...state.clock.remaining, [loser]: 0 }, turnStartedAt: null };
  // Out of time only loses if the opponent still has something that can attack.
  const winner = game.hasAttackers(winnerSide) ? playerOf(state, winnerSide) : null;
  return { ...state, clock, drawOffer: null, takebackRequest: null, firstMoveDeadline: null, result: { winner, reason: 'timeout' } };
}

function takeBack(state: XiangqiState, requester: XSide, now: number): XiangqiState {
  const game = load(state);
  const undo = game.turn() === requester ? 2 : 1;
  const moves = state.moves.slice(0, state.moves.length - undo);
  const ply = moves.length;
  let clock = state.clock;
  if (clock) {
    // Charge the side that was thinking up to now, then restart for the new side to move.
    clock = { ...clock, remaining: remainingAt(clock, game.turn(), now), turnStartedAt: ply >= CLOCK_START_PLY ? now : null };
  }
  return { ...state, moves, clock, drawOffer: null, takebackRequest: null, firstMoveDeadline: firstMoveDeadline(clock, ply, now) };
}

export const xiangqiGame: GameDefinition<XiangqiState, XiangqiMove, XiangqiView> = {
  type: 'xiangqi',

  setup(playerIds, options, { now }, previous) {
    const [red, black] = chooseSides(playerIds, options.hostColor, previous && [previous.red, previous.black]);
    const tc = TIME_CONTROLS[options.timeControl];
    const clock = tc && { incrementMs: tc.incrementMs, remaining: { r: tc.initialMs, b: tc.initialMs }, turnStartedAt: null };
    return {
      red,
      black,
      moves: [],
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
    const side = sideOf(state, playerId);
    if (!side) return { ok: false, error: 'NOT_A_PLAYER' };
    const opponent = opponentOf(state, side);

    switch (move.type) {
      case 'resign':
        return { ok: true, state: finish(state, { winner: opponent, reason: 'resign' }, now) };

      case 'offer-draw': {
        if (state.drawOffer === opponent) return { ok: true, state: finish(state, { winner: null, reason: 'agreement' }, now) };
        const ply = state.moves.length;
        if (!canOfferDraw(state, playerId, ply)) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, drawOffer: playerId, drawOfferedAt: { ...state.drawOfferedAt, [playerId]: ply } } };
      }

      case 'accept-draw':
        if (state.drawOffer !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: finish(state, { winner: null, reason: 'agreement' }, now) };

      case 'decline-draw':
        if (state.drawOffer !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, drawOffer: null } };

      case 'request-takeback': {
        const ply = state.moves.length;
        if (!canRequestTakeback(state, playerId, ply)) return { ok: false, error: 'INVALID_MOVE' };
        return {
          ok: true,
          state: { ...state, takebackRequest: playerId, takebackRequestedAt: { ...state.takebackRequestedAt, [playerId]: ply } },
        };
      }

      case 'accept-takeback':
        if (state.takebackRequest !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: takeBack(state, side === 'r' ? 'b' : 'r', now) };

      case 'decline-takeback':
        if (state.takebackRequest !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, takebackRequest: null } };

      case 'move': {
        const game = load(state);
        if (game.turn() !== side) return { ok: false, error: 'NOT_YOUR_TURN' };

        let clock = state.clock;
        if (clock && clock.turnStartedAt !== null) {
          const left = remainingAt(clock, side, now)[side];
          if (left <= 0) return { ok: true, state: flag(state) };
          clock = { ...clock, remaining: { ...clock.remaining, [side]: left + clock.incrementMs } };
        }

        try {
          game.move({ from: move.from, to: move.to });
        } catch {
          return { ok: false, error: 'INVALID_MOVE' };
        }
        const moves = [...state.moves, `${move.from}${move.to}`];
        if (clock) clock = { ...clock, turnStartedAt: moves.length >= CLOCK_START_PLY ? now : null };
        const next: XiangqiState = {
          ...state,
          moves,
          drawOffer: null,
          takebackRequest: null,
          clock,
          firstMoveDeadline: firstMoveDeadline(clock, moves.length, now),
        };
        const result = detectResult(next);
        return { ok: true, state: result ? finish(next, result, now) : next };
      }

      default:
        return { ok: false, error: 'INVALID_MOVE' };
    }
  },

  forfeit(state, playerId, { now }, reason) {
    if (state.result) return state;
    const side = sideOf(state, playerId);
    if (!side) return state;
    return finish(state, { winner: opponentOf(state, side), reason: reason === 'abandoned' ? 'abandoned' : 'resign' }, now);
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
    const deadline = xiangqiGame.deadline!(state);
    return deadline !== null && now >= deadline ? flag(state) : state;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    const game = load(state);
    const last = game.history().at(-1);
    return {
      red: state.red,
      black: state.black,
      fen: game.fen(),
      turn: game.turn(),
      moves: state.moves,
      lastMove: last ? { from: last.from, to: last.to } : null,
      inCheck: game.inCheck(),
      result: state.result,
      drawOffer: state.drawOffer,
      canOfferDraw: canOfferDraw(state, playerId, state.moves.length),
      takebackRequest: state.takebackRequest,
      canRequestTakeback: canRequestTakeback(state, playerId, state.moves.length),
      clock: clockView(state.clock, game.turn(), now),
      firstMoveMs: state.firstMoveDeadline === null || state.result ? null : Math.max(0, state.firstMoveDeadline - now),
    };
  },
};
