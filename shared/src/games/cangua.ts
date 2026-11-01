import { CANGUA_RULES, TURN_TIMERS, type CaNguaRuleId, type GameDefinition } from '../types';

// Co ca ngua (horse race): each player races four horses once around a 52-square track and up their own
// six-step home column. A 6 brings a horse out of the stable and earns another roll. Horses may
// not jump over other horses; landing on an opponent's horse kicks it back to its stable. A horse
// must stop exactly at its home gate, then climbs the home column one numbered step at a time.
// The first player with all four horses on the top four steps (3 to 6) wins.
// Optional rules: horses may jump over others ('jump'), climb home by the full roll ('fast-home'),
// and come out on a 1 as well as a 6 ('one-out'; only a 6 rolls again).

export const TRACK = 52;
export const ARM = TRACK / 4;
// Progress of a horse, counted from its own start square: -1 in the stable, 0..GATE on the track,
// GATE + 1..GATE + 6 on home steps 1..6.
export const STABLE = -1;
export const GATE = TRACK - 2;
export const HOME_STEPS = 6;
export const HORSES = 4;
// Colour slots around the board; two players sit opposite each other.
export const COLOR_SEATS: Record<number, number[]> = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
const MAX_SIXES = 3;
const LOG_LIMIT = 60;

export type CaNguaPhase = 'roll' | 'move';

export interface CaNguaChoice {
  horse: number;
  to: number;
  // The opponent horse kicked back to its stable, if any.
  kicks: { player: string; horse: number } | null;
}

export type CaNguaLogEntry =
  | { kind: 'roll'; player: string; value: number; auto: boolean }
  | { kind: 'release'; player: string; horse: number; kicked: string | null }
  | { kind: 'move'; player: string; horse: number; from: number; to: number; kicked: string | null }
  | { kind: 'climb'; player: string; horse: number; step: number }
  | { kind: 'stuck'; player: string }
  | { kind: 'sixes'; player: string }
  | { kind: 'left'; player: string };

export interface CaNguaResult {
  winner: string;
  // Winner first, then by how far each player's horses got; players who left come last.
  ranking: string[];
}

export interface CaNguaState {
  seats: string[];
  // Colour slot (0-3) of each seat.
  colors: number[];
  rules: CaNguaRuleId[];
  horses: Record<string, number[]>;
  turn: string;
  phase: CaNguaPhase;
  die: number | null;
  // 6s rolled in a row this turn.
  sixes: number;
  out: string[];
  log: CaNguaLogEntry[];
  result: CaNguaResult | null;
  turnLimitMs: number | null;
  turnDeadline: number | null;
}

export type CaNguaMove = { type: 'roll' } | { type: 'move'; horse: number };

export interface CaNguaView {
  rules: CaNguaRuleId[];
  seats: { id: string; color: number; horses: number[]; out: boolean }[];
  turn: string;
  phase: CaNguaPhase;
  die: number | null;
  // Legal moves for the viewer right now.
  choices: CaNguaChoice[];
  log: CaNguaLogEntry[];
  result: CaNguaResult | null;
  turnMs: number | null;
  turnLimitMs: number | null;
}

// Absolute track square (0-51) of a horse on the track, for a player in colour slot `color`.
export const squareOf = (color: number, progress: number) => (color * ARM + progress) % TRACK;

const colorOf = (s: Pick<CaNguaState, 'seats' | 'colors'>, id: string) => s.colors[s.seats.indexOf(id)];

// Who stands on each track square.
function trackOccupants(s: CaNguaState): Map<number, { player: string; horse: number }> {
  const occupied = new Map<number, { player: string; horse: number }>();
  for (const id of s.seats) {
    if (s.out.includes(id)) continue;
    s.horses[id].forEach((p, horse) => {
      if (p >= 0 && p <= GATE) occupied.set(squareOf(colorOf(s, id), p), { player: id, horse });
    });
  }
  return occupied;
}

// Every legal move for `player` with die value `die`.
export function choicesFor(s: CaNguaState, player: string, die: number): CaNguaChoice[] {
  const color = colorOf(s, player);
  const mine = s.horses[player];
  const occupied = trackOccupants(s);
  const out: CaNguaChoice[] = [];
  const landing = (square: number) => {
    const who = occupied.get(square);
    if (!who) return { ok: true, kicks: null };
    if (who.player === player) return { ok: false, kicks: null };
    return { ok: true, kicks: who };
  };
  mine.forEach((p, horse) => {
    if (p === STABLE) {
      if (die !== 6 && !(die === 1 && s.rules.includes('one-out'))) return;
      const land = landing(squareOf(color, 0));
      if (land.ok) out.push({ horse, to: 0, kicks: land.kicks });
      return;
    }
    if (p < GATE) {
      const to = p + die;
      if (to > GATE) return;
      // No jumping over any horse on the way, unless the table allows it.
      if (!s.rules.includes('jump')) for (let q = p + 1; q < to; q++) if (occupied.has(squareOf(color, q))) return;
      const land = landing(squareOf(color, to));
      if (land.ok) out.push({ horse, to, kicks: land.kicks });
      return;
    }
    // At the gate the roll picks the home step; higher up, only the next step's number climbs
    // (or, with 'fast-home', the horse climbs as many steps as the roll).
    const step = p - GATE;
    const target = step === 0 || s.rules.includes('fast-home') ? step + die : die === step + 1 ? step + 1 : null;
    if (target === null || target > HOME_STEPS) return;
    const steps = mine.filter((q) => q > GATE).map((q) => q - GATE);
    for (let k = step + 1; k <= target; k++) if (steps.includes(k)) return;
    out.push({ horse, to: GATE + target, kicks: null });
  });
  return out;
}

