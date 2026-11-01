import { chipUnit, type GameDefinition } from '../types';

// Bau cua tom ca, the Lunar New Year dice game: everyone bets play money on six animals, the
// house shakes three dice under a bowl, and each die showing an animal pays its stake once more.
// The house banks every bet, unless the host seats a player as the banker (làm cái): they don't
// bet, collect what the others lose and pay their wins from their own chips. After ten rounds
// the player with the most chips wins.

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
  // A seated banker's net for the round.
  | { kind: 'bank'; player: string; net: number }
  // The banker couldn't cover every win in full: the winners shared what the bank had.
  | { kind: 'bank-broke'; player: string }
  | { kind: 'left'; player: string };

export interface BauCuaResult {
  // Most chips first; players who left come last.
  ranking: string[];
  chips: Record<string, number>;
}

export interface BauCuaState {
  seats: string[];
  // The chips on offer: BC_CHIP_VALUES, scaled up when the room plays for money.
  chipValues: number[];
  // The seated banker, or null for the house (also once a banker leaves).
  dealerId: string | null;
  // Chips not on the table; stakes move here from bets when the round is settled.
  chips: Record<string, number>;
  bets: Record<string, Bets>;
  // Each player's bets in the last round rolled, so they can place the same again.
  lastBets: Record<string, Bets>;
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

// `repeat`: place the same bets as last round, if nothing is down yet and they can be afforded.
export type BauCuaMove = { type: 'bet'; symbol: BauCuaSymbol; amount: number } | { type: 'clear' } | { type: 'ready' } | { type: 'repeat' };

export interface BauCuaView {
  chipValues: number[];
  // What you bet last round (to bet the same again).
  lastBets: Bets;
  dealerId: string | null;
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
// Everyone still at the table who bets against the banker.
const punters = (s: BauCuaState) => active(s).filter((id) => id !== s.dealerId);
const withLog = (s: BauCuaState, ...entries: BauCuaLogEntry[]): BauCuaState => ({ ...s, log: [...s.log, ...entries].slice(-LOG_LIMIT) });

// What a stake on `symbol` brings back: nothing if no die shows it, otherwise the stake plus
// the stake again for each die that does.
export function bauCuaPayout(dice: Dice, symbol: BauCuaSymbol, stake: number): number {
  const hits = dice.filter((d) => d === symbol).length;
  return hits === 0 ? 0 : stake * (1 + hits);
}

// Whether anyone could still bet: the round rolls once everyone who can has said they're ready.
const waitingOn = (s: BauCuaState) => punters(s).filter((id) => !s.ready.includes(id) && s.chips[id] + staked(s.bets[id] ?? {}) > 0);

function finish(s: BauCuaState): BauCuaState {
  // Bets still on the table before the roll go back to those who placed them.
  const unrolled = (id: string) => (s.phase === 'bet' && !s.out.includes(id) ? staked(s.bets[id] ?? {}) : 0);
  const chips = Object.fromEntries(s.seats.map((id) => [id, s.chips[id] + unrolled(id)]));
  const ranking = [...active(s).sort((a, b) => chips[b] - chips[a] || s.seats.indexOf(a) - s.seats.indexOf(b)), ...[...s.out].reverse()];
  return { ...s, result: { ranking, chips } };
}

function roll(s: BauCuaState, now: number, random: () => number): BauCuaState {
  const dice = [0, 1, 2].map(() => BAUCUA_SYMBOLS[Math.floor(random() * BAUCUA_SYMBOLS.length)]) as Dice;
  const lastBets = Object.fromEntries(Object.entries(s.bets).filter(([, b]) => staked(b) > 0));
  let next: BauCuaState = { ...s, lastBets, phase: 'reveal', dice, history: [...s.history, dice].slice(-HISTORY), deadline: now + BC_REVEAL_MS };
  next = withLog(next, { kind: 'roll', round: s.round, dice });
  const chips = { ...next.chips };
  // Each player's net: what the dice bring back minus what they staked.
  const nets = new Map<string, number>();
  for (const id of punters(next)) {
    const bets = next.bets[id] ?? {};
    const stake = staked(bets);
    if (stake > 0) nets.set(id, BAUCUA_SYMBOLS.reduce((sum, sym) => sum + bauCuaPayout(dice, sym, bets[sym] ?? 0), 0) - stake);
  }
  const extra: BauCuaLogEntry[] = [];
  const banker = next.dealerId;
  if (banker !== null) {
    // The banker collects the losses first, then pays the wins from their own chips; if that
    // isn't enough, the winners share what there is in proportion (odd chips in seat order).
    const bank = chips[banker] - [...nets.values()].filter((n) => n < 0).reduce((sum, n) => sum + n, 0);
    const wins = [...nets].filter(([, n]) => n > 0);
    const due = wins.reduce((sum, [, n]) => sum + n, 0);
    if (due > bank) {
      const shares = wins.map(([id, n]) => [id, Math.floor((n * bank) / due)] as const);
      let left = bank - shares.reduce((sum, [, n]) => sum + n, 0);
      for (const [id, n] of shares) nets.set(id, n + (left-- > 0 ? 1 : 0));
      extra.push({ kind: 'bank-broke', player: banker });
    }
  }
  const results: BauCuaLogEntry[] = [];
  let bankNet = 0;
  for (const [id, net] of nets) {
    // The stake comes back off the table, plus or minus the winnings.
    chips[id] += staked(next.bets[id] ?? {}) + net;
    bankNet -= net;
    results.push({ kind: 'result', player: id, net });
  }
  if (banker !== null) {
    chips[banker] += bankNet;
    results.push({ kind: 'bank', player: banker, net: bankNet || 0 });
  }
  return withLog({ ...next, chips }, ...results, ...extra);
}

function nextRound(s: BauCuaState, now: number): BauCuaState {
  // Done after the last round, once nobody has a chip left to bet, or once the banker is broke.
  if (s.round >= BC_ROUNDS || punters(s).every((id) => s.chips[id] === 0) || (s.dealerId !== null && s.chips[s.dealerId] === 0)) return finish(s);
  const round = s.round + 1;
  return withLog({ ...s, round, phase: 'bet', dice: null, bets: {}, ready: [], deadline: now + BC_BET_MS }, { kind: 'round', round });
}

// Rolls as soon as nobody is left to wait for.
const maybeRoll = (s: BauCuaState, now: number, random: () => number) => (waitingOn(s).length === 0 ? roll(s, now, random) : s);

const fail = { ok: false as const, error: 'INVALID_MOVE' as const };

export const bauCuaGame: GameDefinition<BauCuaState, BauCuaMove, BauCuaView> = {
  type: 'baucua',

  // For money, chips are the players' wallets and bets are multiples of the room's chip unit.
  setup(playerIds, options, { now }, _previous, wallets) {
    const unit = wallets ? chipUnit(options) : 1;
    const base: BauCuaState = {
      seats: [...playerIds],
      chipValues: BC_CHIP_VALUES.map((v) => v * unit),
      dealerId: playerIds.includes(options.dealer ?? '') ? options.dealer : null,
      chips: Object.fromEntries(playerIds.map((id) => [id, wallets?.[id] ?? BC_START_CHIPS])),
      bets: {},
      lastBets: {},
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
    if (state.phase !== 'bet' || typeof move !== 'object' || move === null || playerId === state.dealerId) return fail;
    const bets = state.bets[playerId] ?? {};
    switch (move.type) {
      case 'bet': {
        if (!BAUCUA_SYMBOLS.includes(move.symbol) || !state.chipValues.includes(move.amount) || state.ready.includes(playerId)) return fail;
        if (state.chips[playerId] < move.amount) return fail;
        const next: BauCuaState = {
          ...state,
          chips: { ...state.chips, [playerId]: state.chips[playerId] - move.amount },
          bets: { ...state.bets, [playerId]: { ...bets, [move.symbol]: (bets[move.symbol] ?? 0) + move.amount } },
        };
        return { ok: true, state: next };
      }
      case 'repeat': {
        const last = state.lastBets[playerId] ?? {};
        const total = staked(last);
        if (state.ready.includes(playerId) || staked(bets) > 0 || total === 0 || total > state.chips[playerId]) return fail;
        return { ok: true, state: { ...state, chips: { ...state.chips, [playerId]: state.chips[playerId] - total }, bets: { ...state.bets, [playerId]: { ...last } } } };
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
    // Their stakes stay with the banker (or the house). A banker who leaves hands the bank to the house.
    const chips = { ...state.chips };
    if (state.phase === 'bet' && state.dealerId !== null && state.dealerId !== playerId) chips[state.dealerId] += staked(state.bets[playerId] ?? {});
    let next: BauCuaState = withLog(
      { ...state, chips, dealerId: state.dealerId === playerId ? null : state.dealerId, out: [...state.out, playerId], bets: { ...state.bets, [playerId]: {} } },
      { kind: 'left', player: playerId },
    );
    if (active(next).length < 2) return finish(next);
    if (next.phase === 'bet') next = maybeRoll(next, now, random);
    return next;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    return {
      lastBets: state.lastBets[playerId] ?? {},
      chipValues: state.chipValues,
      dealerId: state.dealerId,
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

  walletsAfter(state) {
    return state.result?.chips ?? null;
  },

  points(state) {
    if (!state.result) return null;
    const n = state.result.ranking.length;
    return Object.fromEntries(state.result.ranking.map((id, i) => [id, { place: i + 1, points: n - 1 - 2 * i }]));
  },

  // Bots put a modest chip or two on an animal or two, then say they're ready.
  botMove(state, playerId, { random = Math.random }) {
    if (state.result || state.phase !== 'bet' || state.out.includes(playerId) || state.ready.includes(playerId) || playerId === state.dealerId) return null;
    const chips = state.chips[playerId];
    const bets = state.bets[playerId] ?? {};
    const placed = BAUCUA_SYMBOLS.filter((s) => bets[s]).length;
    if (chips > 0 && (placed === 0 || (placed === 1 && random() < 0.4))) {
      const values = state.chipValues;
      const amount = [...values].reverse().find((v) => v <= chips && v <= Math.max(values[0], chips / 8)) ?? values.find((v) => v <= chips);
      const free = BAUCUA_SYMBOLS.filter((s) => !bets[s]);
      if (amount) return { type: 'bet', symbol: free[Math.floor(random() * free.length)], amount };
    }
    return { type: 'ready' };
  },
};
