import { TIME_CONTROLS, type GameDefinition, type HandicapId } from '../types';
import {
  CLOCK_START_PLY,
  chooseSides,
  clockView,
  firstMoveDeadline,
  remainingAt,
  stopClock,
  type ClockView,
  type MatchClock,
  duelPoints,
  refundIncrements,
  BOT_DRAW_BELOW,
  botThinkMs,
} from './match';
import { xiangqiBotMove, xiangqiScore } from './xiangqi-bot';
import { START_FEN, Xiangqi, type XSide } from './xiangqi-engine';

export type XiangqiEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'perpetual-check'
  | 'perpetual-chase'
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
  // Position the game started from (differs from the standard one in handicap games).
  startFen: string;
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

// Pieces removed from the giving side's left wing (from that player's own point of view).
const HANDICAP_SQUARES: Record<Exclude<HandicapId, 'none'>, Record<XSide, string[]>> = {
  chariot: { r: ['a0'], b: ['i9'] },
  horse: { r: ['b0'], b: ['h9'] },
  cannon: { r: ['b2'], b: ['h7'] },
  'two-horses': { r: ['b0', 'h0'], b: ['b9', 'h9'] },
};

// Starting position with `side` giving `handicap` odds.
export function handicapFen(side: XSide, handicap: HandicapId): string {
  if (handicap === 'none') return START_FEN;
  const game = new Xiangqi(START_FEN);
  for (const square of HANDICAP_SQUARES[handicap][side]) game.remove(square);
  return game.fen();
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

// Perpetual chase (đuổi dai), a practical simplification of the Asian rules: over the last
// `plies` moves of `game` (a repetition cycle), did each side check or chase on every one of its
// moves? A move chases when, after it, the mover threatens to win an enemy piece it didn't
// threaten before the move (see Xiangqi.threatened: undefended, or worth more than the attacker).
// Unlike the full rules, this doesn't insist on the same piece being chased throughout, and it
// doesn't weigh exchanges or chases that are forced replies. Only runs once a position has
// come up a third time, replaying just the cycle; `game` ends up where it started.
function chasedEveryMove(game: Xiangqi, plies: number): Record<XSide, boolean> {
  const cycle = game.history().slice(-plies);
  for (let i = 0; i < plies; i++) game.undo();
  const perpetual: Record<XSide, boolean> = { r: true, b: true };
  for (const move of cycle) {
    const side = move.side;
    if (!perpetual[side] || move.check) {
      game.playTrusted(move);
      continue;
    }
    const before = game.threatened(side);
    game.playTrusted(move);
    perpetual[side] = [...game.threatened(side)].some((square) => !before.has(square));
  }
  return perpetual;
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
  // (perpetual check). Failing that, a side whose every move in the cycle checked or chased loses
  // (perpetual chase, see chasedEveryMove). Otherwise, including when both sides are perpetual,
  // it's a draw.
  const current = keys.at(-1)!;
  const seen = keys.flatMap((k, i) => (k === current ? [i] : []));
  if (seen.length >= REPETITIONS) {
    const start = seen.at(-2)!;
    const cycle = checks.slice(start);
    // Who made move k (0-based) depends on who moved first (usually red, but not from every start position).
    const firstMover = new Xiangqi(state.startFen).turn();
    const moverOf = (k: number): XSide => ((k % 2 === 0) === (firstMover === 'r') ? 'r' : 'b');
    const bySide = (side: XSide) => cycle.filter((_, i) => moverOf(start + i) === side);
    const perpetual = (side: XSide) => {
      const own = bySide(side);
      return own.length > 0 && own.every(Boolean);
    };
    const red = perpetual('r');
    const black = perpetual('b');
    if (red !== black) return { winner: playerOf(state, red ? 'b' : 'r'), reason: 'perpetual-check' };
    if (!red) {
      const chasing = chasedEveryMove(game, cycle.length);
      if (chasing.r !== chasing.b) return { winner: playerOf(state, chasing.r ? 'b' : 'r'), reason: 'perpetual-chase' };
    }
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
    const first = new Xiangqi(state.startFen).turn();
    const moverAt = (k: number): XSide => ((k % 2 === 0) === (first === 'r') ? 'r' : 'b');
    clock = refundIncrements(clock, ply, Array.from({ length: undo }, (_, i) => moverAt(ply + i)));
  }
  return { ...state, moves, clock, drawOffer: null, takebackRequest: null, firstMoveDeadline: firstMoveDeadline(clock, ply, now) };
}

export const xiangqiGame: GameDefinition<XiangqiState, XiangqiMove, XiangqiView> = {
  type: 'xiangqi',

  setup(playerIds, options, { now }, previous) {
    const [red, black] = chooseSides(playerIds, options.hostColor, previous && [previous.red, previous.black]);
    // The host gives the odds, whichever side they end up on.
    const handicap = options.handicap ?? 'none';
    const startFen = handicap === 'none' ? undefined : handicapFen(red === playerIds[0] ? 'r' : 'b', handicap);
    const tc = TIME_CONTROLS[options.timeControl];
    const clock = tc && { incrementMs: tc.incrementMs, remaining: { r: tc.initialMs, b: tc.initialMs }, turnStartedAt: null };
    return {
      red,
      black,
      moves: [],
      startFen,
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
        // Too late for a first move: the game is aborted, even if the timer hasn't fired yet.
        if (state.firstMoveDeadline !== null && now >= state.firstMoveDeadline) {
          return { ok: true, state: finish(state, { winner: null, reason: 'aborted' }, now) };
        }

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
          // A player's own draw offer stands until the opponent replies.
          drawOffer: state.drawOffer === playerId ? playerId : null,
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

  points(state) {
    return duelPoints([state.red, state.black], state.result);
  },

  // A bot always grants takebacks, takes a draw only when it's clearly behind, and otherwise
  // searches for its move.
  heavyBot: true,

  botMove(state, playerId, { now, random, botLevel }) {
    const side = sideOf(state, playerId);
    if (state.result || !side) return null;
    const opponent = opponentOf(state, side);
    if (state.takebackRequest === opponent) return { type: 'accept-takeback' };
    // Replay the game, counting positions so the bot can steer clear of repetitions.
    const game = new Xiangqi(state.startFen);
    const seen = new Map([[game.positionKey(), 1]]);
    for (const m of state.moves) {
      game.move(m);
      seen.set(game.positionKey(), (seen.get(game.positionKey()) ?? 0) + 1);
    }
    if (state.drawOffer === opponent) return { type: xiangqiScore(game, side) < BOT_DRAW_BELOW ? 'accept-draw' : 'decline-draw' };
    if (game.turn() !== side) return null;
    const level = botLevel ?? 'medium';
    const move = xiangqiBotMove(game, seen, { timeMs: botThinkMs(state.clock, side, now, level), random, level });
    return move && { type: 'move', ...move };
  },

  playerView(state, playerId, { now }) {
    const game = load(state);
    const last = game.history().at(-1);
    return {
      red: state.red,
      black: state.black,
      fen: game.fen(),
      startFen: state.startFen ?? START_FEN,
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
