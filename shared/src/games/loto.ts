import type { GameDefinition, LotoSpeed } from '../types';

// Lô tô, the Vietnamese fairground and Tết number game. Everyone buys one or two tickets; the
// house calls the numbers 1 to 90 one by one, and players mark (dò) them on their tickets. The
// first to have all five numbers of a row called shouts "Kinh!" and takes the pot; several who
// shout on the same number share it. A wrong shout (kinh sai) puts that player out of the game.
//
// A ticket is a 9 × 9 grid: each row holds five numbers, and each column its own tens (1–9,
// 10–19, … 80–90), smallest at the top.

export const LOTO_MAX = 90;
export const LOTO_ROWS = 9;
export const LOTO_COLS = 9;
export const LOTO_PER_ROW = 5;
export const LOTO_MAX_TICKETS = 2;
export const LOTO_BUY_MS = 15_000;
// After a valid kinh, others who also have a full row get this long to shout too.
export const LOTO_KINH_MS = 3_000;
export const LOTO_CALL_MS: Record<LotoSpeed, number> = { slow: 6_000, normal: 4_000, fast: 2_500 };
const LOG_LIMIT = 40;

// rows[r][c] is a number or null for a blank cell.
export type LotoTicket = (number | null)[][];

export type LotoLogEntry =
  | { kind: 'buy'; player: string; tickets: number }
  | { kind: 'call'; number: number; count: number }
  | { kind: 'kinh'; player: string; row: number[] }
  | { kind: 'bust'; player: string }
  | { kind: 'left'; player: string };

export interface LotoWinner {
  player: string;
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
  // Tickets each player chose to buy (buy phase), then the tickets themselves.
  buying: Record<string, number>;
  tickets: Record<string, LotoTicket[]>;
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

export type LotoMove = { type: 'buy'; count: number } | { type: 'ready' } | { type: 'kinh' };

export interface LotoView {
  seats: { id: string; tickets: number; ready: boolean; out: boolean; busted: boolean; won: boolean }[];
  // Your own tickets; everyone's winning rows show in `winners`.
  tickets: LotoTicket[];
  buying: number;
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
const playing = (s: LotoState) => active(s).filter((id) => (s.tickets[id]?.length ?? 0) > 0 && !s.busted.includes(id));

// The numbers a column of the ticket draws from.
const columnRange = (c: number): [number, number] => (c === 0 ? [1, 9] : c === LOTO_COLS - 1 ? [80, 90] : [c * 10, c * 10 + 9]);

function pick<T>(items: T[], n: number, random: () => number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

export function lotoTicket(random: () => number): LotoTicket {
  const columns = Array.from({ length: LOTO_COLS }, (_, c) => c);
  const rowCols = Array.from({ length: LOTO_ROWS }, () => pick(columns, LOTO_PER_ROW, random));
  const rows: LotoTicket = Array.from({ length: LOTO_ROWS }, () => Array<number | null>(LOTO_COLS).fill(null));
  for (const c of columns) {
    const usedIn = rowCols.flatMap((cols, r) => (cols.includes(c) ? [r] : []));
    const [lo, hi] = columnRange(c);
    const numbers = pick(
      Array.from({ length: hi - lo + 1 }, (_, i) => lo + i),
      usedIn.length,
      random,
    ).sort((a, b) => a - b);
    usedIn.forEach((r, i) => (rows[r][c] = numbers[i]));
  }
  return rows;
}

export const rowNumbers = (ticket: LotoTicket, row: number) => ticket[row].filter((n): n is number => n !== null);

// The first row (on any of the tickets) whose five numbers have all been called.
export function fullRow(tickets: LotoTicket[], called: number[]): { ticket: number; row: number } | null {
  const seen = new Set(called);
  for (let t = 0; t < tickets.length; t++) {
    for (let r = 0; r < LOTO_ROWS; r++) if (rowNumbers(tickets[t], r).every((n) => seen.has(n))) return { ticket: t, row: r };
  }
  return null;
}

function finish(s: LotoState): LotoState {
  const paid = (id: string) => (s.tickets[id]?.length ?? 0) * s.price;
  const pot = s.seats.reduce((sum, id) => sum + paid(id), 0);
  const winnerIds = [...new Set(s.winners.map((w) => w.player))];
  const nets: Record<string, number> = {};
  for (const id of s.seats) nets[id] = winnerIds.length ? -paid(id) : 0;
  // Winners share the pot; the odd chips left by an uneven split go to the first to shout.
  winnerIds.forEach((id, i) => (nets[id] += Math.floor(pot / winnerIds.length) + (i === 0 ? pot % winnerIds.length : 0)));
  const ranking = [...s.seats].sort((a, b) => nets[b] - nets[a] || s.seats.indexOf(a) - s.seats.indexOf(b));
  return { ...s, deadline: 0, result: { winners: s.winners, nets, ranking } };
}

// Tickets are dealt and the calling starts; with nobody buying, there is no game.
function startCalling(s: LotoState, now: number, random: () => number): LotoState {
  const buyers = active(s).filter((id) => (s.buying[id] ?? 0) > 0);
  if (buyers.length === 0) return finish(s);
  const tickets = Object.fromEntries(buyers.map((id) => [id, Array.from({ length: s.buying[id] }, () => lotoTicket(random))]));
  const deck = pick(
    Array.from({ length: LOTO_MAX }, (_, i) => i + 1),
    LOTO_MAX,
    random,
  );
  return withLog({ ...s, tickets, deck, called: [], phase: 'call', deadline: now + s.callMs }, ...buyers.map((id) => ({ kind: 'buy' as const, player: id, tickets: s.buying[id] })));
}

function callNext(s: LotoState, now: number): LotoState {
  // Every number called and nobody shouted: give them a last chance, then end without a winner.
  if (s.deck.length === 0) return { ...s, phase: 'kinh', deadline: now + LOTO_KINH_MS };
  const [number, ...deck] = s.deck;
  const called = [...s.called, number];
  return withLog({ ...s, deck, called, deadline: now + s.callMs }, { kind: 'call', number, count: called.length });
}

const waitingOn = (s: LotoState) => active(s).filter((id) => !s.ready.includes(id) && (s.wallets === null || s.wallets[id] >= s.price));

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
      buying: {},
      tickets: {},
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
      case 'buy': {
        const count = move.count;
        const affordable = state.wallets === null || count * state.price <= state.wallets[playerId];
        if (state.phase !== 'buy' || state.ready.includes(playerId) || !Number.isInteger(count) || count < 0 || count > LOTO_MAX_TICKETS || !affordable) return fail;
        return { ok: true, state: { ...state, buying: { ...state.buying, [playerId]: count } } };
      }
      case 'ready': {
        if (state.phase !== 'buy' || state.ready.includes(playerId) || !(state.buying[playerId] > 0)) return fail;
        const next = { ...state, ready: [...state.ready, playerId] };
        return { ok: true, state: waitingOn(next).length === 0 ? startCalling(next, now, random) : next };
      }
      case 'kinh': {
        if (state.phase === 'buy' || !playing(state).includes(playerId) || state.winners.some((w) => w.player === playerId)) return fail;
        const row = fullRow(state.tickets[playerId], state.called);
        if (!row) {
          // Kinh sai: out of this game. If nobody is left to shout, the game ends without a winner.
          const next = withLog({ ...state, busted: [...state.busted, playerId] }, { kind: 'bust', player: playerId });
          return { ok: true, state: playing(next).length === 0 && next.winners.length === 0 ? finish(next) : next };
        }
        const winners = [...state.winners, { player: playerId, ...row }];
        const shout: LotoLogEntry = { kind: 'kinh', player: playerId, row: rowNumbers(state.tickets[playerId][row.ticket], row.row) };
        // The first kinh stops the calling; others with a full row may still shout for a moment.
        const next = withLog({ ...state, winners, ...(state.phase === 'call' ? { phase: 'kinh' as const, deadline: now + LOTO_KINH_MS } : {}) }, shout);
        return { ok: true, state: next };
      }
    }
    return fail;
  },

