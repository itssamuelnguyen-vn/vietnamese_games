import { TIME_CONTROLS, type GameDefinition } from '../types';
import { CLOCK_START_PLY, chooseSides, clockView, firstMoveDeadline, remainingAt, stopClock, type ClockView, type MatchClock } from './match';

// Caro (gomoku): two players take turns placing X and O on a grid; five or more in a row wins.
// Under the Vietnamese "blocked at both ends" rule, a line whose two ends are both stopped by the
// opponent's stones doesn't count. Cells are numbered row by row from the top-left corner.

export type CaroSide = 'x' | 'o';

export type CaroEndReason = 'five' | 'full' | 'resign' | 'agreement' | 'timeout' | 'aborted' | 'abandoned';

export interface CaroResult {
  winner: string | null; // null = draw
  reason: CaroEndReason;
  // The winning row of stones, for highlighting.
  line: number[] | null;
}

export interface CaroState {
  x: string;
  o: string;
  size: number;
  blockRule: boolean;
  moves: number[];
  result: CaroResult | null;
  drawOffer: string | null;
  drawOfferedAt: Record<string, number>;
  takebackRequest: string | null;
  takebackRequestedAt: Record<string, number>;
  clock: MatchClock<CaroSide> | null;
  firstMoveDeadline: number | null;
}

export type CaroMove =
  | { type: 'place'; cell: number }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'accept-draw' }
  | { type: 'decline-draw' }
  | { type: 'request-takeback' }
  | { type: 'accept-takeback' }
  | { type: 'decline-takeback' };

export interface CaroView {
  x: string;
  o: string;
  size: number;
  blockRule: boolean;
  moves: number[];
  turn: CaroSide;
  // Always false; present so the shared two-player screen can treat all duels alike.
  inCheck: boolean;
  result: CaroResult | null;
  drawOffer: string | null;
  canOfferDraw: boolean;
  takebackRequest: string | null;
  canRequestTakeback: boolean;
  clock: ClockView<CaroSide> | null;
  firstMoveMs: number | null;
}

export const CARO_SIZES = [15, 19];
const COLUMNS = 'abcdefghijklmnopqrs';
const DIRECTIONS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// "h8": column letter, then row counted from the bottom, as in gomoku records.
export function cellName(cell: number, size: number): string {
  return `${COLUMNS[cell % size]}${size - Math.floor(cell / size)}`;
}

export const turnOf = (moves: number[]): CaroSide => (moves.length % 2 === 0 ? 'x' : 'o');

// The grid after the given moves: 'x', 'o' or null per cell.
export function caroBoard(moves: number[], size: number): (CaroSide | null)[] {
  const board: (CaroSide | null)[] = Array(size * size).fill(null);
  moves.forEach((cell, i) => (board[cell] = i % 2 === 0 ? 'x' : 'o'));
  return board;
}

// The winning line through `cell`, if the stone there completes one.
export function winningLine(board: (CaroSide | null)[], size: number, cell: number, blockRule: boolean): number[] | null {
  const side = board[cell];
  if (!side) return null;
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  const at = (r: number, c: number) => (r >= 0 && r < size && c >= 0 && c < size ? board[r * size + c] : undefined);
  for (const [dr, dc] of DIRECTIONS) {
    const line = [cell];
    let r = r0 + dr;
    let c = c0 + dc;
    for (; at(r, c) === side; r += dr, c += dc) line.push(r * size + c);
    const endA = at(r, c);
    r = r0 - dr;
    c = c0 - dc;
    for (; at(r, c) === side; r -= dr, c -= dc) line.unshift(r * size + c);
    const endB = at(r, c);
    if (line.length < 5) continue;
    // The board's edge doesn't block; only the opponent's stones do.
    const blocked = (end: CaroSide | null | undefined) => end !== undefined && end !== null && end !== side;
    if (blockRule && blocked(endA) && blocked(endB)) continue;
    return line;
  }
  return null;
}

function sideOf(state: CaroState, playerId: string): CaroSide | null {
  if (playerId === state.x) return 'x';
  if (playerId === state.o) return 'o';
  return null;
}

const opponentOf = (state: CaroState, side: CaroSide) => (side === 'x' ? state.o : state.x);

function canOfferDraw(state: CaroState, playerId: string, ply: number): boolean {
  return !state.result && sideOf(state, playerId) !== null && state.drawOffer === null && state.drawOfferedAt[playerId] !== ply;
}

function canRequestTakeback(state: CaroState, playerId: string, ply: number): boolean {
  const side = sideOf(state, playerId);
  if (!side || state.result || state.takebackRequest !== null || state.takebackRequestedAt[playerId] === ply) return false;
  return ply >= (side === 'x' ? 1 : 2);
}

