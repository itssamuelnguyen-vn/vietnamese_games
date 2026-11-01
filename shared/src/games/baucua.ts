import type { GameDefinition } from '../types';

// Bau cua tom ca, the Lunar New Year dice game: everyone bets play money on six animals, the
// house shakes three dice under a bowl, and each die showing an animal pays its stake once more.
// The house banks every bet; after ten rounds the player with the most chips wins.

export type BauCuaSymbol = 'nai' | 'bau' | 'ga' | 'ca' | 'cua' | 'tom';
export const BAUCUA_SYMBOLS: BauCuaSymbol[] = ['nai', 'bau', 'ga', 'ca', 'cua', 'tom'];
export const BC_START_CHIPS = 1000;
export const BC_ROUNDS = 10;
export const BC_CHIP_VALUES = [10, 50, 100];
// Time to place bets; the dice roll early once everyone with chips is ready.
export const BC_BET_MS = 20_000;
// The bowl shakes, then lifts; the next round starts once people have seen the result.
export const BC_SHAKE_MS = 1_600;
export const BC_REVEAL_MS = 5_000;
const HISTORY = 12;
const LOG_LIMIT = 40;

export type Dice = [BauCuaSymbol, BauCuaSymbol, BauCuaSymbol];
export type Bets = Partial<Record<BauCuaSymbol, number>>;

export type BauCuaLogEntry =
  | { kind: 'round'; round: number }
  | { kind: 'roll'; round: number; dice: Dice }
  // A player's net result for the round: what came back minus what they staked.
  | { kind: 'result'; player: string; net: number }
  | { kind: 'left'; player: string };

export interface BauCuaResult {
  // Most chips first; players who left come last.
  ranking: string[];
  chips: Record<string, number>;
}

export interface BauCuaState {
  seats: string[];
  // Chips not on the table; stakes move here from bets when the round is settled.
  chips: Record<string, number>;
  bets: Record<string, Bets>;
  ready: string[];
  out: string[];
  round: number;
  phase: 'bet' | 'reveal';
  dice: Dice | null;
  // Recent results, newest last.
  history: Dice[];
  deadline: number;
  log: BauCuaLogEntry[];
  result: BauCuaResult | null;
}

export type BauCuaMove = { type: 'bet'; symbol: BauCuaSymbol; amount: number } | { type: 'clear' } | { type: 'ready' };

export interface BauCuaView {
  seats: { id: string; chips: number; staked: number; ready: boolean; out: boolean }[];
  bets: Record<string, Bets>;
  round: number;
  rounds: number;
  phase: 'bet' | 'reveal';
  dice: Dice | null;
  history: Dice[];
  msLeft: number;
  log: BauCuaLogEntry[];
  result: BauCuaResult | null;
}

const staked = (bets: Bets) => BAUCUA_SYMBOLS.reduce((sum, s) => sum + (bets[s] ?? 0), 0);
const active = (s: BauCuaState) => s.seats.filter((id) => !s.out.includes(id));
const withLog = (s: BauCuaState, ...entries: BauCuaLogEntry[]): BauCuaState => ({ ...s, log: [...s.log, ...entries].slice(-LOG_LIMIT) });

// What a stake on `symbol` brings back: nothing if no die shows it, otherwise the stake plus
// the stake again for each die that does.
export function bauCuaPayout(dice: Dice, symbol: BauCuaSymbol, stake: number): number {
  const hits = dice.filter((d) => d === symbol).length;
  return hits === 0 ? 0 : stake * (1 + hits);
}

// Whether anyone could still bet: the round rolls once everyone who can has said they're ready.
const waitingOn = (s: BauCuaState) => active(s).filter((id) => !s.ready.includes(id) && s.chips[id] + staked(s.bets[id] ?? {}) > 0);

function finish(s: BauCuaState): BauCuaState {
  const chips = Object.fromEntries(s.seats.map((id) => [id, s.chips[id]]));
  const ranking = [...active(s).sort((a, b) => chips[b] - chips[a] || s.seats.indexOf(a) - s.seats.indexOf(b)), ...[...s.out].reverse()];
  return { ...s, result: { ranking, chips } };
}

function roll(s: BauCuaState, now: number, random: () => number): BauCuaState {
  const dice = [0, 1, 2].map(() => BAUCUA_SYMBOLS[Math.floor(random() * BAUCUA_SYMBOLS.length)]) as Dice;
  let next: BauCuaState = { ...s, phase: 'reveal', dice, history: [...s.history, dice].slice(-HISTORY), deadline: now + BC_REVEAL_MS };
  next = withLog(next, { kind: 'roll', round: s.round, dice });
  const chips = { ...next.chips };
  const results: BauCuaLogEntry[] = [];
  for (const id of active(next)) {
    const bets = next.bets[id] ?? {};
    const stake = staked(bets);
    if (stake === 0) continue;
    const back = BAUCUA_SYMBOLS.reduce((sum, sym) => sum + bauCuaPayout(dice, sym, bets[sym] ?? 0), 0);
    chips[id] += back;
    results.push({ kind: 'result', player: id, net: back - stake });
  }
  return withLog({ ...next, chips }, ...results);
}