  forfeit(state, playerId, { now, random = Math.random }) {
    if (state.result || !state.seats.includes(playerId) || state.out.includes(playerId)) return state;
    // Tickets already bought stay in the pot.
    let next = withLog({ ...state, out: [...state.out, playerId] }, { kind: 'left', player: playerId });
    if (active(next).length === 0) return finish(next);
    if (next.phase === 'buy' && waitingOn(next).length === 0 && active(next).some((id) => next.buying[id] > 0)) next = startCalling(next, now, random);
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
        tickets: state.phase === 'buy' ? (state.buying[id] ?? 0) : (state.tickets[id]?.length ?? 0),
        ready: state.ready.includes(id),
        out: state.out.includes(id),
        busted: state.busted.includes(id),
        won: state.winners.some((w) => w.player === id),
      })),
      tickets: state.tickets[playerId] ?? [],
      buying: state.buying[playerId] ?? 0,
      price: state.price,
      phase: state.phase,
      called: state.called,
      callMs: state.callMs,
      msLeft: state.result ? 0 : Math.max(0, state.deadline - now),
      winners: state.winners.map((w) => ({ ...w, numbers: rowNumbers(state.tickets[w.player][w.ticket], w.row) })),
      log: state.log,
      result: state.result,
    };
  },

  deadline(state) {
    return state.result ? null : state.deadline;
  },

  // Buying time is up: deal to those who bought. Calling: the next number. After a kinh: the end.
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

  // Bots buy a ticket or two and shout kinh when they have a row.
  botMove(state, playerId, { random = Math.random }) {
    if (state.result || state.out.includes(playerId)) return null;
    if (state.phase === 'buy') {
      if (state.ready.includes(playerId)) return null;
      if (state.buying[playerId] > 0) return { type: 'ready' };
      const count = random() < 0.5 ? 1 : 2;
      const affordable = state.wallets === null ? count : Math.min(count, Math.floor(state.wallets[playerId] / state.price));
      return affordable > 0 ? { type: 'buy', count: affordable } : null;
    }
    if (!playing(state).includes(playerId) || state.winners.some((w) => w.player === playerId)) return null;
    const row = fullRow(state.tickets[playerId], state.called);
    if (!row) return null;
    // Had the row before the latest number: shout now. Just got it: only sometimes this quickly.
    const before = fullRow(state.tickets[playerId], state.called.slice(0, -1));
    return before || state.phase === 'kinh' || random() < BOT_QUICK ? { type: 'kinh' } : null;
  },
};