function finish(state: CaroState, result: CaroResult, now: number): CaroState {
  const clock = stopClock(state.clock, turnOf(state.moves), now);
  return { ...state, clock, drawOffer: null, takebackRequest: null, firstMoveDeadline: null, result };
}

function flag(state: CaroState): CaroState {
  const loser = turnOf(state.moves);
  const clock = state.clock && { ...state.clock, remaining: { ...state.clock.remaining, [loser]: 0 }, turnStartedAt: null };
  const winner = loser === 'x' ? state.o : state.x;
  return { ...state, clock, drawOffer: null, takebackRequest: null, firstMoveDeadline: null, result: { winner, reason: 'timeout', line: null } };
}

function takeBack(state: CaroState, requester: CaroSide, now: number): CaroState {
  const undo = turnOf(state.moves) === requester ? 2 : 1;
  const moves = state.moves.slice(0, state.moves.length - undo);
  let clock = state.clock;
  if (clock) {
    clock = {
      ...clock,
      remaining: remainingAt(clock, turnOf(state.moves), now),
      turnStartedAt: moves.length >= CLOCK_START_PLY ? now : null,
    };
  }
  return { ...state, moves, clock, drawOffer: null, takebackRequest: null, firstMoveDeadline: firstMoveDeadline(clock, moves.length, now) };
}

// ---- Bot ----

// Value of a run of `count` stones with `open` free ends, for attacking or defending.
function runScore(count: number, open: number, blockRule: boolean): number {
  if (count >= 5) return blockRule && open === 0 ? 0 : 1_000_000;
  if (open === 0) return 0;
  const table: Record<number, [number, number]> = { 4: [10_000, 100_000], 3: [500, 5_000], 2: [50, 200], 1: [5, 10] };
  return table[count][open - 1];
}

// How good placing `side` at `cell` would be for that side.
function cellScore(board: (CaroSide | null)[], size: number, cell: number, side: CaroSide, blockRule: boolean): number {
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  const at = (r: number, c: number) => (r >= 0 && r < size && c >= 0 && c < size ? board[r * size + c] : 'edge');
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    let open = 0;
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign;
      let c = c0 + dc * sign;
      while (at(r, c) === side) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
      if (at(r, c) === null) open++;
    }
    total += runScore(count, open, blockRule);
  }
  return total;
}

// Picks the cell that best combines attacking and blocking, preferring the centre on ties.
export function caroBotCell(moves: number[], size: number, blockRule: boolean): number {
  const center = Math.floor(size / 2) * size + Math.floor(size / 2);
  if (moves.length === 0) return center;
  const board = caroBoard(moves, size);
  const side = turnOf(moves);
  const enemy: CaroSide = side === 'x' ? 'o' : 'x';
  const near = (cell: number) => {
    const r = Math.floor(cell / size);
    const c = cell % size;
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr * size + cc]) return true;
      }
    return false;
  };
  let best = -1;
  let bestScore = -1;
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] || !near(cell)) continue;
    const dist = Math.abs(Math.floor(cell / size) - Math.floor(center / size)) + Math.abs((cell % size) - (center % size));
    const score = cellScore(board, size, cell, side, blockRule) + 0.9 * cellScore(board, size, cell, enemy, blockRule) - dist * 0.01;
    if (score > bestScore) [best, bestScore] = [cell, score];
  }
  return best >= 0 ? best : board.indexOf(null);
}

// ---- Game definition ----