const withLog = (s: CaNguaState, ...entries: CaNguaLogEntry[]): CaNguaState => ({ ...s, log: [...s.log, ...entries].slice(-LOG_LIMIT) });

const active = (s: CaNguaState) => s.seats.filter((id) => !s.out.includes(id));

const won = (horses: number[]) => horses.every((p) => p - GATE >= HOME_STEPS - HORSES + 1);

// How far a player has got, for ranking everyone after the winner.
const progressOf = (horses: number[]) => horses.reduce((sum, p) => sum + p + 1, 0);

function finish(s: CaNguaState, winner: string): CaNguaState {
  const rest = active(s)
    .filter((id) => id !== winner)
    .sort((a, b) => progressOf(s.horses[b]) - progressOf(s.horses[a]));
  return { ...s, phase: 'roll', die: null, turnDeadline: null, result: { winner, ranking: [winner, ...rest, ...[...s.out].reverse()] } };
}

function startTurn(s: CaNguaState, turn: string, now: number): CaNguaState {
  return { ...s, turn, phase: 'roll', die: null, turnDeadline: s.turnLimitMs ? now + s.turnLimitMs : null };
}

function nextTurn(s: CaNguaState, now: number): CaNguaState {
  const order = s.seats;
  const i = order.indexOf(s.turn);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(i + k) % order.length];
    if (!s.out.includes(id)) return startTurn({ ...s, sixes: 0 }, id, now);
  }
  return s;
}

// After a move (or a roll with nothing to move): a 6 earns another roll, otherwise the turn passes.
function afterMove(s: CaNguaState, now: number): CaNguaState {
  if (s.die === 6) return { ...s, phase: 'roll', die: null, turnDeadline: s.turnLimitMs ? now + s.turnLimitMs : null };
  return nextTurn(s, now);
}

function applyChoice(s: CaNguaState, player: string, c: CaNguaChoice, now: number): CaNguaState {
  const from = s.horses[player][c.horse];
  let horses = { ...s.horses, [player]: s.horses[player].map((p, i) => (i === c.horse ? c.to : p)) };
  if (c.kicks) horses = { ...horses, [c.kicks.player]: horses[c.kicks.player].map((p, i) => (i === c.kicks!.horse ? STABLE : p)) };
  const kicked = c.kicks?.player ?? null;
  const entry: CaNguaLogEntry =
    from === STABLE
      ? { kind: 'release', player, horse: c.horse, kicked }
      : c.to > GATE
        ? { kind: 'climb', player, horse: c.horse, step: c.to - GATE }
        : { kind: 'move', player, horse: c.horse, from, to: c.to, kicked };
  const next = withLog({ ...s, horses }, entry);
  return won(next.horses[player]) ? finish(next, player) : afterMove(next, now);
}

function roll(s: CaNguaState, player: string, now: number, random: () => number, auto: boolean): CaNguaState {
  const value = 1 + Math.floor(random() * 6);
  const sixes = value === 6 ? s.sixes + 1 : 0;
  let next = withLog({ ...s, die: value, sixes }, { kind: 'roll', player, value, auto });
  // Three 6s in a row and the turn is over.
  if (sixes >= MAX_SIXES) return nextTurn(withLog(next, { kind: 'sixes', player }), now);
  if (choicesFor(next, player, value).length === 0) {
    next = withLog(next, { kind: 'stuck', player });
    return afterMove(next, now);
  }
  // Choosing the horse gets a fresh turn timer.
  return { ...next, phase: 'move', turnDeadline: s.turnLimitMs ? now + s.turnLimitMs : null };
}

// ---- Bot ----

// Squares a horse at `progress` could be kicked from by an opponent's next roll.
function threatened(s: CaNguaState, player: string, progress: number): boolean {
  if (progress < 0 || progress > GATE) return false;
  const square = squareOf(colorOf(s, player), progress);
  return active(s).some(
    (id) =>
      id !== player &&
      s.horses[id].some((p) => {
        if (p < 0 || p > GATE) return false;
        const gap = (square - squareOf(colorOf(s, id), p) + TRACK) % TRACK;
        return gap >= 1 && gap <= 6;
      }),
  );
}