function nextRound(s: BauCuaState, now: number): BauCuaState {
  // Done after the last round, or once nobody has a chip left to bet.
  if (s.round >= BC_ROUNDS || active(s).every((id) => s.chips[id] === 0)) return finish(s);
  const round = s.round + 1;
  return withLog({ ...s, round, phase: 'bet', dice: null, bets: {}, ready: [], deadline: now + BC_BET_MS }, { kind: 'round', round });
}

// Rolls as soon as nobody is left to wait for.
const maybeRoll = (s: BauCuaState, now: number, random: () => number) => (waitingOn(s).length === 0 ? roll(s, now, random) : s);

const fail = { ok: false as const, error: 'INVALID_MOVE' as const };

export const bauCuaGame: GameDefinition<BauCuaState, BauCuaMove, BauCuaView> = {
  type: 'baucua',

  setup(playerIds, _options, { now }) {
    const base: BauCuaState = {
      seats: [...playerIds],
      chips: Object.fromEntries(playerIds.map((id) => [id, BC_START_CHIPS])),
      bets: {},
      ready: [],
      out: [],
      round: 1,
      phase: 'bet',
      dice: null,
      history: [],
      deadline: now + BC_BET_MS,
      log: [{ kind: 'round', round: 1 }],
      result: null,
    };
    return base;
  },

  applyMove(state, playerId, move, { now, random = Math.random }) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    if (!state.seats.includes(playerId) || state.out.includes(playerId)) return { ok: false, error: 'NOT_A_PLAYER' };
    if (state.phase !== 'bet' || typeof move !== 'object' || move === null) return fail;
    const bets = state.bets[playerId] ?? {};
    switch (move.type) {
      case 'bet': {
        if (!BAUCUA_SYMBOLS.includes(move.symbol) || !BC_CHIP_VALUES.includes(move.amount) || state.ready.includes(playerId)) return fail;
        if (state.chips[playerId] < move.amount) return fail;
        const next: BauCuaState = {
          ...state,
          chips: { ...state.chips, [playerId]: state.chips[playerId] - move.amount },
          bets: { ...state.bets, [playerId]: { ...bets, [move.symbol]: (bets[move.symbol] ?? 0) + move.amount } },
        };
        return { ok: true, state: next };
      }
      case 'clear': {
        if (state.ready.includes(playerId) || staked(bets) === 0) return fail;
        return { ok: true, state: { ...state, chips: { ...state.chips, [playerId]: state.chips[playerId] + staked(bets) }, bets: { ...state.bets, [playerId]: {} } } };
      }
      case 'ready': {
        if (state.ready.includes(playerId)) return fail;
        return { ok: true, state: maybeRoll({ ...state, ready: [...state.ready, playerId] }, now, random) };
      }
    }
    return fail;
  },

  forfeit(state, playerId, { now, random = Math.random }) {
    if (state.result || !state.seats.includes(playerId) || state.out.includes(playerId)) return state;
    // Their stakes stay with the house.
    let next: BauCuaState = withLog({ ...state, out: [...state.out, playerId], bets: { ...state.bets, [playerId]: {} } }, { kind: 'left', player: playerId });
    if (active(next).length < 2) return finish(next);
    if (next.phase === 'bet') next = maybeRoll(next, now, random);
    return next;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, _playerId, { now }) {
    return {
      seats: state.seats.map((id) => ({
        id,
        chips: state.chips[id],
        staked: staked(state.bets[id] ?? {}),
        ready: state.ready.includes(id),
        out: state.out.includes(id),
      })),
      bets: state.bets,
      round: state.round,
      rounds: BC_ROUNDS,
      phase: state.phase,
      dice: state.phase === 'reveal' ? state.dice : null,
      history: state.history,
      msLeft: Math.max(0, state.deadline - now),
      log: state.log,
      result: state.result,
    };
  },

  deadline(state) {
    return state.result ? null : state.deadline;
  },

  // Betting time is up: roll with whatever is on the table. The result has been shown: next round.
  timeout(state, { now, random = Math.random }) {
    if (state.result || now < state.deadline) return state;
    return state.phase === 'bet' ? roll(state, now, random) : nextRound(state, now);
  },

  points(state) {
    if (!state.result) return null;
    const n = state.result.ranking.length;
    return Object.fromEntries(state.result.ranking.map((id, i) => [id, { place: i + 1, points: n - 1 - 2 * i }]));
  },

  // Bots put a modest chip or two on an animal or two, then say they're ready.
  botMove(state, playerId, { random = Math.random }) {
    if (state.result || state.phase !== 'bet' || state.out.includes(playerId) || state.ready.includes(playerId)) return null;
    const chips = state.chips[playerId];
    const bets = state.bets[playerId] ?? {};
    const placed = BAUCUA_SYMBOLS.filter((s) => bets[s]).length;
    if (chips > 0 && (placed === 0 || (placed === 1 && random() < 0.4))) {
      const amount = [...BC_CHIP_VALUES].reverse().find((v) => v <= chips && v <= Math.max(10, chips / 8)) ?? BC_CHIP_VALUES.find((v) => v <= chips);
      const free = BAUCUA_SYMBOLS.filter((s) => !bets[s]);
      if (amount) return { type: 'bet', symbol: free[Math.floor(random() * free.length)], amount };
    }
    return { type: 'ready' };
  },
};