export const caroGame: GameDefinition<CaroState, CaroMove, CaroView> = {
  type: 'caro',

  setup(playerIds, options, { now }, previous) {
    const [x, o] = chooseSides(playerIds, options.hostColor, previous && [previous.x, previous.o]);
    const tc = TIME_CONTROLS[options.timeControl];
    const clock = tc && { incrementMs: tc.incrementMs, remaining: { x: tc.initialMs, o: tc.initialMs }, turnStartedAt: null };
    const size = CARO_SIZES.includes(Number(options.caroSize)) ? Number(options.caroSize) : CARO_SIZES[0];
    return {
      x,
      o,
      size,
      blockRule: options.caroBlock ?? true,
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
    const ply = state.moves.length;

    switch (move?.type) {
      case 'resign':
        return { ok: true, state: finish(state, { winner: opponent, reason: 'resign', line: null }, now) };

      case 'offer-draw':
        if (state.drawOffer === opponent) return { ok: true, state: finish(state, { winner: null, reason: 'agreement', line: null }, now) };
        if (!canOfferDraw(state, playerId, ply)) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, drawOffer: playerId, drawOfferedAt: { ...state.drawOfferedAt, [playerId]: ply } } };

      case 'accept-draw':
        if (state.drawOffer !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: finish(state, { winner: null, reason: 'agreement', line: null }, now) };

      case 'decline-draw':
        if (state.drawOffer !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, drawOffer: null } };

      case 'request-takeback':
        if (!canRequestTakeback(state, playerId, ply)) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, takebackRequest: playerId, takebackRequestedAt: { ...state.takebackRequestedAt, [playerId]: ply } } };

      case 'accept-takeback':
        if (state.takebackRequest !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: takeBack(state, side === 'x' ? 'o' : 'x', now) };

      case 'decline-takeback':
        if (state.takebackRequest !== opponent) return { ok: false, error: 'INVALID_MOVE' };
        return { ok: true, state: { ...state, takebackRequest: null } };

      case 'place': {
        if (turnOf(state.moves) !== side) return { ok: false, error: 'NOT_YOUR_TURN' };
        const { cell } = move;
        if (!Number.isInteger(cell) || cell < 0 || cell >= state.size * state.size || state.moves.includes(cell)) {
          return { ok: false, error: 'INVALID_MOVE' };
        }
        let clock = state.clock;
        if (clock && clock.turnStartedAt !== null) {
          const left = remainingAt(clock, side, now)[side];
          if (left <= 0) return { ok: true, state: flag(state) };
          clock = { ...clock, remaining: { ...clock.remaining, [side]: left + clock.incrementMs } };
        }
        const moves = [...state.moves, cell];
        if (clock) clock = { ...clock, turnStartedAt: moves.length >= CLOCK_START_PLY ? now : null };
        const next: CaroState = { ...state, moves, drawOffer: null, takebackRequest: null, clock, firstMoveDeadline: firstMoveDeadline(clock, moves.length, now) };
        const line = winningLine(caroBoard(moves, state.size), state.size, cell, state.blockRule);
        if (line) return { ok: true, state: finish(next, { winner: playerId, reason: 'five', line }, now) };
        if (moves.length === state.size * state.size) return { ok: true, state: finish(next, { winner: null, reason: 'full', line: null }, now) };
        return { ok: true, state: next };
      }

      default:
        return { ok: false, error: 'INVALID_MOVE' };
    }
  },

  forfeit(state, playerId, { now }, reason) {
    if (state.result) return state;
    const side = sideOf(state, playerId);
    if (!side) return state;
    return finish(state, { winner: opponentOf(state, side), reason: reason === 'abandoned' ? 'abandoned' : 'resign', line: null }, now);
  },

  deadline(state) {
    const clock = state.clock;
    if (state.result) return null;
    if (state.firstMoveDeadline !== null) return state.firstMoveDeadline;
    if (!clock || clock.turnStartedAt === null) return null;
    return clock.turnStartedAt + clock.remaining[turnOf(state.moves)];
  },

  timeout(state, { now }) {
    if (state.result) return state;
    if (state.firstMoveDeadline !== null) {
      return now >= state.firstMoveDeadline ? finish(state, { winner: null, reason: 'aborted', line: null }, now) : state;
    }
    const deadline = caroGame.deadline!(state);
    return deadline !== null && now >= deadline ? flag(state) : state;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    const turn = turnOf(state.moves);
    return {
      x: state.x,
      o: state.o,
      size: state.size,
      blockRule: state.blockRule,
      moves: state.moves,
      turn,
      inCheck: false,
      result: state.result,
      drawOffer: state.drawOffer,
      canOfferDraw: canOfferDraw(state, playerId, state.moves.length),
      takebackRequest: state.takebackRequest,
      canRequestTakeback: canRequestTakeback(state, playerId, state.moves.length),
      clock: clockView(state.clock, turn, now),
      firstMoveMs: state.firstMoveDeadline === null || state.result ? null : Math.max(0, state.firstMoveDeadline - now),
    };
  },

  points(state) {
    if (!state.result) return null;
    const { winner } = state.result;
    const score = (id: string) => (winner === null ? 0 : winner === id ? 1 : -1);
    return { [state.x]: { points: score(state.x), place: winner === state.o ? 2 : 1 }, [state.o]: { points: score(state.o), place: winner === state.x ? 2 : 1 } };
  },

  // Bots answer draw offers and takeback requests, then play their move.
  botMove(state, playerId) {
    const side = sideOf(state, playerId);
    if (!side || state.result) return null;
    const opponent = opponentOf(state, side);
    if (state.drawOffer === opponent) return { type: 'decline-draw' };
    if (state.takebackRequest === opponent) return { type: 'accept-takeback' };
    if (turnOf(state.moves) !== side) return null;
    return { type: 'place', cell: caroBotCell(state.moves, state.size, state.blockRule) };
  },
};
