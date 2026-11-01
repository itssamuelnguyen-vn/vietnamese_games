import type { GameDefinition, LotoSpeed } from '../types';
import { LOTO_TICKETS } from './loto-tickets';

// Lô tô, the Vietnamese fairground and Tết number game, played with a table set of 16 tickets in
// 8 colours, copied from a real printed set (loto-tickets.ts). The two tickets of a colour share out
// the 90 numbers between them: every number is on one or the other, never both. Each player takes up
// to two tickets, any two, and a ticket can only be held by one player. The house calls the numbers
// 1 to 90 one by one and players mark (dò) them. The first to have all five numbers of a row called
// shouts "Kinh!" and takes the pot; several who shout on the same number share it. A wrong shout
// (kinh sai) puts that player out.
//
// A ticket is a 9 × 9 grid: each row holds five numbers, and each column its own tens (1–9,
// 10–19, … 80–90).

export const LOTO_MAX = 90;
export const LOTO_ROWS = 9;
export const LOTO_COLS = 9;
export const LOTO_PER_ROW = 5;
export const LOTO_COLORS = 8;
// Tickets in the table set: two of each colour.
export const LOTO_SET = LOTO_COLORS * 2;
export const LOTO_MAX_TICKETS = 2;
export const LOTO_BUY_MS = 20_000;
// After a valid kinh, others who also have a full row get this long to shout too.
export const LOTO_KINH_MS = 3_000;
export const LOTO_CALL_MS: Record<LotoSpeed, number> = { slow: 6_000, normal: 4_000, fast: 2_500 };
const LOG_LIMIT = 40;

// rows[r][c] is a number or null for a blank cell.
export type LotoTicket = (number | null)[][];

// Ticket i of the set is colour Math.floor(i / 2); tickets 2k and 2k + 1 are a colour's pair.
export const lotoColor = (ticket: number) => Math.floor(ticket / 2);

export type LotoLogEntry =
  | { kind: 'buy'; player: string; tickets: number[] }
  | { kind: 'call'; number: number; count: number }
  | { kind: 'kinh'; player: string; row: number[] }
  | { kind: 'bust'; player: string }
  | { kind: 'left'; player: string };

export interface LotoWinner {
  player: string;
  // Index of the ticket in the table set.
  ticket: number;
  row: number;
}

export interface LotoResult {
  winners: LotoWinner[];
  // What each player won or lost, in money (tickets × price in points mode, where the price is 1).
  nets: Record<string, number>;
  ranking: string[];
}

export interface LotoState {
  seats: string[];
  // Price of a ticket: 1 when playing for points, the room's stake when playing for money.
  price: number;
  // Wallets at the start, when the room plays for money.
  wallets: Record<string, number> | null;
  // This game's table set of 16 tickets.
  set: LotoTicket[];
  // The tickets (indices into the set) each player has picked, then plays with.
  picks: Record<string, number[]>;
  ready: string[];
  out: string[];
  // Shouted kinh without a full row: out of this game.
  busted: string[];
  phase: 'buy' | 'call' | 'kinh';
  // Numbers still to call, in order, and those called so far.
  deck: number[];
  called: number[];
  callMs: number;
  deadline: number;
  winners: LotoWinner[];
  log: LotoLogEntry[];
  result: LotoResult | null;
}

// `pick`: the tickets to hold, replacing any earlier pick: none, or one or two free tickets (any two;
// a ticket you already hold counts as free for you).
export type LotoMove = { type: 'pick'; tickets: number[] } | { type: 'ready' } | { type: 'kinh' };

export interface LotoView {
  seats: { id: string; tickets: number[]; ready: boolean; out: boolean; busted: boolean; won: boolean }[];
  // The table set (everyone can see the tickets on the table) and who holds which.
  set: LotoTicket[];
  holders: Record<number, string>;
  mine: number[];
  price: number;
  phase: LotoState['phase'];
  called: number[];
  callMs: number;
  msLeft: number;
  winners: (LotoWinner & { numbers: number[] })[];
  log: LotoLogEntry[];
  result: LotoResult | null;
}