export function caNguaBotChoice(s: CaNguaState, player: string): CaNguaChoice | null {
  const options = choicesFor(s, player, s.die ?? 0);
  let best: CaNguaChoice | null = null;
  let bestScore = -Infinity;
  for (const c of options) {
    const from = s.horses[player][c.horse];
    let score = c.to - Math.max(from, 0);
    if (c.kicks) score += 60 + s.horses[c.kicks.player][c.kicks.horse];
    if (from === STABLE) score += 40;
    if (c.to > GATE) score += 50 + c.to;
    if (c.to === GATE) score += 30;
    if (threatened(s, player, from)) score += 20;
    if (threatened({ ...s, horses: { ...s.horses, [player]: s.horses[player].map((p, i) => (i === c.horse ? c.to : p)) } }, player, c.to)) score -= 25;
    if (score > bestScore) [best, bestScore] = [c, score];
  }
  return best;
}

// ---- Game definition ----

export const caNguaGame: GameDefinition<CaNguaState, CaNguaMove, CaNguaView> = {
  type: 'cangua',
  // The client tumbles the die and walks horses square by square; bots wait for that to finish.
  botPace: 2.2,

  setup(playerIds, options, { now }, previous) {
    // The previous winner starts; otherwise the host.
    const seats = [...playerIds];
    const colors = COLOR_SEATS[seats.length] ?? seats.map((_, i) => i);
    const first = previous?.result && seats.includes(previous.result.winner) ? previous.result.winner : seats[0];
    const base: CaNguaState = {
      seats,
      colors,
      rules: (options.caNguaRules ?? []).filter((r) => CANGUA_RULES.includes(r)),
      horses: Object.fromEntries(seats.map((id) => [id, Array(HORSES).fill(STABLE)])),
      turn: first,
      phase: 'roll',
      die: null,
      sixes: 0,
      out: [],
      log: [],
      result: null,
      turnLimitMs: TURN_TIMERS[options.turnTimer] ?? null,
      turnDeadline: null,
    };
    return startTurn(base, first, now);
  },

  applyMove(state, playerId, move, { now, random = Math.random }) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    if (!state.seats.includes(playerId) || state.out.includes(playerId)) return { ok: false, error: 'NOT_A_PLAYER' };
    if (state.turn !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };
    if (move?.type === 'roll' && state.phase === 'roll') return { ok: true, state: roll(state, playerId, now, random, false) };
    if (move?.type === 'move' && state.phase === 'move') {
      const choice = choicesFor(state, playerId, state.die!).find((c) => c.horse === move.horse);
      if (choice) return { ok: true, state: applyChoice(state, playerId, choice, now) };
    }
    return { ok: false, error: 'INVALID_MOVE' };
  },

  forfeit(state, playerId, { now }) {
    if (state.result || !state.seats.includes(playerId) || state.out.includes(playerId)) return state;
    let next = withLog({ ...state, out: [...state.out, playerId] }, { kind: 'left', player: playerId });
    const left = active(next);
    if (left.length === 1) return finish(next, left[0]);
    if (state.turn === playerId) next = nextTurn(next, now);
    return next;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    return {
      rules: state.rules,
      seats: state.seats.map((id, i) => ({ id, color: state.colors[i], horses: state.horses[id], out: state.out.includes(id) })),
      turn: state.turn,
      phase: state.phase,
      die: state.die,
      choices: state.phase === 'move' && state.turn === playerId && !state.result ? choicesFor(state, playerId, state.die!) : [],
      log: state.log,
      result: state.result,
      turnMs: state.turnDeadline === null ? null : Math.max(0, state.turnDeadline - now),
      turnLimitMs: state.turnLimitMs,
    };
  },

  deadline(state) {
    return state.result ? null : state.turnDeadline;
  },

  // Out of time: roll, or make the move a bot would.
  timeout(state, { now, random = Math.random }) {
    if (state.result || state.turnDeadline === null || now < state.turnDeadline) return state;
    if (state.phase === 'roll') return roll(state, state.turn, now, random, true);
    const choice = caNguaBotChoice(state, state.turn);
    return choice ? applyChoice(state, state.turn, choice, now) : nextTurn(state, now);
  },

  points(state) {
    if (!state.result) return null;
    const n = state.result.ranking.length;
    return Object.fromEntries(state.result.ranking.map((id, i) => [id, { place: i + 1, points: n - 1 - 2 * i }]));
  },

  botMove(state, playerId) {
    if (state.result || state.turn !== playerId) return null;
    if (state.phase === 'roll') return { type: 'roll' };
    const choice = caNguaBotChoice(state, playerId);
    return choice ? { type: 'move', horse: choice.horse } : null;
  },
};