const withLog = (s: LotoState, ...entries: LotoLogEntry[]): LotoState => ({ ...s, log: [...s.log, ...entries].slice(-LOG_LIMIT) });
const active = (s: LotoState) => s.seats.filter((id) => !s.out.includes(id));
const held = (s: LotoState, id: string) => s.picks[id] ?? [];
const playing = (s: LotoState) => active(s).filter((id) => held(s, id).length > 0 && !s.busted.includes(id));
// Who holds each ticket of the set.
const holdersOf = (s: LotoState): Record<number, string> => Object.fromEntries(Object.entries(s.picks).flatMap(([id, ts]) => ts.map((t) => [t, id])));

function shuffle<T>(items: T[], random: () => number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

export const rowNumbers = (ticket: LotoTicket, row: number) => ticket[row].filter((n): n is number => n !== null);

// The first row, on any of the given tickets, whose five numbers have all been called.
export function fullRow(tickets: LotoTicket[], called: number[]): { index: number; row: number } | null {
  const seen = new Set(called);
  for (let t = 0; t < tickets.length; t++) {
    for (let r = 0; r < LOTO_ROWS; r++) if (rowNumbers(tickets[t], r).every((n) => seen.has(n))) return { index: t, row: r };
  }
  return null;
}

// Whether a pick breaks the rules: at most two different tickets of the set, none held by anyone
// else (each ticket of the set belongs to one player at most), and affordable. Moves are applied one
// at a time, so two players reaching for the same ticket can't both get it: the second is refused.
function pickProblem(s: LotoState, id: string, tickets: unknown): boolean {
  if (!Array.isArray(tickets) || tickets.length > LOTO_MAX_TICKETS || !tickets.every((t) => Number.isInteger(t) && t >= 0 && t < LOTO_SET)) return true;
  if (new Set(tickets).size !== tickets.length) return true;
  const holders = holdersOf(s);
  if (tickets.some((t) => holders[t] !== undefined && holders[t] !== id)) return true;
  return s.wallets !== null && tickets.length * s.price > s.wallets[id];
}

function finish(s: LotoState): LotoState {
  const paid = (id: string) => held(s, id).length * s.price;
  const pot = s.seats.reduce((sum, id) => sum + paid(id), 0);
  const winnerIds = [...new Set(s.winners.map((w) => w.player))];
  const nets: Record<string, number> = {};
  for (const id of s.seats) nets[id] = winnerIds.length ? -paid(id) : 0;
  // Winners share the pot; the odd chips left by an uneven split go to the first to shout.
  winnerIds.forEach((id, i) => (nets[id] += Math.floor(pot / winnerIds.length) + (i === 0 ? pot % winnerIds.length : 0)));
  const ranking = [...s.seats].sort((a, b) => nets[b] - nets[a] || s.seats.indexOf(a) - s.seats.indexOf(b));
  return { ...s, deadline: 0, result: { winners: s.winners, nets, ranking } };
}

// The calling starts with those who picked tickets; with nobody playing, there is no game.
function startCalling(s: LotoState, now: number, random: () => number): LotoState {
  const picks: Record<string, number[]> = Object.fromEntries(active(s).flatMap((id) => (held(s, id).length ? [[id, held(s, id)]] : [])));
  if (Object.keys(picks).length === 0) return finish({ ...s, picks: {} });
  const deck = shuffle(
    Array.from({ length: LOTO_MAX }, (_, i) => i + 1),
    random,
  );
  return withLog({ ...s, picks, deck, called: [], phase: 'call', deadline: now + s.callMs }, ...Object.entries(picks).map(([id, tickets]) => ({ kind: 'buy' as const, player: id, tickets })));
}

function callNext(s: LotoState, now: number): LotoState {
  // Every number called and nobody shouted: give them a last chance, then end without a winner.
  if (s.deck.length === 0) return { ...s, phase: 'kinh', deadline: now + LOTO_KINH_MS };
  const [number, ...deck] = s.deck;
  const called = [...s.called, number];
  return withLog({ ...s, deck, called, deadline: now + s.callMs }, { kind: 'call', number, count: called.length });
}

// Everyone who could still play and hasn't said they're done: not broke, and holding a ticket or
// with one still free on the table (once all 16 are taken, the rest just watch).
const waitingOn = (s: LotoState) => {
  const taken = Object.keys(holdersOf(s)).length;
  return active(s).filter((id) => !s.ready.includes(id) && (s.wallets === null || s.wallets[id] >= s.price) && (held(s, id).length > 0 || taken < LOTO_SET));
};

const fail = { ok: false as const, error: 'INVALID_MOVE' as const };

// A bot shouts on the number that completes its row only some of the time (people get a fair
// chance to be first), and always by the next number.
const BOT_QUICK = 0.4;

export const lotoGame: GameDefinition<LotoState, LotoMove, LotoView> = {
  type: 'loto',

  setup(playerIds, options, { now }, _previous, wallets) {
    return {
      seats: [...playerIds],
      price: wallets ? options.stakePerPoint : 1,
      wallets: wallets ? Object.fromEntries(playerIds.map((id) => [id, wallets[id] ?? 0])) : null,
      set: LOTO_TICKETS,
      picks: {},
      ready: [],
      out: [],
      busted: [],
      phase: 'buy',
      deck: [],
      called: [],
      callMs: LOTO_CALL_MS[options.callSpeed] ?? LOTO_CALL_MS.normal,
      deadline: now + LOTO_BUY_MS,
      winners: [],
      log: [],
      result: null,
    };
  },

  applyMove(state, playerId, move, { now, random = Math.random }) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    if (!state.seats.includes(playerId) || state.out.includes(playerId)) return { ok: false, error: 'NOT_A_PLAYER' };
    if (typeof move !== 'object' || move === null) return fail;
    switch (move.type) {
      case 'pick': {
        if (state.phase !== 'buy' || state.ready.includes(playerId) || pickProblem(state, playerId, move.tickets)) return fail;
        return { ok: true, state: { ...state, picks: { ...state.picks, [playerId]: [...move.tickets].sort((a, b) => a - b) } } };
      }
      case 'ready': {
        if (state.phase !== 'buy' || state.ready.includes(playerId) || held(state, playerId).length === 0) return fail;
        const next = { ...state, ready: [...state.ready, playerId] };
        return { ok: true, state: waitingOn(next).length === 0 ? startCalling(next, now, random) : next };
      }
      case 'kinh': {
        if (state.phase === 'buy' || !playing(state).includes(playerId) || state.winners.some((w) => w.player === playerId)) return fail;
        const mine = held(state, playerId);
        const full = fullRow(
          mine.map((t) => state.set[t]),
          state.called,
        );
        if (!full) {
          // Kinh sai: out of this game. If nobody is left to shout, the game ends without a winner.
          const next = withLog({ ...state, busted: [...state.busted, playerId] }, { kind: 'bust', player: playerId });
          return { ok: true, state: playing(next).length === 0 && next.winners.length === 0 ? finish(next) : next };
        }
        const ticket = mine[full.index];
        const winners = [...state.winners, { player: playerId, ticket, row: full.row }];
        const shout: LotoLogEntry = { kind: 'kinh', player: playerId, row: rowNumbers(state.set[ticket], full.row) };
        // The first kinh stops the calling; others with a full row may still shout for a moment.
        return { ok: true, state: withLog({ ...state, winners, ...(state.phase === 'call' ? { phase: 'kinh' as const, deadline: now + LOTO_KINH_MS } : {}) }, shout) };
      }
    }
    return fail;
  },

  forfeit(state, playerId, { now, random = Math.random }) {
    if (state.result || !state.seats.includes(playerId) || state.out.includes(playerId)) return state;
    // While picking, their tickets go back on the table; once dealt, they stay paid for in the pot.
    const picks = state.phase === 'buy' ? Object.fromEntries(Object.entries(state.picks).filter(([id]) => id !== playerId)) : state.picks;
    let next = withLog({ ...state, picks, out: [...state.out, playerId] }, { kind: 'left', player: playerId });
    if (active(next).length === 0) return finish(next);
    if (next.phase === 'buy' && waitingOn(next).length === 0 && active(next).some((id) => held(next, id).length > 0)) next = startCalling(next, now, random);
    else if (next.phase !== 'buy' && playing(next).length === 0 && next.winners.length === 0) next = finish(next);
    return next;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    return {
      seats: state.seats.map((id) => ({
        id,
        tickets: held(state, id),
        ready: state.ready.includes(id),
        out: state.out.includes(id),
        busted: state.busted.includes(id),
        won: state.winners.some((w) => w.player === id),
      })),
      set: state.set,
      holders: holdersOf(state),
      mine: held(state, playerId),
      price: state.price,
      phase: state.phase,
      called: state.called,
      callMs: state.callMs,
      msLeft: state.result ? 0 : Math.max(0, state.deadline - now),
      winners: state.winners.map((w) => ({ ...w, numbers: rowNumbers(state.set[w.ticket], w.row) })),
      log: state.log,
      result: state.result,
    };
  },

  deadline(state) {
    return state.result ? null : state.deadline;
  },

  // Picking time is up: those with tickets play. Calling: the next number. After a kinh: the end.
  timeout(state, { now, random = Math.random }) {
    if (state.result || now < state.deadline) return state;
    if (state.phase === 'buy') return startCalling(state, now, random);
    if (state.phase === 'kinh') return finish(state);
    return callNext(state, now);
  },

  // Winners share the pot; everyone else loses what their tickets cost. In tickets, for points.
  points(state) {
    if (!state.result) return null;
    const won = new Set(state.result.winners.map((w) => w.player));
    return Object.fromEntries(state.seats.map((id) => [id, { place: won.has(id) ? 1 : 2, points: Math.round(state.result!.nets[id] / state.price) }]));
  },

  walletsAfter(state) {
    if (!state.result || !state.wallets) return null;
    return Object.fromEntries(state.seats.map((id) => [id, state.wallets![id] + state.result!.nets[id]]));
  },

  // Bots take one free ticket, or now and then two, and shout kinh when they have a row.
  botMove(state, playerId, { random = Math.random }) {
    if (state.result || state.out.includes(playerId)) return null;
    if (state.phase === 'buy') {
      if (state.ready.includes(playerId)) return null;
      if (held(state, playerId).length > 0) return { type: 'ready' };
      const holders = holdersOf(state);
      const free = Array.from({ length: LOTO_SET }, (_, t) => t).filter((t) => holders[t] === undefined);
      const two = free.length >= 2 && random() < 0.4;
      const first = free.length ? free[Math.floor(random() * free.length)] : null;
      const rest = free.filter((t) => t !== first);
      const tickets = first === null ? [] : two ? [first, rest[Math.floor(random() * rest.length)]] : [first];
      if (tickets.length === 2 && pickProblem(state, playerId, tickets)) tickets.pop();
      return tickets.length && !pickProblem(state, playerId, tickets) ? { type: 'pick', tickets } : null;
    }
    if (!playing(state).includes(playerId) || state.winners.some((w) => w.player === playerId)) return null;
    const mine = held(state, playerId).map((t) => state.set[t]);
    if (!fullRow(mine, state.called)) return null;
    // Had the row before the latest number: shout now. Just got it: only sometimes this quickly.
    const before = fullRow(mine, state.called.slice(0, -1));
    return before || state.phase === 'kinh' || random() < BOT_QUICK ? { type: 'kinh' } : null;
  },
};
